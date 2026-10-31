import {
  formatTime,
  generateSearchVariants,
  matchesRequestedYear,
  normalizeYearForMatch,
  sortSourcesByWeight,
} from '@/app/play/lib/play-helpers';
import {
  appendAudioStreamIndex,
  parseAudioStreamIndexFromUrl,
  resolveAudioTrackName,
  sanitizePlaybackRate,
} from '@/app/play/lib/player-preferences';
import type { SearchResult } from '@/lib/types';

describe('播放页工具函数', () => {
  test('formatTime', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3661)).toBe('01:01:01');
  });

  test('年份匹配忽略无效年份', () => {
    expect(normalizeYearForMatch('unknown')).toBe('');
    expect(normalizeYearForMatch(' 2024年 ')).toBe('2024');
    expect(matchesRequestedYear('2024', '')).toBe(true);
    expect(matchesRequestedYear('2023', '2024')).toBe(false);
    expect(matchesRequestedYear('2024-05', '2024')).toBe(true);
  });

  test('搜索变体包含原始关键词', () => {
    const variants = generateSearchVariants('仙逆 第二季');
    expect(variants[0]).toBe('仙逆 第二季');
    expect(new Set(variants).size).toBe(variants.length);
  });

  test('按权重排序换源列表，未配置的权重按 50 处理', () => {
    const sources = [{ source: 'a' }, { source: 'b' }, { source: 'c' }] as SearchResult[];
    const sorted = sortSourcesByWeight(sources, { a: 10, c: 90 });
    expect(sorted.map((s) => s.source)).toEqual(['c', 'b', 'a']);
    expect(sources.map((s) => s.source)).toEqual(['a', 'b', 'c']); // 不修改原数组
  });

  test('播放速率只接受预设值', () => {
    expect(sanitizePlaybackRate(1.5)).toBe(1.5);
    expect(sanitizePlaybackRate(7)).toBe(1);
    expect(sanitizePlaybackRate('2')).toBe(1);
  });

  test('音轨参数读写与命名', () => {
    const url = appendAudioStreamIndex('/api/emby/play/t/v.m3u8?x=1', 2);
    expect(url).toBe('/api/emby/play/t/v.m3u8?x=1&AudioStreamIndex=2');
    expect(parseAudioStreamIndexFromUrl(url)).toBe(2);
    expect(parseAudioStreamIndexFromUrl('/v.m3u8')).toBe(-1);
    expect(resolveAudioTrackName('audio 1', 'eng', 0)).toBe('English');
    expect(resolveAudioTrackName(undefined, undefined, 1)).toBe('音轨 2');
  });
});
