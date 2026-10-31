/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import fs from 'fs';
import os from 'os';
import path from 'path';

// 用临时目录里的 SQLite 跑真实的存储层和 API 路由
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunatv-test-'));
process.env.NEXT_PUBLIC_STORAGE_TYPE = 'sqlite';
process.env.SQLITE_DB_PATH = path.join(dir, 'lunatv.db');
process.env.USERNAME = 'owner';
process.env.PASSWORD = 'owner-pass-1';

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getAuthInfoFromCookie: () => ({ username: 'owner', role: 'owner' }),
}));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function resetConfig(siteConfig: Record<string, unknown> = {}) {
  const { db } = require('@/lib/db');
  const { configSelfCheck, clearConfigCache } = require('@/lib/config');
  await db.saveAdminConfig(
    await configSelfCheck({
      SiteConfig: siteConfig,
      UserConfig: { Users: [] },
      SourceConfig: [],
      CustomCategories: [],
      LiveConfig: [],
    } as any)
  );
  clearConfigCache();
}

describe('SQLite 存储', () => {
  test('导出再导入后，普通用户仍能用原密码登录（不会二次哈希）', async () => {
    const { db } = require('@/lib/db');
    const { NextRequest } = require('next/server');
    const exportRoute = require('@/app/api/admin/data_migration/export/route');
    const importRoute = require('@/app/api/admin/data_migration/import/route');

    await resetConfig();
    await db.registerUser('alice', 'alice-pass-1'); // 只有 V1 密码
    await db.registerUser('bob', 'bob-pass-1'); // V1 密码 + V2 信息（用户组）
    await db.createUserV2('bob', 'bob-pass-1', 'user', ['vip']);

    const exportRes = await exportRoute.POST(
      new NextRequest('http://localhost/api/admin/data_migration/export', {
        method: 'POST',
        body: JSON.stringify({ password: 'backup-pass' }),
      })
    );
    expect(exportRes.status).toBe(200);
    const backup = await exportRes.text();

    const form = new FormData();
    form.append('file', new File([backup], 'backup.dat'));
    form.append('password', 'backup-pass');
    const importRes = await importRoute.POST(
      new NextRequest('http://localhost/api/admin/data_migration/import', { method: 'POST', body: form })
    );
    expect(importRes.status).toBe(200);

    expect(await db.verifyUser('alice', 'alice-pass-1')).toBe(true);
    expect(await db.verifyUser('bob', 'bob-pass-1')).toBe(true);
    expect((await db.getUserInfoV2('bob'))?.tags).toEqual(['vip']);
  });

  test('设置了默认用户组时，注册的用户可以登录并带有分组', async () => {
    const { db } = require('@/lib/db');
    const { NextRequest } = require('next/server');
    const registerRoute = require('@/app/api/register/route');

    await resetConfig({ DefaultUserTags: ['vip'] });
    const res = await registerRoute.POST(
      new NextRequest('http://localhost/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: 'carol', password: 'carol-pass-1', confirmPassword: 'carol-pass-1' }),
      })
    );
    expect(res.status).toBe(200);
    expect(await db.verifyUser('carol', 'carol-pass-1')).toBe(true);
    expect((await db.getUserInfoV2('carol'))?.tags).toEqual(['vip']);
  });

  test('不能注册和 OIDC 用户同名的账号', async () => {
    const { db } = require('@/lib/db');
    const { NextRequest } = require('next/server');
    const registerRoute = require('@/app/api/register/route');

    await resetConfig();
    // OIDC 用户只有 V2 记录（没有 V1 密码）
    await db.createUserV2('dave', 'random-uuid-password', 'user', undefined, 'oidc-sub-dave');
    const res = await registerRoute.POST(
      new NextRequest('http://localhost/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: 'dave', password: 'attacker-pass', confirmPassword: 'attacker-pass' }),
      })
    );
    expect(res.status).toBe(400);
    expect(await db.verifyUser('dave', 'attacker-pass')).toBe(false);
  });

  test('清理过期缓存只删除过期条目，按前缀清理会删除全部', async () => {
    const { db } = require('@/lib/db');
    await db.setCache('tmdb-a', { v: 1 }, 3600);
    await db.setCache('tmdb-b', { v: 2 }, 3600);
    await db.clearExpiredCache('tmdb-');
    expect(await db.getCache('tmdb-a')).toEqual({ v: 1 });
    expect(await db.clearCacheByPrefix('tmdb-')).toBe(2);
    expect(await db.getCache('tmdb-a')).toBeNull();
  });
});

describe.each([
  ['BaseRedisStorage (redis/kvrocks)', 'redis'],
  ['UpstashRedisStorage', 'upstash'],
])('%s', (_name, kind) => {
  function make() {
    const kv = new Map<string, string>();
    const zset: string[] = [];
    const glob = (pattern: string) =>
      [...kv.keys()].filter((k) =>
        new RegExp(
          '^' + pattern.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
        ).test(k)
      );
    const client = {
      get: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
      set: async (k: string, v: string) => {
        kv.set(k, v);
        return 'OK';
      },
      del: async (...keys: (string | string[])[]) => {
        let n = 0;
        keys.flat().forEach((k) => (kv.delete(k) ? n++ : n));
        return n;
      },
      zRange: async () => zset,
      zrange: async () => zset,
      keys: async (pattern: string) => glob(pattern),
      zset,
      kv,
    };
    let s: any;
    if (kind === 'redis') {
      const { BaseRedisStorage } = require('@/lib/redis-base.db');
      s = Object.create(BaseRedisStorage.prototype);
      s.withRetry = (op: any) => op();
    } else {
      const { UpstashRedisStorage } = require('@/lib/upstash.db');
      s = Object.create(UpstashRedisStorage.prototype);
    }
    s.client = client;
    s.scanKeys = async (pattern: string) => client.keys(pattern);
    return s;
  }

  test('导出的哈希原样写回后能用原密码登录', async () => {
    const before = make();
    await before.registerUser('alice', 'alice-pass-1');
    const exported = await before.getPasswordHash('alice');
    expect(exported).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    const after = make();
    await after.restoreUser('alice', String(exported));
    expect(await after.verifyUser('alice', 'alice-pass-1')).toBe(true);
  });

  test('旧备份里的明文（含纯数字）会先哈希', async () => {
    const s = make();
    await s.restoreUser('bob', String(123456));
    expect(await s.getPasswordHash('bob')).not.toBe('123456');
    expect(await s.verifyUser('bob', '123456')).toBe(true);
  });

  test('getAllUsers 同时包含 V2 用户和只有 V1 密码的用户', async () => {
    const s = make();
    await s.registerUser('alice', 'alice-pass-1');
    await s.registerUser('bob', 'bob-pass-1');
    s.client.zset.push('bob');
    expect(await s.getAllUsers()).toEqual(['bob', 'alice']);
  });

  test('clearExpiredCache 不再删除仍然有效的缓存；clearCacheByPrefix 删除整类', async () => {
    const s = make();
    s.client.kv.set('cache:tmdb-a', '1');
    s.client.kv.set('cache:tmdb-b', '2');
    s.client.kv.set('cache:douban-c', '3');
    await s.clearExpiredCache('tmdb-');
    expect(s.client.kv.size).toBe(3);
    expect(await s.clearCacheByPrefix('tmdb-')).toBe(2);
    expect([...s.client.kv.keys()]).toEqual(['cache:douban-c']);
  });
});
