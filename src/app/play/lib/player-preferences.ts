/**
 * 播放页的本地偏好与音轨工具函数（从 play/page.tsx 拆出，均为纯函数，不依赖组件状态）
 */

// 播放速率持久化
export const PLAYER_PLAYBACK_RATE_KEY = 'moontv_player_playback_rate';
export const PREFERRED_AUDIO_LANG_KEY = 'preferred_audio_lang';

export function sanitizePlaybackRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1.0;
  const allowedRates = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  return allowedRates.includes(value) ? value : 1.0;
}

export function loadPlaybackRate(): number {
  if (typeof window === 'undefined') return 1.0;
  try {
    const raw = localStorage.getItem(PLAYER_PLAYBACK_RATE_KEY);
    if (!raw) return 1.0;
    return sanitizePlaybackRate(Number(raw));
  } catch {
    return 1.0;
  }
}

// 音轨辅助函数
export function normalizeAudioLang(rawLang?: string): string {
  if (!rawLang) return '';
  return rawLang.trim().toLowerCase();
}

export function mapAudioLanguageLabel(rawLang?: string): string {
  const lang = normalizeAudioLang(rawLang);
  if (!lang) return '';

  if (lang === 'zh-cn' || lang === 'cmn' || lang === 'zh-hans' || lang === 'chi' || lang === 'zho') {
    return '中文';
  }
  if (lang === 'zh-tw' || lang === 'zh-hk' || lang === 'yue' || lang === 'zh-hant') {
    return '粤语';
  }
  if (lang === 'en' || lang === 'eng') {
    return 'English';
  }
  if (lang === 'ja' || lang === 'jpn') {
    return '日语';
  }
  if (lang === 'ko' || lang === 'kor') {
    return '韩语';
  }
  return rawLang || lang;
}

export function resolveAudioTrackName(
  rawName: string | undefined,
  rawLang: string | undefined,
  index: number
): string {
  if (rawName && rawName.trim() && !/^\d+$/.test(rawName.trim()) && !/^audio\s*\d+$/i.test(rawName.trim())) {
    return rawName.trim();
  }
  const mappedLanguage = mapAudioLanguageLabel(rawLang);
  if (mappedLanguage) return mappedLanguage;
  return `音轨 ${index + 1}`;
}

export function loadPreferredAudioLang(): string {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeAudioLang(localStorage.getItem(PREFERRED_AUDIO_LANG_KEY) || '');
  } catch {
    return '';
  }
}

export function savePreferredAudioLang(rawLang?: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeAudioLang(rawLang);
  if (!normalized) return;
  try {
    localStorage.setItem(PREFERRED_AUDIO_LANG_KEY, normalized);
  } catch {
    // ignore
  }
}

export function escapeAudioTrackHtml(rawValue: string): string {
  return rawValue
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function appendAudioStreamIndex(url: string, audioStreamIndex: number): string {
  if (!url) return url;

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    parsed.searchParams.set('AudioStreamIndex', String(audioStreamIndex));

    if (/^https?:\/\//i.test(url)) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}AudioStreamIndex=${encodeURIComponent(String(audioStreamIndex))}`;
  }
}

export function parseAudioStreamIndexFromUrl(url: string): number {
  if (!url) return -1;

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    const rawValue = parsed.searchParams.get('AudioStreamIndex');
    if (!rawValue || !/^\d+$/.test(rawValue)) {
      return -1;
    }
    return Number(rawValue);
  } catch {
    return -1;
  }
}
