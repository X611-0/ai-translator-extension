/**
 * 阿里云机器翻译 API 封装
 * 支持批量翻译优化、缓存、去重、上下文感知
 * 使用 Web Crypto API（兼容 Service Worker）
 */

import { AliyunConfig, TranslationResult } from '@/types';

// API 配置
const API_ENDPOINT = 'https://mt.cn-hangzhou.aliyuncs.com/';
const API_VERSION = '2018-10-12';
const ACTION_GENERAL = 'TranslateGeneral';
const ACTION_BATCH = 'TranslateBatch';
const ACTION_GET_QUOTA = 'GetTranslateQuota';

// 支持的语言代码映射
const LANGUAGE_MAP: Record<string, string> = {
  zh: 'zh',
  'zh-CN': 'zh',
  'zh-TW': 'zh-tw',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ar',
  th: 'th',
  vi: 'vi',
  id: 'id',
  ms: 'ms',
};

// 翻译缓存
interface CacheEntry {
  translated: string;
  timestamp: number;
  contextKey?: string; // 上下文关联的缓存键
}

const translationCache = new Map<string, CacheEntry>();
const CACHE_EXPIRY = 10 * 60 * 1000; // 10分钟过期

// 批量翻译队列
interface BatchItem {
  text: string;
  segmentId: number;
  context?: string; // 上下文文本
  resolve: (result: TranslationResult) => void;
  reject: (error: Error) => void;
}

let batchQueue: BatchItem[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY = 200; // 200ms 批量延迟
const BATCH_MAX_SIZE = 20; // 最大批量大小

// 上下文窗口（最近翻译的句子）
interface ContextEntry {
  original: string;
  translated: string;
  timestamp: number;
}

let contextWindow: ContextEntry[] = [];
const CONTEXT_WINDOW_SIZE = 3; // 保留最近3句话作为上下文

// 翻译统计
interface TranslationStats {
  totalRequests: number;
  totalCharacters: number;
  successCount: number;
  errorCount: number;
  averageLatency: number;
  cacheHits: number;
}

let stats: TranslationStats = {
  totalRequests: 0,
  totalCharacters: 0,
  successCount: 0,
  errorCount: 0,
  averageLatency: 0,
  cacheHits: 0,
};

/**
 * 特殊 URL 编码（阿里云要求）
 */
function specialEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/**
 * 构造规范化请求字符串
 */
function canonicalize(params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  return sortedKeys.map(key => `${specialEncode(key)}=${specialEncode(params[key])}`).join('&');
}

/**
 * 构造签名字符串
 */
function buildStringToSign(method: string, canonicalized: string): string {
  return `${method}&${specialEncode('/')}&${specialEncode(canonicalized)}`;
}

/**
 * 计算签名（使用 Web Crypto API）
 */
async function calculateSignature(stringToSign: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret + '&');
  const messageData = encoder.encode(stringToSign);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  // 签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为 Base64
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * 构造请求 URL
 */
async function buildRequestUrl(
  config: AliyunConfig,
  action: string,
  params: Record<string, string>
): Promise<string> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/\.\d{3}/, '');

  const allParams: Record<string, string> = {
    Action: action,
    Version: API_VERSION,
    Format: 'JSON',
    AccessKeyId: config.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: Math.random().toString(36).substring(2),
    Timestamp: timestamp,
    ...params,
  };

  const canonicalized = canonicalize(allParams);
  const stringToSign = buildStringToSign('GET', canonicalized);
  const signature = await calculateSignature(stringToSign, config.accessKeySecret);

  allParams.Signature = signature;

  const queryString = Object.keys(allParams)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
    .join('&');

  return `${API_ENDPOINT}?${queryString}`;
}

/**
 * 构造上下文键（用于缓存）
 */
function buildContextKey(sourceLanguage: string, targetLanguage: string, text: string, context?: string): string {
  const baseKey = `${sourceLanguage}:${targetLanguage}:${text}`;
  if (context) {
    return `${baseKey}:ctx:${hashContext(context)}`;
  }
  return baseKey;
}

/**
 * 简单哈希上下文
 */
