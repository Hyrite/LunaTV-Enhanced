/**
 * 播放页用到的纯工具函数（从 play/page.tsx 拆出）：搜索关键词变体、年份匹配、换源打分、时间格式化等。
 * 这些函数不依赖组件状态，单独放在这里便于阅读和测试。
 */
import type { SearchResult } from '@/lib/types';

// 标准化年份用于匹配（处理 unknown、0、null 等无效值）
export const normalizeYearForMatch = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized === 'unknown' ||
    normalized === '0' ||
    normalized === 'null' ||
    normalized === 'undefined'
  ) {
    return '';
  }

  const matchedYear = normalized.match(/\d{4}/)?.[0];
  return matchedYear || '';
};

export const matchesRequestedYear = (
  resultYear: string,
  requestedYear: string,
): boolean => {
  const normalizedRequestedYear = normalizeYearForMatch(requestedYear);
  if (!normalizedRequestedYear) {
    return true;
  }

  return normalizeYearForMatch(resultYear) === normalizedRequestedYear;
};

// bangumi ID检测（3-6位数字）
export const isBangumiId = (id: number): boolean => {
  const length = id.toString().length;
  return id > 0 && length >= 3 && length <= 6;
};

export const generateSearchVariants = (originalQuery: string): string[] => {
  const variants: string[] = [];
  const trimmed = originalQuery.trim();

  // 1. 原始查询（最高优先级）
  variants.push(trimmed);

  // 2. 处理中文标点符号变体
  const chinesePunctuationVariants = generateChinesePunctuationVariants(trimmed);
  chinesePunctuationVariants.forEach(variant => {
    if (!variants.includes(variant)) {
      variants.push(variant);
    }
  });

  // 3. 添加数字变体处理（处理"第X季" <-> "X" 的转换）
  const numberVariants = generateNumberVariants(trimmed);
  numberVariants.forEach(variant => {
    if (!variants.includes(variant)) {
      variants.push(variant);
    }
  });

  // 如果包含空格，生成额外变体
  if (trimmed.includes(' ')) {
    // 4. 去除所有空格
    const noSpaces = trimmed.replace(/\s+/g, '');
    if (noSpaces !== trimmed) {
      variants.push(noSpaces);
    }

    // 5. 标准化空格（多个空格合并为一个）
    const normalizedSpaces = trimmed.replace(/\s+/g, ' ');
    if (normalizedSpaces !== trimmed && !variants.includes(normalizedSpaces)) {
      variants.push(normalizedSpaces);
    }

    // 6. 提取关键词组合（针对"中餐厅 第九季"这种情况）
    const keywords = trimmed.split(/\s+/);
    if (keywords.length >= 2) {
      // 主要关键词 + 季/集等后缀
      const mainKeyword = keywords[0];
      const lastKeyword = keywords[keywords.length - 1];

      // 如果最后一个词包含"第"、"季"、"集"等，尝试组合
      if (/第|季|集|部|篇|章/.test(lastKeyword)) {
        const combined = mainKeyword + lastKeyword;
        if (!variants.includes(combined)) {
          variants.push(combined);
        }
      }

      // 7. 空格变冒号的变体（重要！针对"死神来了 血脉诅咒" -> "死神来了：血脉诅咒"）
      const withColon = trimmed.replace(/\s+/g, '：');
      if (!variants.includes(withColon)) {
        variants.push(withColon);
      }

      // 8. 空格变英文冒号的变体
      const withEnglishColon = trimmed.replace(/\s+/g, ':');
      if (!variants.includes(withEnglishColon)) {
        variants.push(withEnglishColon);
      }

      // 仅使用主关键词搜索（过滤无意义的词）
      const meaninglessWords = ['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
      if (!variants.includes(mainKeyword) &&
          !meaninglessWords.includes(mainKeyword.toLowerCase()) &&
          mainKeyword.length > 2) {
        variants.push(mainKeyword);
      }
    }
  }

  // 去重并返回
  return Array.from(new Set(variants));
};

export const generateNumberVariants = (query: string): string[] => {
  const variants: string[] = [];

  // 中文数字到阿拉伯数字的映射
  const chineseNumbers: { [key: string]: string } = {
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
  };

  // 1. 处理"第X季/部/集"格式（最常见的情况）
  const seasonPattern = /第([一二三四五六七八九十\d]+)(季|部|集|期)/;
  const match = seasonPattern.exec(query);

  if (match) {
    const fullMatch = match[0];
    const number = match[1];
    const suffix = match[2];
    const arabicNumber = chineseNumbers[number] || number;
    const base = query.replace(fullMatch, '').trim();

    if (base) {
      // 只生成最常见的格式：无空格，如"一拳超人3"
      // 不生成"一拳超人 3"和"一拳超人S3"等变体，避免匹配太多不相关结果
      variants.push(`${base}${arabicNumber}`);
    }
  }

  // 2. 处理末尾纯数字（如"牧神记3"）
  const endNumberMatch = query.match(/^(.+?)\s*(\d+)$/);
  if (endNumberMatch) {
    const base = endNumberMatch[1].trim();
    const number = endNumberMatch[2];
    const chineseNum = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][parseInt(number)];

    if (chineseNum && parseInt(number) <= 10) {
      // 只生成无空格带"第X季"的变体，如"牧神记第三季"
      variants.push(`${base}第${chineseNum}季`);
    }
  }

  // 限制返回前1个最有可能的变体
  return variants.slice(0, 1);
};

