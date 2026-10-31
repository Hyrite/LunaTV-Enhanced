/** @jest-environment node */
const store = new Map<string, unknown>();
const setCache = jest.fn(async (key: string, data: unknown, _ttl?: number) => {
  store.set(key, data);
});

jest.mock('@/lib/db', () => ({
  db: {
    getCache: async (key: string) => (store.has(key) ? store.get(key) : null),
    setCache: (key: string, data: unknown, ttl?: number) => setCache(key, data, ttl),
  },
}));

import { withServerCache } from '@/lib/server-route-cache';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  store.clear();
  setCache.mockClear();
});

describe('withServerCache', () => {
  test('第一次请求上游并写入缓存，第二次直接命中缓存', async () => {
    const handler = jest.fn(async () => jsonResponse({ code: 200, list: [{ id: '1' }] }));
    const GET = withServerCache(handler, { keyPrefix: 'douban-api-test-', ttlSeconds: 60 });

    const first = await GET(new Request('http://x/api?b=2&a=1'));
    expect(first.headers.get('X-Server-Cache')).toBe('MISS');
    expect(await first.json()).toEqual({ code: 200, list: [{ id: '1' }] });
    // 参数顺序不影响缓存 key
    expect(setCache).toHaveBeenCalledWith('douban-api-test-a=1&b=2', expect.anything(), 60);

    const second = await GET(new Request('http://x/api?a=1&b=2'));
    expect(second.headers.get('X-Server-Cache')).toBe('HIT');
    expect(await second.json()).toEqual({ code: 200, list: [{ id: '1' }] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('同一个 key 的并发请求只打一次上游', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const handler = jest.fn(async () => {
      await gate;
      return jsonResponse({ code: 200, list: [1] });
    });
    const GET = withServerCache(handler, { keyPrefix: 'p-', ttlSeconds: 60 });
    const pending = Promise.all([GET(new Request('http://x/?q=1')), GET(new Request('http://x/?q=1'))]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [a, b] = await pending;
    expect(await a.json()).toEqual(await b.json());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('错误响应、空列表和带错误码的结果不缓存', async () => {
    const bodies = [
      [{ error: 'boom' }, 500],
      [{ code: 200, list: [] }, 200],
      [{ code: 500, message: 'Failed' }, 200],
      [[], 200],
    ] as const;
    for (const [body, status] of bodies) {
      const GET = withServerCache(async () => jsonResponse(body, status), { keyPrefix: 'e-', ttlSeconds: 60 });
      await GET(new Request(`http://x/?case=${JSON.stringify(body)}`));
    }
    expect(setCache).not.toHaveBeenCalled();
  });

  test('带 bypass 参数时跳过缓存', async () => {
    store.set('d-id=1', { code: 200, cached: true });
    const handler = jest.fn(async () => jsonResponse({ code: 200, fresh: true }));
    const GET = withServerCache(handler, { keyPrefix: 'd-', ttlSeconds: 60, bypassParams: ['nocache'] });
    const res = await GET(new Request('http://x/?id=1&nocache=1'));
    expect(await res.json()).toEqual({ code: 200, fresh: true });
    expect(setCache).not.toHaveBeenCalled();
  });
});