function hashContext(context: string): string {
  let hash = 0;
  for (let i = 0; i < context.length; i++) {
    const char = context.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * 获取上下文文本
 */
function getContextText(): string {
  return contextWindow
    .slice(-CONTEXT_WINDOW_SIZE)
    .map(entry => entry.original)
    .join(' | ');
}

/**
 * 更新上下文窗口
 */
function updateContextWindow(original: string, translated: string): void {
  contextWindow.push({
    original,
    translated,
    timestamp: Date.now(),
  });

  // 保持窗口大小
  if (contextWindow.length > CONTEXT_WINDOW_SIZE * 2) {
    contextWindow = contextWindow.slice(-CONTEXT_WINDOW_SIZE);
  }
}

/**
 * 清除上下文窗口
 */
export function clearContextWindow(): void {
  contextWindow = [];
}

/**
 * 验证阿里云配置
 */
export function validateAliyunConfig(config: AliyunConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.accessKeyId?.trim()) {
    errors.push('AccessKeyId 不能为空');
  } else if (config.accessKeyId.length < 16) {
    errors.push('AccessKeyId 格式不正确（长度应 >= 16）');
  }

  if (!config.accessKeySecret?.trim()) {
    errors.push('AccessKeySecret 不能为空');
  } else if (config.accessKeySecret.length < 30) {
    errors.push('AccessKeySecret 格式不正确（长度应 >= 30）');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 解析错误信息
 */
function parseError(code: string, message?: string): string {
  const errorMap: Record<string, string> = {
    '100': '参数错误，请检查请求参数',
    '101': '语言不支持，请检查源语言和目标语言',
    '102': '文本过长，单次翻译最大支持5000字符',
    '103': '频率超限，请降低请求频率',
    '104': '余额不足，请充值后继续使用',
    '105': '账号异常，请检查账号状态',
    '106': '服务暂时不可用，请稍后重试',
    'InvalidAccessKeyId.NotFound': 'AccessKeyId 不存在',
    'SignatureDoesNotMatch': '签名验证失败，请检查 AccessKeySecret',
    'ServiceUnavailable': '服务暂时不可用',
    'InternalError': '服务器内部错误',
    'Throttling': '请求被限流，请稍后重试',
    'Unauthorized': '未授权使用该服务',
    'MissingParameter': '缺少必要参数',
    'InvalidParameter': '参数值无效',
  };

  return errorMap[code] || message || `翻译失败 (Code: ${code})`;
}

/**
 * 单条翻译（带上下文感知）
 */
export async function translateSingle(
  config: AliyunConfig,
  text: string,
  sourceLanguage: string = 'en',
  targetLanguage: string = 'zh',
  segmentId: number = 0,
  useContext: boolean = true
): Promise<TranslationResult> {
  const startTime = Date.now();

  // 获取上下文
  const context = useContext ? getContextText() : undefined;
  const cacheKey = buildContextKey(sourceLanguage, targetLanguage, text, context);

  // 检查缓存
  const cached = translationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
    stats.cacheHits++;
    return {
      original: text,
      translated: cached.translated,
      segmentId,
      timestamp: cached.timestamp,
    };
  }

  // 构造请求参数
  const params: Record<string, string> = {
    SourceLanguage: LANGUAGE_MAP[sourceLanguage] || sourceLanguage,
    TargetLanguage: LANGUAGE_MAP[targetLanguage] || targetLanguage,
    SourceText: text,
    Scene: 'general',
  };

  // 添加上下文（如果存在）
  if (context && context.trim()) {
    params.Context = context;
  }

  const url = await buildRequestUrl(config, ACTION_GENERAL, params);

  stats.totalRequests++;
  stats.totalCharacters += text.length;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Code !== '200') {
      const errorMsg = parseError(data.Code, data.Message);
      stats.errorCount++;
      throw new Error(errorMsg);
    }

    const translated = data.Data?.Translated || '';
    const latency = Date.now() - startTime;

    // 更新统计
    stats.successCount++;
    stats.averageLatency = (stats.averageLatency * (stats.successCount - 1) + latency) / stats.successCount;

    // 缓存结果
    translationCache.set(cacheKey, {
      translated,
      timestamp: Date.now(),
      contextKey: context,
    });

    // 更新上下文窗口
    if (useContext) {
      updateContextWindow(text, translated);
    }

    console.log(`[Aliyun] 翻译成功: "${text}" -> "${translated}" (${latency}ms)`);
    if (context) {
      console.log(`[Aliyun] 上下文: "${context.slice(0, 50)}..."`);
    }

    return {
      original: text,
      translated,
      segmentId,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('[Aliyun] 翻译请求失败:', err);
    throw err;
  }
}

/**
 * 批量翻译
 */
export async function translateBatch(
  config: AliyunConfig,
  texts: string[],
  sourceLanguage: string = 'en',
  targetLanguage: string = 'zh',
  useContext: boolean = false
): Promise<string[]> {
  // 过滤空文本和已缓存的
  const results: string[] = new Array(texts.length);
  const toTranslate: { index: number; text: string }[] = [];

  const context = useContext ? getContextText() : undefined;

  texts.forEach((text, index) => {
    if (!text.trim()) {
      results[index] = '';
      return;
    }

    const cacheKey = buildContextKey(sourceLanguage, targetLanguage, text, context);
    const cached = translationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
      results[index] = cached.translated;
      stats.cacheHits++;
      return;
    }

    toTranslate.push({ index, text });
  });

  if (toTranslate.length === 0) {
    return results;
  }

  // 构造批量请求
  const batchTexts = toTranslate.map(item => item.text);
  const params: Record<string, string> = {
    SourceLanguage: LANGUAGE_MAP[sourceLanguage] || sourceLanguage,
    TargetLanguage: LANGUAGE_MAP[targetLanguage] || targetLanguage,
    SourceText: JSON.stringify(batchTexts),
    Scene: 'general',
  };

  if (context && context.trim()) {
    params.Context = context;
  }

  const url = await buildRequestUrl(config, ACTION_BATCH, params);

  stats.totalRequests++;
  stats.totalCharacters += batchTexts.reduce((sum, t) => sum + t.length, 0);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Code !== '200') {
      const errorMsg = parseError(data.Code, data.Message);
      stats.errorCount++;
      throw new Error(errorMsg);
    }

    stats.successCount += toTranslate.length;

    // 解析批量结果
    const translatedList = data.Data?.TranslatedList || [];
    translatedList.forEach((item: { translated: string }, i: number) => {
      const { index, text } = toTranslate[i];
      results[index] = item.translated || '';

      // 缓存结果
      const cacheKey = buildContextKey(sourceLanguage, targetLanguage, text, context);
      translationCache.set(cacheKey, {
        translated: results[index],
        timestamp: Date.now(),
        contextKey: context,
      });

      // 更新上下文
      if (useContext) {
        updateContextWindow(text, results[index]);
      }
    });

    return results;
  } catch (err) {
    console.error('[Aliyun] 批量翻译失败:', err);
    // 失败时逐条翻译
    for (const { index, text } of toTranslate) {
      try {
        const result = await translateSingle(config, text, sourceLanguage, targetLanguage, 0, useContext);
        results[index] = result.translated;
      } catch {
        results[index] = text; // 失败时返回原文
      }
    }
    return results;
  }
}

