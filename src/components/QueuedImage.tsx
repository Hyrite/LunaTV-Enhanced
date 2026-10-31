'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 限流加载的图片：同一时间最多只有 MAX_CONCURRENT 张图片在下载，其余排队；
 * 卸载（离开页面）时立即取消还在下载的图片；下载超时也会取消。
 *
 * 用在“源浏览器”这类海报来自视频站自己图床的页面。这些图床经常很慢甚至一直挂着，
 * 一屏几十张图会同时占住浏览器的连接，而点击底部导航需要的请求要排在它们后面，
 * 表现为“页面加载完之前点别的按钮没反应”。限制并发并在离开时取消后，导航请求总有连接可用。
 */

const MAX_CONCURRENT = 4;
const LOAD_TIMEOUT_MS = 12000;

type Waiter = { start: () => void };
let active = 0;
const waiting: Waiter[] = [];

function pump() {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const next = waiting.shift();
    if (!next) break;
    active++;
    next.start();
  }
}

function releaseSlot() {
  active = Math.max(0, active - 1);
  pump();
}

/** 仅供测试使用 */
export function __resetImageQueue() {
  active = 0;
  waiting.length = 0;
}

interface QueuedImageProps {
  src: string;
  alt: string;
  className?: string;
}

export default function QueuedImage({ src, alt, className }: QueuedImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [loadSrc, setLoadSrc] = useState<string | undefined>(undefined);
  // 当前这张图是否占着一个下载名额（onLoad/onError/超时/卸载时释放）
  const holdingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (holdingRef.current) {
      holdingRef.current = false;
      releaseSlot();
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let waiter: Waiter | null = null;

    const enqueue = () => {
      waiter = {
        start: () => {
          if (cancelled) {
            // 排到队首时已经卸载：把名额还回去
            releaseSlot();
            return;
          }
          holdingRef.current = true;
          setLoadSrc(src);
          // 图床一直不响应时不能永远占着名额和连接：超时后取消这次下载
          timerRef.current = setTimeout(() => {
            if (ref.current) ref.current.removeAttribute('src');
            setLoadSrc(undefined);
            release();
          }, LOAD_TIMEOUT_MS);
        },
      };
      waiting.push(waiter);
      pump();
    };

    // 接近视口时才排队（和 loading='lazy' 一样的效果，但并发受限）
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'undefined') {
      enqueue();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            enqueue();
          }
        },
        { rootMargin: '300px 0px' }
      );
      observer.observe(el);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (waiter) {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
      }
      // 离开页面时取消还在下载的图片，释放浏览器连接
      if (holdingRef.current) el.removeAttribute('src');
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={loadSrc}
      alt={alt}
      className={className}
      decoding='async'
      onLoad={release}
      onError={release}
    />
  );
}
