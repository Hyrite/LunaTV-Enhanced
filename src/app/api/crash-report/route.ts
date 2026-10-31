import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { CrashLog } from '@/lib/types';

export const runtime = 'nodejs';

// 单条崩溃报告最大 16 KB；每个用户每分钟最多 30 条，防止被刷满数据库
const MAX_REPORT_BYTES = 16 * 1024;
const RATE_LIMIT_PER_MINUTE = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    // 顺带清理过期的计数，避免 Map 无限增长
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

// 查看和清空崩溃日志只允许站长和管理员（日志里有其他用户访问的地址和浏览器信息）
async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) return false;
  if (authInfo.username === process.env.USERNAME) return true;
  try {
    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === authInfo.username);
    return !!user && (user.role === 'admin' || user.role === 'owner') && !user.banned;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_REPORT_BYTES) {
      return NextResponse.json({ error: 'Report too large' }, { status: 413 });
    }

    const authInfo = getAuthInfoFromCookie(request);
    const limiterKey =
      authInfo?.username ||
      request.headers.get('x-real-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'anonymous';
    if (isRateLimited(limiterKey)) {
      return NextResponse.json({ error: 'Too many reports' }, { status: 429 });
    }

    const crashReport: CrashLog = JSON.parse(raw);

    // 添加服务器接收时间
    const serverTimestamp = new Date().toISOString();
    const logEntry: CrashLog = {
      ...crashReport,
      serverReceivedAt: serverTimestamp,
    };

    // 保存到数据库（Redis/KVRocks/Upstash）
    await db.saveCrashLog(logEntry);

    // 打印到服务器控制台（lunatv-ex logs 可以看到）
    console.error('🔥 收到崩溃报告:', {
      type: crashReport.type || 'PAGE_ERROR',
      message: String(crashReport.message || '').slice(0, 300),
      url: crashReport.url,
      timestamp: crashReport.timestamp,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('保存崩溃报告失败:', error);
    return NextResponse.json(
      { error: 'Failed to save crash report' },
      { status: 500 }
    );
  }
}

// GET 接口：获取崩溃日志列表（仅管理员）
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 500);

    const crashLogs = await db.getCrashLogs(limit);

    return NextResponse.json({ crashLogs }, { status: 200 });
  } catch (error) {
    console.error('获取崩溃日志失败:', error);
    return NextResponse.json(
      { error: 'Failed to get crash logs' },
      { status: 500 }
    );
  }
}

// DELETE 接口：清除所有崩溃日志（仅管理员）
export async function DELETE(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await db.clearCrashLogs();

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('清除崩溃日志失败:', error);
    return NextResponse.json(
      { error: 'Failed to clear crash logs' },
      { status: 500 }
    );
  }
}