/**
 * 智能翻译（自动批量优化）
 */
export function translateWithBatchOptimization(
  config: AliyunConfig,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  segmentId: number,
  useContext: boolean = true
): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    // 获取当前上下文
    const context = useContext ? getContextText() : undefined;

    // 添加到批量队列
    batchQueue.push({
      text,
      segmentId,
      context,
      resolve,
      reject,
    });

    // 启动批量定时器
    if (!batchTimer) {
      batchTimer = setTimeout(
        () => processBatchQueue(config, sourceLanguage, targetLanguage, useContext),
        BATCH_DELAY
      );
    }

    // 达到最大批量大小时立即处理
    if (batchQueue.length >= BATCH_MAX_SIZE) {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      processBatchQueue(config, sourceLanguage, targetLanguage, useContext);
    }
  });
}

/**
 * 处理批量队列
 */
async function processBatchQueue(
  config: AliyunConfig,
  sourceLanguage: string,
  targetLanguage: string,
  useContext: boolean
): Promise<void> {
  if (batchQueue.length === 0) return;

  const items = batchQueue.slice();
  batchQueue = [];
  batchTimer = null;

  // 去重
  const uniqueTexts = new Map<string, BatchItem[]>();
  items.forEach(item => {
    if (!uniqueTexts.has(item.text)) {
      uniqueTexts.set(item.text, []);
    }
    uniqueTexts.get(item.text)!.push(item);
  });

  const texts = Array.from(uniqueTexts.keys());

  try {
    const translations = await translateBatch(config, texts, sourceLanguage, targetLanguage, useContext);

    texts.forEach((text, i) => {
      const translated = translations[i];
      const batchItems = uniqueTexts.get(text)!;
      batchItems.forEach(item => {
        item.resolve({
          original: text,
          translated,
          segmentId: item.segmentId,
          timestamp: Date.now(),
        });
      });
    });
  } catch (err) {
    // 批量失败，逐条处理
    items.forEach(item => {
      translateSingle(config, item.text, sourceLanguage, targetLanguage, item.segmentId, useContext)
        .then(item.resolve)
        .catch(item.reject);
    });
  }
}

