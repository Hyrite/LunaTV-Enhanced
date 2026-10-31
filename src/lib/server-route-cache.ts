/* eslint-disable no-console */
import { db } from './db';

/**
 * 给只读的 JSON API 路由加一层服务端共享缓存（Redis/Kvrocks/Upstash/SQLite 的 cache 表）。
 *
 * 以前是浏览器自己做缓存：先 GET /api/cache 查，再请求接口，再 POST /api/cache 写回，
 * 一个列表要 3 次往返；而且任何登录用户都能往共享缓存里写任意内容。
 * 现在缓存在服务端完成：浏览器只请求一次，命中时直接返回，未命中时同一个 key 的并发请求只打一次上游。
 */

type CacheableBody = Record<string, unknown> | unknown[] | null | undefined;

interface ServerCacheOptions {
  /** 缓存 key 前缀，例如 'douban-api-categories-'（以 douban- 开头，管理员“清理豆瓣缓存”时会一起清掉） */
  keyPrefix: string;
  /** 缓存时间（秒） */
  ttlSeconds: number;
  /** 带这些查询参数时跳过缓存（例如调试用的 nocache=1） */
  bypassParams?: string[];
  /** 判断响应内容是否值得缓存，默认：code 为 200（或没有 code 字段）且没有 error 字段 */
  isCacheable?: (body: CacheableBody) => boolean;
}

function defaultIsCacheable(body: CacheableBody): boolean {
  if (!body || typeof body !== 'object') return false;
  if (Array.isArray(body)) return body.length > 0;
  if ('error' in body && body.error) return false;
  if ('code' in body && body.code !== undefined && body.code !== 200) return false;
  // 空列表多半是上游临时异常（限流等），不缓存，下次再试
  if ('list' in body && Array.isArray(body.list) && body.list.length === 0) return false;
  return true;
}

// 同一个 key 正在请求上游时，后到的请求复用同一个结果
const inflight = new Map<string, Promise<{ status: number; text: string; headers: [string, string][] }>>();

export function withServerCache<Req extends Request>(
  handler: (request: Req) => Promise<Response>,
  options: ServerCacheOptions,
): (request: Req) => Promise<Response> {
  const { keyPrefix, ttlSeconds, bypassParams = [], isCacheable = defaultIsCacheable } = options;

  return async (request: Req) => {
    const url = new URL(request.url);
    const bypass = bypassParams.some((p) => {
      const v = url.searchParams.get(p);
      return v !== null && v !== '0' && v !== 'false';
    });
    if (bypass) return handler(request);

    const params = [...url.searchParams.entries()]
      .filter(([k]) => !bypassParams.includes(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const key = `${keyPrefix}${params}`;

    try {
      const cached = await db.getCache(key);
      if (cached !== null && cached !== undefined) {
        return Response.json(cached, {
          headers: {
            'X-Server-Cache': 'HIT',
            // 浏览器可短暂复用，减少重复请求；private 防止 CDN 缓存登录后的接口
            'Cache-Control': 'private, max-age=300',
          },
        });
      }
    } catch (error) {
      console.warn(`[server-cache] 读取缓存失败 ${key}:`, error);
    }

    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await handler(request);
        const text = await response.text();
        if (response.ok) {
          try {
            const body = JSON.parse(text) as CacheableBody;
            if (isCacheable(body)) {
              await db.setCache(key, body, ttlSeconds);
            }
          } catch (error) {
            console.warn(`[server-cache] 写入缓存失败 ${key}:`, error);
          }
        }
        return {
          status: response.status,
          text,
          headers: [...response.headers.entries()],
        };
      })().finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }

    const result = await pending;
    const headers = new Headers(result.headers);
    headers.set('X-Server-Cache', 'MISS');
    headers.delete('content-length');
    return new Response(result.text, { status: result.status, headers });
  };
}
