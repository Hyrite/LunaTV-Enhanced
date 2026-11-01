/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { ChevronLeft, ChevronRight, Info, Play, Volume2, VolumeX } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useAutoplay } from './hooks/useAutoplay';
// 🚀 TanStack Query Queries & Mutations
import {
  useRefreshedTrailerUrlsQuery,
  useRefreshTrailerUrlMutation,
  useClearTrailerUrlMutation,
} from '@/hooks/useHeroBannerQueries';

interface BannerItem {
  id: string | number;
  title: string;
  description?: string;
  poster: string;
  backdrop?: string;
  year?: string;
  rate?: string;
  douban_id?: number;
  type?: string;
  trailerUrl?: string; // 预告片视频URL（可选）
  tmdbLogo?: string; // TMDB logo URL（可选）
}

interface HeroBannerProps {
  items: BannerItem[];
  autoPlayInterval?: number;
  showControls?: boolean;
  showIndicators?: boolean;
  enableVideo?: boolean; // 是否启用视频自动播放
}

// 🚀 优化方案6：使用React.memo防止不必要的重渲染
function HeroBanner({
  items,
  autoPlayInterval = 8000, // Netflix风格：更长的停留时间
  showControls = true,
  showIndicators = true,
  enableVideo = false,
}: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  // 滑动过程中实时更新的位置：只用于右上角计数和圆点；预告片、自动轮播仍用停稳后的 currentIndex
  const [displayIndex, setDisplayIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [videoLoaded, setVideoLoaded] = useState(false);

  // 记录每个影片的上次强制刷新时间（防止频繁刷新）
  // 使用 localStorage 持久化，避免组件重新挂载时丢失
  const FORCE_REFRESH_COOLDOWN = 60 * 1000; // 1 分钟冷却期
  const FORCE_REFRESH_STORAGE_KEY = 'hero-banner-force-refresh-times';

  // 记录每个 video 元素的 onError 触发时间（防止同一个 video 的 onError 被多次触发）
  const videoErrorTimesRef = useRef<Record<string, number>>({});

  // 🔥 记录已经请求过的 trailer ID，避免重复请求
  const requestedTrailerIdsRef = useRef<Set<string>>(new Set());

  // 获取上次强制刷新时间
  const getLastForceRefreshTime = (doubanId: string): number => {
    if (typeof window === 'undefined') return 0;
    try {
      const stored = localStorage.getItem(FORCE_REFRESH_STORAGE_KEY);
      if (stored) {
        const times = JSON.parse(stored) as Record<string, number>;
        return times[doubanId] || 0;
      }
    } catch (e) {
      console.error('[HeroBanner] 读取强制刷新时间失败:', e);
    }
    return 0;
  };

  // 设置上次强制刷新时间
  const setLastForceRefreshTime = (doubanId: string, time: number): void => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(FORCE_REFRESH_STORAGE_KEY);
      const times = stored ? JSON.parse(stored) : {};
      times[doubanId] = time;
      localStorage.setItem(FORCE_REFRESH_STORAGE_KEY, JSON.stringify(times));
    } catch (e) {
      console.error('[HeroBanner] 保存强制刷新时间失败:', e);
    }
  };

  const videoRef = useRef<HTMLVideoElement>(null);

  // 🚀 TanStack Query - 刷新后的trailer URL缓存
  // 替换 useState + localStorage 手动管理
  const { data: refreshedTrailerUrls = {} } = useRefreshedTrailerUrlsQuery();
  const refreshTrailerMutation = useRefreshTrailerUrlMutation();
  const clearTrailerMutation = useClearTrailerUrlMutation();

  // 处理图片 URL，使用代理绕过防盗链
  const getProxiedImageUrl = (url: string) => {
    if (url?.includes('douban') || url?.includes('doubanio')) {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // 确保 backdrop 是高清版本
  const getHDBackdrop = (url?: string) => {
    if (!url) return url;
    return url
      .replace('/view/photo/s/', '/view/photo/l/')
      .replace('/view/photo/m/', '/view/photo/l/')
      .replace('/view/photo/sqxs/', '/view/photo/l/')
      .replace('/s_ratio_poster/', '/l_ratio_poster/')
      .replace('/m_ratio_poster/', '/l_ratio_poster/');
  };

  // 处理视频 URL，使用代理绕过防盗链
  // 注意：refresh-trailer API 已经返回包含 douban_id 的代理 URL，这里只处理其他来源的 URL
  const getProxiedVideoUrl = (url: string, doubanId?: string | number) => {
    // 如果已经是代理 URL，直接返回
    if (url?.startsWith('/api/video-proxy')) {
      return url;
    }
    // 其他豆瓣 URL 需要代理
    if (url?.includes('douban') || url?.includes('doubanio')) {
      const proxyUrl = `/api/video-proxy?url=${encodeURIComponent(url)}`;
      // 🔥 添加 douban_id 参数，确保使用 movie_ 文件名
      if (doubanId) {
        return `${proxyUrl}&douban_id=${doubanId}`;
      }
      return proxyUrl;
    }
    return url;
  };

  // 🚀 TanStack Query - 刷新过期的trailer URL
  // 替换手动 useCallback + setState + localStorage
  const refreshTrailerUrl = useCallback(async (doubanId: number | string, force = false) => {
    const result = await refreshTrailerMutation.mutateAsync({ doubanId, force });
    return result;
  }, [refreshTrailerMutation]);

  // 获取当前有效的trailer URL（优先使用刷新后的）
  const getEffectiveTrailerUrl = (item: BannerItem) => {
    if (item.douban_id && refreshedTrailerUrls[item.douban_id]) {
      const cachedUrl = refreshedTrailerUrls[item.douban_id];
      // 如果标记为NO_TRAILER或FAILED，返回null避免尝试播放
      if (cachedUrl.startsWith('NO_TRAILER_') || cachedUrl.startsWith('FAILED_')) {
        return null;
      }
      return cachedUrl;
    }
    return item.trailerUrl;
  };

  // 滑到指定的一张（用原生横向滚动，吸附由 CSS scroll-snap 完成）
  const goTo = useCallback((index: number, instant = false) => {
    const track = trackRef.current;
    if (!track || items.length === 0) return;
    const target = ((index % items.length) + items.length) % items.length;
    track.scrollTo({ left: target * track.clientWidth, behavior: instant ? 'auto' : 'smooth' });
  }, [items.length]);

  // 自动轮播和桌面端按钮：最后一张之后直接回到第一张（瞬间切换，不会从头到尾快速扫过所有幻灯片）
  const handleNext = useCallback(() => {
    goTo(currentIndex + 1, currentIndex === items.length - 1);
  }, [goTo, currentIndex, items.length]);

  const handlePrev = useCallback(() => {
    goTo(currentIndex - 1, currentIndex === 0);
  }, [goTo, currentIndex]);

  const handleIndicatorClick = (index: number) => {
    if (index === currentIndex) return;
    goTo(index);
  };

  // 滚动停下来之后才确定当前是哪一张：拖动和平滑滚动过程中路过的幻灯片不会触发预告片刷新、视频重置
  const handleTrackScroll = useCallback(() => {
    const live = trackRef.current;
    if (live && live.clientWidth > 0) {
      setDisplayIndex(Math.round(live.scrollLeft / live.clientWidth));
    }
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth === 0) return;
      const index = Math.round(track.scrollLeft / track.clientWidth);
      setCurrentIndex((prev) => {
        if (prev === index) return prev;
        setVideoLoaded(false); // 重置视频加载状态
        return index;
      });
      setDisplayIndex(index);
    }, 90);
  }, []);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  // 窗口大小变化（例如手机横竖屏切换）后保持对齐当前这一张
  useEffect(() => {
    const onResize = () => {
      const track = trackRef.current;
      if (track) track.scrollTo({ left: currentIndex * track.clientWidth, behavior: 'auto' });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [currentIndex]);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // 使用自动轮播 Hook
  useAutoplay({
    currentIndex,
    isHovered,
    autoPlayInterval,
    itemsLength: items.length,
    onNext: handleNext,
  });

  // 预加载背景图片（只预加载当前和后一个，优化性能）
  useEffect(() => {
    // 预加载当前、后一张
    if (typeof window === 'undefined') return; // SSR环境跳过

    const indicesToPreload = [
      currentIndex,
      (currentIndex + 1) % items.length,
    ];

    indicesToPreload.forEach((index) => {
      const item = items[index];
      if (item) {
        const img = new window.Image();
        const imageUrl = getHDBackdrop(item.backdrop) || item.poster;
        img.src = getProxiedImageUrl(imageUrl);
      }
    });
  }, [items, currentIndex]);

  // 🎯 延迟加载：只预加载当前和相邻的 trailer URL
  useEffect(() => {
    // 如果禁用了视频，不需要刷新 trailer
    if (!enableVideo) {
      return;
    }

    const checkAndRefreshVisibleTrailers = async () => {
      const RETRY_COOLDOWN = 5 * 60 * 1000; // 5分钟冷却期（服务端错误）
      const NO_TRAILER_COOLDOWN = 24 * 60 * 60 * 1000; // 24小时冷却期（无预告片）

      // 🔥 只预加载当前和后一个（用户通常向后滑动）
      const indicesToLoad = [
        currentIndex,                                      // 当前
        (currentIndex + 1) % items.length,                 // 后一个
      ];

      for (const index of indicesToLoad) {
        const item = items[index];
        if (!item || !item.douban_id) continue;

        const doubanIdStr = item.douban_id.toString();

        // 🔥 如果已经请求过，跳过（避免重复请求）
        if (requestedTrailerIdsRef.current.has(doubanIdStr)) {
          continue;
        }

        // 🔥 从 React Query 缓存中获取最新值
        const cachedValue = refreshedTrailerUrls[item.douban_id];

        // 🔥 只在没有缓存时才请求
        if (!cachedValue) {
          console.log('[HeroBanner] 延迟加载 trailer:', item.title);
          requestedTrailerIdsRef.current.add(doubanIdStr);
          await refreshTrailerUrl(item.douban_id);
        } else if (cachedValue?.startsWith('NO_TRAILER_')) {
          // 检查无预告片标记的时间戳，24小时后重试
          const markedTime = parseInt(cachedValue.split('_')[2]);
          const now = Date.now();
          if (now - markedTime > NO_TRAILER_COOLDOWN) {
            console.log('[HeroBanner] 无预告片标记已过期（24小时），重新尝试:', item.title);
            requestedTrailerIdsRef.current.add(doubanIdStr);
            await refreshTrailerUrl(item.douban_id);
          }
        } else if (cachedValue?.startsWith('FAILED_')) {
          // 检查失败时间戳，如果超过冷却期则重试
          const failedTime = parseInt(cachedValue.split('_')[1]);
          const now = Date.now();
          if (now - failedTime > RETRY_COOLDOWN) {
            console.log('[HeroBanner] 失败冷却期已过，重新尝试:', item.title);
            requestedTrailerIdsRef.current.add(doubanIdStr);
            await refreshTrailerUrl(item.douban_id);
          }
        }
      }
    };

    // 延迟执行，避免阻塞初始渲染
    const timer = setTimeout(checkAndRefreshVisibleTrailers, 1000);
    return () => clearTimeout(timer);
  }, [items, currentIndex, refreshTrailerUrl, enableVideo, refreshedTrailerUrls]);

  // 提前返回必须放在所有 Hook 之后，否则轮播数据从有变无时 React 会因 Hook 数量变化而崩溃
  if (!items || items.length === 0) {
    return null;
  }

  // 数据刷新后条目可能变少，currentIndex 越界时回到第一项
  const currentItem = items[currentIndex] ?? items[0];
  const backgroundImage = getHDBackdrop(currentItem.backdrop) || currentItem.poster;

  return (
    <div
      className="relative w-full h-[50vh] sm:h-[55vh] md:h-[60vh] overflow-hidden group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      // 手指按着的时候暂停自动轮播，松开后重新计时
      onTouchStart={() => setIsHovered(true)}
      onTouchEnd={() => setIsHovered(false)}
      onTouchCancel={() => setIsHovered(false)}
    >
      {/* 横向滑动轨道：和下面各行一样用原生横向滚动 + 吸附，手指拖动时整张幻灯片跟着移动 */}
      <div
        ref={trackRef}
        onScroll={handleTrackScroll}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            className="relative h-full w-full shrink-0 snap-start snap-always overflow-hidden"
          >
            {/* 背景图片/视频层 */}
            <div className="absolute inset-0">
              {/* 背景图片（始终显示，作为视频的占位符） */}
              <Image
                src={getProxiedImageUrl(getHDBackdrop(item.backdrop) || item.poster)}
                alt={item.title}
                fill
                className="object-cover object-center"
                priority={index === 0}
                quality={100}
                sizes="100vw"
                unoptimized={item.backdrop?.includes('/l/') || item.backdrop?.includes('/l_ratio_poster/') || false}
              />

              {/* 视频背景（如果启用且有预告片URL，加载完成后淡入） */}
              {enableVideo && getEffectiveTrailerUrl(item) && index === currentIndex && (
                <video
                  key={`video-${item.id}-${currentIndex}`}
                  ref={videoRef}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
                    videoLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  autoPlay
                  muted={isMuted}
                  loop
                  playsInline
                  preload="metadata"
                  onError={async (e) => {
                    const video = e.currentTarget;

                    // 尝试获取更详细的错误信息
                    const error = (video as any).error;
                    const errorCode = error?.code;
                    const errorMessage = error?.message;
                    const networkState = video.networkState;
                    const readyState = video.readyState;
                    const errorType = errorCode === 1 ? 'ABORTED' :
                                     errorCode === 2 ? 'NETWORK' :
                                     errorCode === 3 ? 'DECODE' :
                                     errorCode === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN';

                    const errorData = {
                      title: item.title,
                      douban_id: item.douban_id,
                      trailerUrl: item.trailerUrl,
                      effectiveUrl: getEffectiveTrailerUrl(item),
                      errorCode,
                      errorMessage,
                      networkState,
                      readyState,
                      errorType,
                      // 记录当前时间，用于计算 URL 有效期
                      failedAt: new Date().toISOString(),
                    };

                    console.error('[HeroBanner] 视频加载失败:', errorData);

                    // 发送错误日志到服务端（不阻塞，静默失败）
                    fetch('/api/client-log', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        level: 'error',
                        message: `视频加载失败: ${item.title} (douban_id: ${item.douban_id})`,
                        data: errorData,
                        timestamp: Date.now(),
                      }),
                    }).catch(() => {}); // 静默失败，不影响用户体验

                    // 检测是否是403错误（trailer URL过期）
                    if (item.douban_id) {
                      const doubanIdStr = item.douban_id.toString();
                      const now = Date.now();

                      // 防抖：如果同一个 video 的 onError 在 5 秒内被触发多次，忽略
                      const lastErrorTime = videoErrorTimesRef.current[doubanIdStr] || 0;
                      if (now - lastErrorTime < 5000) {
                        console.warn(`[HeroBanner] 影片 ${item.title} onError 触发过于频繁，忽略`);
                        return;
                      }
                      videoErrorTimesRef.current[doubanIdStr] = now;

                      // 只有在网络错误（可能是 403/404）时才尝试强制刷新
                      // errorCode 2 = MEDIA_ERR_NETWORK
                      if (errorCode !== 2) {
                        console.warn(`[HeroBanner] 影片 ${item.title} 非网络错误（code=${errorCode}），不触发强制刷新`);
                        return;
                      }

                      const lastRefreshTime = getLastForceRefreshTime(doubanIdStr);
                      const timeSinceLastRefresh = now - lastRefreshTime;

                      // 检查冷却期：如果距离上次强制刷新不到 1 分钟，跳过
                      if (timeSinceLastRefresh < FORCE_REFRESH_COOLDOWN) {
                        const remainingSeconds = Math.ceil((FORCE_REFRESH_COOLDOWN - timeSinceLastRefresh) / 1000);
                        console.warn(`[HeroBanner] 影片 ${item.title} 强制刷新冷却中，${remainingSeconds}秒后可重试`);
                        return;
                      }

                      // 记录本次强制刷新时间
                      setLastForceRefreshTime(doubanIdStr, now);

                      // 如果缓存中有URL，说明之前刷新过，但现在又失败了
                      // 需要清除缓存中的旧URL，重新刷新
                      if (refreshedTrailerUrls[item.douban_id]) {
                        clearTrailerMutation.mutate({ doubanId: item.douban_id });
                      }

                      // 🔥 清除请求记录，允许重新请求
                      requestedTrailerIdsRef.current.delete(doubanIdStr);

                      // 重新刷新URL（强制刷新，跳过服务端缓存）
                      console.log(`[HeroBanner] 强制刷新 trailer URL: ${item.title}`);
                      const newUrl = await refreshTrailerUrl(item.douban_id, true);
                      if (newUrl) {
                        // 重新加载视频
                        video.load();
                      }
                    }
                  }}
                  onLoadedData={(e) => {
                    console.log('[HeroBanner] 视频加载成功:', item.title);
                    setVideoLoaded(true); // 视频加载完成，淡入显示
                    // 确保视频开始播放
                    const video = e.currentTarget;
                    video.play().catch((error) => {
                      console.error('[HeroBanner] 视频自动播放失败:', error);
                    });
                  }}
                >
                  <source src={getProxiedVideoUrl(getEffectiveTrailerUrl(item) || '', item.douban_id)} type="video/mp4" />
                </video>
              )}

        {/* Netflix经典渐变遮罩：底部黑→中间透明→顶部黑 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/80" />

        {/* 左侧额外渐变（增强文字可读性） */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
            </div>

      {/* 内容叠加层 - Netflix风格：左下角 */}
      <div className="absolute bottom-0 left-0 right-0 px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 pb-12 sm:pb-16 md:pb-20 lg:pb-24">
        <div className="space-y-3 sm:space-y-4 md:space-y-5 lg:space-y-6">
          {/* 标题 - Netflix风格：超大字体，有 TMDB logo 就显示图片 */}
          {item.tmdbLogo ? (
            <div className="relative inline-block max-w-[70%]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.tmdbLogo}
                alt={item.title}
                className="max-h-16 sm:max-h-20 md:max-h-24 lg:max-h-28 w-auto object-contain"
                style={{
                  filter: 'drop-shadow(0 0 12px rgba(255,255,255,0.6)) drop-shadow(0 4px 8px rgba(0,0,0,0.9))',
                }}
              />
            </div>
          ) : (
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-white drop-shadow-2xl leading-tight break-words">
              {item.title}
            </h1>
          )}

          {/* 元数据 */}
          <div className="flex items-center gap-3 sm:gap-4 text-sm sm:text-base md:text-lg flex-wrap">
            {item.rate && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-500/90 backdrop-blur-sm rounded">
                <span className="text-white font-bold">★</span>
                <span className="text-white font-bold">{item.rate}</span>
              </div>
            )}
            {item.year && (
              <span className="text-white/90 font-semibold drop-shadow-md">
                {item.year}
              </span>
            )}
            {item.type && (
              <span className="px-3 py-1 bg-white/20 backdrop-blur-sm rounded text-white/90 font-medium border border-white/30">
                {item.type === 'movie' ? '电影' :
                 item.type === 'tv' ? '剧集' :
                 item.type === 'variety' ? '综艺' :
                 item.type === 'shortdrama' ? '短剧' :
                 item.type === 'anime' ? '动漫' : '剧集'}
              </span>
            )}
          </div>

          {/* 描述 - 限制3行 */}
          {item.description && (
            <p className="text-sm sm:text-base md:text-lg lg:text-xl text-white/90 line-clamp-3 drop-shadow-lg leading-relaxed max-w-xl">
              {item.description}
            </p>
          )}

          {/* 操作按钮 - Netflix风格 */}
          <div className="flex gap-3 sm:gap-4 pt-2">
            <Link
              href={
                item.type === 'shortdrama'
                  ? `/play?title=${encodeURIComponent(item.title)}&shortdrama_id=${item.id}`
                  : `/play?title=${encodeURIComponent(item.title)}${item.year ? `&year=${item.year}` : ''}${item.douban_id ? `&douban_id=${item.douban_id}` : ''}${item.type ? `&stype=${item.type}` : ''}`
              }
              className="flex items-center gap-2 px-6 sm:px-8 md:px-10 py-2.5 sm:py-3 md:py-4 bg-white text-black font-bold rounded hover:bg-white/90 transition-all transform hover:scale-105 active:scale-95 shadow-xl text-base sm:text-lg md:text-xl"
            >
              <Play className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" fill="currentColor" />
              <span>播放</span>
            </Link>
            <Link
              href={
                item.type === 'shortdrama'
                  ? '/shortdrama'
                  : `/douban?type=${
                      item.type === 'variety' ? 'show' : (item.type || 'movie')
                    }`
              }
              className="flex items-center gap-2 px-6 sm:px-8 md:px-10 py-2.5 sm:py-3 md:py-4 bg-white/30 backdrop-blur-md text-white font-bold rounded hover:bg-white/40 transition-all transform hover:scale-105 active:scale-95 shadow-xl text-base sm:text-lg md:text-xl border border-white/50"
            >
              <Info className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" />
              <span>更多信息</span>
            </Link>
          </div>
        </div>
      </div>
          </div>
        ))}
      </div>

      {/* 音量控制按钮（仅视频模式） - 底部右下角，避免遮挡简介 */}
      {enableVideo && getEffectiveTrailerUrl(currentItem) && (
        <button
          onClick={toggleMute}
          className="absolute bottom-6 sm:bottom-8 right-4 sm:right-8 md:right-12 lg:right-16 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-all border border-white/50 z-10"
          aria-label={isMuted ? '取消静音' : '静音'}
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" />
          ) : (
            <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
          )}
        </button>
      )}

      {/* 导航按钮 - 桌面端显示 */}
      {showControls && items.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            className="hidden md:flex absolute left-4 lg:left-8 top-1/2 -translate-y-1/2 w-12 h-12 lg:w-14 lg:h-14 rounded-full bg-black/50 backdrop-blur-sm text-white items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-all transform hover:scale-110 border border-white/30"
            aria-label="上一张"
          >
            <ChevronLeft className="w-7 h-7 lg:w-8 lg:h-8" />
          </button>
          <button
            onClick={handleNext}
            className="hidden md:flex absolute right-4 lg:right-8 top-1/2 -translate-y-1/2 w-12 h-12 lg:w-14 lg:h-14 rounded-full bg-black/50 backdrop-blur-sm text-white items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-all transform hover:scale-110 border border-white/30"
            aria-label="下一张"
          >
            <ChevronRight className="w-7 h-7 lg:w-8 lg:h-8" />
          </button>
        </>
      )}

      {/* 指示器 - Netflix风格：底部居中 */}
      {showIndicators && items.length > 1 && (
        <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
          {items.map((_, index) => (
            <button
              key={index}
              onClick={() => handleIndicatorClick(index)}
              className={`h-1 rounded-full transition-all duration-300 ${
                index === displayIndex
                  ? 'w-8 sm:w-10 bg-white shadow-lg'
                  : 'w-2 bg-white/50 hover:bg-white/75'
              }`}
              aria-label={`跳转到第 ${index + 1} 张`}
            />
          ))}
        </div>
      )}

      {/* 年龄分级标识（可选） */}
      <div className="absolute top-4 sm:top-6 md:top-8 right-4 sm:right-8 md:right-12">
        <div className="px-2 py-1 bg-black/60 backdrop-blur-sm border-2 border-white/70 rounded text-white text-xs sm:text-sm font-bold">
          {Math.min(displayIndex, items.length - 1) + 1} / {items.length}
        </div>
      </div>
    </div>
  );
}

export default memo(HeroBanner);
