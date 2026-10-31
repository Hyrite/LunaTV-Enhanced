import { NextRequest, NextResponse } from 'next/server';
import { withServerCache } from '@/lib/server-route-cache';

export const runtime = 'nodejs';

async function handleGET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id')?.trim();

  if (!id) {
    return NextResponse.json({ code: 400, message: 'Missing id' }, { status: 400 });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Referer': 'https://movie.douban.com/',
    'Accept': 'application/json, text/plain, */*',
  };

  const urls = [
    `https://img.doubanio.cmliussss.net/rexxar/api/v2/subject/${id}`,
    `https://m.douban.cmliussss.net/rexxar/api/v2/subject/${id}`,
    `https://m.douban.cmliussss.com/rexxar/api/v2/subject/${id}`,
    `https://m.douban.com/rexxar/api/v2/subject/${id}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.title) continue;

      return NextResponse.json(
        {
          code: 200,
          data: {
            id: data.id || id,
            title: data.title || '',
            year: data.year || '',
            rate: data.rating?.value ? Number(data.rating.value).toFixed(1) : null,
            genres: data.genres || [],
            directors: (data.directors || []).slice(0, 3).map((d: any) => d.name).filter(Boolean),
            cast: (data.actors || []).slice(0, 5).map((a: any) => a.name).filter(Boolean),
            plot_summary: data.intro || data.card_subtitle || '',
          },
        },
        { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' } }
      );
    } catch {
      continue;
    }
  }

  return NextResponse.json({ code: 500, message: 'Failed' });
}

// 服务端共享缓存（简要信息 4 小时）：命中时不再请求豆瓣，浏览器端也不必再自己读写 /api/cache
export const GET = withServerCache(handleGET, {
  keyPrefix: 'douban-api-quickinfo-',
  ttlSeconds: 4 * 60 * 60,
});
