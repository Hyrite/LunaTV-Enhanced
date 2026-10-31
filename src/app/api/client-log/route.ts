import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// 这个接口不需要登录，所以要限制大小和频率，并去掉换行符，避免被用来刷屏或伪造服务端日志
const MAX_FIELD_LENGTH = 2000;
const RATE_LIMIT_PER_MINUTE = 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    if (rateBuckets.size > 1000) {
      rateBuckets.forEach((b, k) => {
        if (b.resetAt <= now) rateBuckets.delete(k);
      });
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

function clean(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return (text || '').replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, MAX_FIELD_LENGTH);
}

// 客户端日志收集 API
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-real-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ success: false }, { status: 429 });
    }

    const raw = await request.text();
    if (raw.length > 16 * 1024) {
      return NextResponse.json({ success: false }, { status: 413 });
    }
    const body = JSON.parse(raw);
    const { level, message, data } = body ?? {};

    // 根据日志级别输出到服务端
    const logMessage = `[ClientLog] [${clean(level)}] ${clean(message)}`;
    const extra = data === undefined ? '' : clean(data);

    if (level === 'error') {
      console.error(logMessage, extra);
    } else if (level === 'warn') {
      console.warn(logMessage, extra);
    } else {
      console.info(logMessage, extra);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ClientLog] 处理客户端日志失败:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