/**
 * 获取翻译配额
 */
export async function getQuota(config: AliyunConfig): Promise<{ total: number; used: number; remaining: number }> {
  const url = await buildRequestUrl(config, ACTION_GET_QUOTA, {});

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Code !== '200') {
      throw new Error(parseError(data.Code, data.Message));
    }

    return {
      total: data.Data?.TotalQuota || 0,
      used: data.Data?.UsedQuota || 0,
      remaining: (data.Data?.TotalQuota || 0) - (data.Data?.UsedQuota || 0),
    };
  } catch (err) {
    console.error('[Aliyun] 获取配额失败:', err);
    throw err;
  }
}

/**
 * 清除缓存
 */
export function clearTranslationCache(): void {
  translationCache.clear();
}

/**
 * 获取缓存统计
 */
export function getCacheStats(): { size: number; oldest: number } {
  const entries = Array.from(translationCache.values());
  const oldest = entries.length > 0
    ? Math.min(...entries.map(e => e.timestamp))
    : 0;
  return {
    size: translationCache.size,
    oldest,
  };
}

/**
 * 获取翻译统计
 */
export function getTranslationStats(): TranslationStats {
  return { ...stats };
}

/**
 * 重置翻译统计
 */
export function resetTranslationStats(): void {
  stats = {
    totalRequests: 0,
    totalCharacters: 0,
    successCount: 0,
    errorCount: 0,
    averageLatency: 0,
    cacheHits: 0,
  };
}

/**
 * 阿里云翻译服务类
 * 封装翻译功能，适配 MessageHandler
 */
export class AliyunTranslation {
  private config: AliyunConfig;
  private sourceLanguage: string = 'en';
  private targetLanguage: string = 'zh';
  private useContext: boolean = true;

  constructor(config: AliyunConfig) {
    // 验证配置
    const validation = validateAliyunConfig(config);
    if (!validation.valid) {
      console.warn('[AliyunTranslation] 配置验证失败:', validation.errors);
    }
    this.config = config;
  }

  /**
   * 设置语言
   */
  setLanguages(source: string, target: string): void {
    this.sourceLanguage = source;
    this.targetLanguage = target;
    // 语言切换时清除上下文
    clearContextWindow();
  }

  /**
   * 设置是否使用上下文
   */
  setUseContext(use: boolean): void {
    this.useContext = use;
    if (!use) {
      clearContextWindow();
    }
  }

  /**
   * 翻译文本
   */
  async translate(
    text: string,
    settings?: { languages?: { sourceLanguage?: string; targetLanguage?: string } }
  ): Promise<string> {
    const sourceLanguage = settings?.languages?.sourceLanguage || this.sourceLanguage;
    const targetLanguage = settings?.languages?.targetLanguage || this.targetLanguage;

    const result = await translateWithBatchOptimization(
      this.config,
      text,
      sourceLanguage,
      targetLanguage,
      0,
      this.useContext
    );

    return result.translated;
  }

  /**
   * 批量翻译
   */
  async translateBatch(texts: string[]): Promise<string[]> {
    return translateBatch(this.config, texts, this.sourceLanguage, this.targetLanguage, this.useContext);
  }

  /**
   * 获取配额
   */
  async getQuota(): Promise<{ total: number; used: number; remaining: number }> {
    return getQuota(this.config);
  }

  /**
   * 获取统计
   */
  getStats(): TranslationStats {
    return getTranslationStats();
  }

  /**
   * 清除缓存和上下文
   */
  clearCache(): void {
    clearTranslationCache();
    clearContextWindow();
  }

  /**
   * 验证配置
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    return validateAliyunConfig(this.config);
  }
}

/**
 * 错误码映射
 */
export const ERROR_CODES: Record<string, string> = {
  '100': '参数错误',
  '101': '语言不支持',
  '102': '文本过长',
  '103': '频率超限',
  '104': '余额不足',
  '105': '账号异常',
  '106': '服务不可用',
  'InvalidAccessKeyId.NotFound': 'AccessKeyId不存在',
  'SignatureDoesNotMatch': '签名验证失败',
  'ServiceUnavailable': '服务暂时不可用',
  'InternalError': '服务器内部错误',
  'Throttling': '请求被限流',
  'Unauthorized': '未授权使用该服务',
  '500': '服务器内部错误',
  '503': '服务暂不可用',
};