export const generateChinesePunctuationVariants = (query: string): string[] => {
  const variants: string[] = [];

  // 检查是否包含中文标点符号
  const chinesePunctuation = /[：；，。！？、""''（）【】《》]/;
  if (!chinesePunctuation.test(query)) {
    return variants;
  }

  // 中文冒号变体 (针对"死神来了：血脉诅咒"这种情况)
  if (query.includes('：')) {
    // 优先级1: 替换为空格 (最可能匹配，如"死神来了 血脉诅咒" 能匹配到 "死神来了6：血脉诅咒")
    const withSpace = query.replace(/：/g, ' ');
    variants.push(withSpace);

    // 优先级2: 完全去除冒号
    const noColon = query.replace(/：/g, '');
    variants.push(noColon);

    // 优先级3: 替换为英文冒号
    const englishColon = query.replace(/：/g, ':');
    variants.push(englishColon);

    // 优先级4: 提取冒号前的主标题 (降低优先级，避免匹配到错误的系列)
    const beforeColon = query.split('：')[0].trim();
    if (beforeColon && beforeColon !== query) {
      variants.push(beforeColon);
    }

    // 优先级5: 提取冒号后的副标题
    const afterColon = query.split('：')[1]?.trim();
    if (afterColon) {
      variants.push(afterColon);
    }
  }

  // 其他中文标点符号处理
  let cleanedQuery = query;

  // 替换中文标点为对应英文标点
  cleanedQuery = cleanedQuery.replace(/；/g, ';');
  cleanedQuery = cleanedQuery.replace(/，/g, ',');
  cleanedQuery = cleanedQuery.replace(/。/g, '.');
  cleanedQuery = cleanedQuery.replace(/！/g, '!');
  cleanedQuery = cleanedQuery.replace(/？/g, '?');
  cleanedQuery = cleanedQuery.replace(/"/g, '"');
  cleanedQuery = cleanedQuery.replace(/"/g, '"');
  cleanedQuery = cleanedQuery.replace(/'/g, "'");
  cleanedQuery = cleanedQuery.replace(/'/g, "'");
  cleanedQuery = cleanedQuery.replace(/（/g, '(');
  cleanedQuery = cleanedQuery.replace(/）/g, ')');
  cleanedQuery = cleanedQuery.replace(/【/g, '[');
  cleanedQuery = cleanedQuery.replace(/】/g, ']');
  cleanedQuery = cleanedQuery.replace(/《/g, '<');
  cleanedQuery = cleanedQuery.replace(/》/g, '>');

  if (cleanedQuery !== query) {
    variants.push(cleanedQuery);
  }

  // 完全去除所有标点符号
  const noPunctuation = query.replace(/[：；，。！？、""''（）【】《》:;,.!?"'()[\]<>]/g, '');
  if (noPunctuation !== query && noPunctuation.trim()) {
    variants.push(noPunctuation);
  }

  return variants;
};

// 检查是否包含查询中的所有关键词（与downstream评分逻辑保持一致）
export const checkAllKeywordsMatch = (queryTitle: string, resultTitle: string): boolean => {
  const queryWords = queryTitle.replace(/[^\w\s\u4e00-\u9fff]/g, '').split(/\s+/).filter(w => w.length > 0);

  // 检查结果标题是否包含查询中的所有关键词
  return queryWords.every(word => resultTitle.includes(word));
};

// 按权重排序源（权重高的在前）
export const sortSourcesByWeight = (sources: SearchResult[], weights: Record<string, number>): SearchResult[] => {
  return [...sources].sort((a, b) => {
    const weightA = weights[a.source] ?? 50;
    const weightB = weights[b.source] ?? 50;
    return weightB - weightA; // 降序排列，权重高的在前
  });
};

// 计算播放源综合评分
export const calculateSourceScore = (
  testResult: {
    quality: string;
    loadSpeed: string;
    pingTime: number;
    speedKBps?: number;
  },
  maxSpeed: number,
  minPing: number,
  maxPing: number
): number => {
  let score = 0;

  // 分辨率评分 (40% 权重)
  const qualityScore = (() => {
    switch (testResult.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();
  score += qualityScore * 0.4;

  // 下载速度评分 (45% 权重) - 基于最大速度线性映射
  const speedScore = (() => {
    // 优先使用新的 speedKBps 字段
    if (testResult.speedKBps && Number.isFinite(testResult.speedKBps) && testResult.speedKBps > 0) {
      const speedRatio = testResult.speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    }

    // 降级：解析 loadSpeed 字符串
    const speedStr = testResult.loadSpeed;
    if (speedStr === '未知' || speedStr === '测量中...') return 30;

    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) return 30;

    const value = parseFloat(match[1]);
    const unit = match[2];
    const speedKBps = unit === 'MB/s' ? value * 1024 : value;

    const speedRatio = speedKBps / maxSpeed;
    return Math.min(100, Math.max(0, speedRatio * 100));
  })();
  score += speedScore * 0.45;

  // 网络响应评分 (15% 权重) - 响应容易受瞬时抖动影响，权重低于实际分片速度
  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 0; // 无效延迟给默认分

    // 如果所有延迟都相同，给满分
    if (maxPing === minPing) return 100;

    // 线性映射：最低延迟=100分，最高延迟=0分
    const pingRatio = (maxPing - ping) / (maxPing - minPing);
    return Math.min(100, Math.max(0, pingRatio * 100));
  })();
  score += pingScore * 0.15;

  return Math.round(score * 100) / 100; // 保留两位小数
};

// WebSR 辅助函数：获取网络名称
export const getWebsrNetworkName = (mode: 'upscale' | 'restore', size: 's' | 'm' | 'l'): any => {
  if (mode === 'restore') {
    return `anime4k/cnn-restore-${size}`;
  }
  return `anime4k/cnn-2x-${size}`;
};

// WebSR 辅助函数：获取权重文件名
export const getWebsrWeightFilename = (
  mode: 'upscale' | 'restore',
  size: 's' | 'm' | 'l',
  contentType: 'an' | 'rl' | '3d'
): string => {
  if (mode === 'restore') {
    return `cnn-restore-${size}-an.json`;
  }
  return `cnn-2x-${size}-${contentType}.json`;
};

export const formatTime = (seconds: number): string => {
  if (seconds === 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (hours === 0) {
    // 不到一小时，格式为 00:00
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  } else {
    // 超过一小时，格式为 00:00:00
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
};
