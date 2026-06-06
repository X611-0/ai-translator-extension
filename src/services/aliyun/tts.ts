/**
 * 阿里云 TTS (文本转语音) API 封装
 * 支持音频队列管理、并发控制、语音参数调节
 * 使用 Web Crypto API（兼容 Service Worker）
 */

import { AliyunConfig } from '@/types';

// API 配置
const API_ENDPOINT = 'https://nls.cn-hangzhou.aliyuncs.com/';
const API_VERSION = '2019-02-28';
const ACTION_TTS = 'CreateSynthesizeTask';

// TTS 参数
interface TTSParams {
  text: string;
  voice?: string;      // 发音人
  speed?: number;      // 语速 -500~500
  volume?: number;     // 音量 0~100
  pitch?: number;      // 语调 -500~500
  format?: string;     // 音频格式 wav/mp3/pcm
  sampleRate?: number; // 采样率 8000/16000
}

// 默认发音人映射
const VOICE_MAP: Record<string, string> = {
  // 中文发音人
  zh: 'xiaoyun',       // 女声
  zh_female: 'xiaoyun',
  zh_male: 'xiaogang',
  zh_tw: 'xiaomei',    // 台湾女声
  // 英文发音人
  en: 'xiaoyun',       // 中英双语女声
  en_us: 'xiaoyun',
  en_female: 'xiaoyun',
  en_male: 'xiaogang',
  // 日文发音人
  ja: 'xiaoyun',
  // 其他
  default: 'xiaoyun',
};

// 音频队列项
interface AudioQueueItem {
  id: string;
  text: string;
  audioUrl?: string;
  audioData?: ArrayBuffer;
  status: 'pending' | 'synthesizing' | 'ready' | 'playing' | 'completed' | 'error';
  error?: string;
  params: TTSParams;
  timestamp: number;
}

// 音频队列管理器
class AudioQueueManager {
  private queue: AudioQueueItem[] = [];
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private maxConcurrentSynthesis: number = 3;
  private synthesizingCount: number = 0;
  private onPlaybackStart?: () => void;
  private onPlaybackEnd?: () => void;
  private prefetchEnabled: boolean = true;
  private lastPlaybackTime: number = 0;
  private playbackGap: number = 100; // 播放间隔 100ms

  /**
   * 设置播放回调
   */
  setPlaybackCallbacks(onStart?: () => void, onEnd?: () => void): void {
    this.onPlaybackStart = onStart;
    this.onPlaybackEnd = onEnd;
  }

  /**
   * 设置预取开关
   */
  setPrefetch(enabled: boolean): void {
    this.prefetchEnabled = enabled;
  }

  /**
   * 设置播放间隔
   */
  setPlaybackGap(gapMs: number): void {
    this.playbackGap = gapMs;
  }

  /**
   * 添加音频到队列
   */
  add(item: AudioQueueItem): void {
    this.queue.push(item);
    this.processQueue();
  }

  /**
   * 批量添加
   */
  addBatch(items: AudioQueueItem[]): void {
    items.forEach(item => this.queue.push(item));
    this.processQueue();
  }

  /**
   * 处理队列（合成待处理的音频）
   */
  private processQueue(): void {
    const pendingItems = this.queue.filter(item => item.status === 'pending');

    while (this.synthesizingCount < this.maxConcurrentSynthesis && pendingItems.length > 0) {
      const item = pendingItems.shift();
      if (item) {
        item.status = 'synthesizing';
        this.synthesizingCount++;
      }
    }
  }

  /**
   * 获取下一个待播放的音频
   */
  getNext(): AudioQueueItem | null {
    const readyItems = this.queue.filter(item => item.status === 'ready');
    if (readyItems.length > 0) {
      return readyItems[0];
    }
    return null;
  }

  /**
   * 播放音频
   */
  async play(item: AudioQueueItem): Promise<void> {
    if (!item.audioData) {
      throw new Error('音频数据未准备好');
    }

    // 检查播放间隔，确保流畅性
    const now = Date.now();
    const elapsed = now - this.lastPlaybackTime;
    if (elapsed < this.playbackGap) {
      await new Promise(resolve => setTimeout(resolve, this.playbackGap - elapsed));
    }

    // 初始化 AudioContext
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    // 触发播放开始回调（用于混音器降低原音频）
    if (this.onPlaybackStart) {
      this.onPlaybackStart();
    }

    // 解码音频数据
    const audioBuffer = await this.audioContext.decodeAudioData(item.audioData);

    // 创建音频源
    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = audioBuffer;
    this.currentSource.connect(this.audioContext.destination);

    // 播放
    this.isPlaying = true;
    item.status = 'playing';
    this.lastPlaybackTime = Date.now();
    this.currentSource.start(0);

    console.log(`[TTSQueue] 开始播放: "${item.text.slice(0, 30)}..."`);

    // 播放结束回调
    this.currentSource.onended = () => {
      item.status = 'completed';
      this.isPlaying = false;
      this.currentSource = null;

      // 触发播放结束回调（用于混音器恢复原音频）
      if (this.onPlaybackEnd) {
        this.onPlaybackEnd();
      }

      this.playNext();
    };
  }

  /**
   * 播放下一个
   */
  private playNext(): void {
    const nextItem = this.getNext();
    if (nextItem) {
      this.play(nextItem);
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
    }
    this.isPlaying = false;
  }

  /**
   * 暂停
   */
  pause(): void {
    if (this.audioContext && this.isPlaying) {
      this.audioContext.suspend();
    }
  }

  /**
   * 继续
   */
  resume(): void {
    if (this.audioContext && this.isPlaying) {
      this.audioContext.resume();
    }
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.stop();
    this.queue = [];
    this.currentIndex = 0;
    this.synthesizingCount = 0;
  }

  /**
   * 获取队列状态
   */
  getStatus(): {
    queueLength: number;
    pendingCount: number;
    readyCount: number;
    playingCount: number;
    completedCount: number;
    errorCount: number;
    isPlaying: boolean;
  } {
    return {
      queueLength: this.queue.length,
      pendingCount: this.queue.filter(i => i.status === 'pending').length,
      readyCount: this.queue.filter(i => i.status === 'ready').length,
      playingCount: this.queue.filter(i => i.status === 'playing').length,
      completedCount: this.queue.filter(i => i.status === 'completed').length,
      errorCount: this.queue.filter(i => i.status === 'error').length,
      isPlaying: this.isPlaying,
    };
  }

  /**
   * 标记合成完成
   */
  markSynthesisComplete(item: AudioQueueItem, audioData: ArrayBuffer): void {
    item.audioData = audioData;
    item.status = 'ready';
    this.synthesizingCount--;
    this.processQueue();

    // 如果没有正在播放的，自动开始播放
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * 标记合成失败
   */
  markSynthesisError(item: AudioQueueItem, error: string): void {
    item.status = 'error';
    item.error = error;
    this.synthesizingCount--;
    this.processQueue();
  }
}

// 全局队列管理器
const audioQueue = new AudioQueueManager();

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
 * 合成单条语音
 */
export async function synthesizeSingle(
  config: AliyunConfig,
  params: TTSParams
): Promise<{ taskId: string; audioUrl?: string }> {
  const requestParams: Record<string, string> = {
    Text: params.text,
    Voice: params.voice || VOICE_MAP.default,
    SpeechSpeed: String(params.speed || 0),
    Volume: String(params.volume || 50),
    PitchRate: String(params.pitch || 0),
    Format: params.format || 'wav',
    SampleRate: String(params.sampleRate || 16000),
    EnableSubtitle: 'false',
  };

  const url = await buildRequestUrl(config, ACTION_TTS, requestParams);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Code !== '200') {
      throw new Error(parseTTSError(data.Code, data.Message));
    }

    console.log(`[AliyunTTS] 合成任务创建成功: taskId=${data.Data?.TaskId}`);

    return {
      taskId: data.Data?.TaskId || '',
      audioUrl: data.Data?.AudioUrl,
    };
  } catch (err) {
    console.error('[AliyunTTS] 合成请求失败:', err);
    throw err;
  }
}

/**
 * 获取合成结果
 */
export async function getSynthesizeResult(
  config: AliyunConfig,
  taskId: string
): Promise<{ status: string; audioUrl?: string; audioData?: ArrayBuffer }> {
  const url = await buildRequestUrl(config, 'GetSynthesizeResult', { TaskId: taskId });

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Code !== '200') {
      throw new Error(parseTTSError(data.Code, data.Message));
    }

    const status = data.Data?.Status || 'pending';

    if (status === 'completed' && data.Data?.AudioUrl) {
      // 下载音频数据
      const audioResponse = await fetch(data.Data.AudioUrl);
      const audioData = await audioResponse.arrayBuffer();

      return {
        status: 'completed',
        audioUrl: data.Data.AudioUrl,
        audioData,
      };
    }

    return { status };
  } catch (err) {
    console.error('[AliyunTTS] 获取结果失败:', err);
    throw err;
  }
}

/**
 * 等待合成完成
 */
export async function waitForSynthesis(
  config: AliyunConfig,
  taskId: string,
  maxWaitTime: number = 30000
): Promise<ArrayBuffer> {
  const startTime = Date.now();
  const pollInterval = 500; // 500ms轮询间隔

  while (Date.now() - startTime < maxWaitTime) {
    const result = await getSynthesizeResult(config, taskId);

    if (result.status === 'completed' && result.audioData) {
      return result.audioData;
    }

    if (result.status === 'failed') {
      throw new Error('语音合成失败');
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('语音合成超时');
}

/**
 * 解析 TTS 错误
 */
function parseTTSError(code: string, message?: string): string {
  const errorMap: Record<string, string> = {
    '100': '参数错误',
    '101': '文本过长（最大500字符）',
    '102': '文本内容不合法',
    '103': '发音人不支持',
    '104': '语速参数错误',
    '105': '音量参数错误',
    '106': '语调参数错误',
    '107': '音频格式不支持',
    '108': '采样率不支持',
    'InvalidAccessKeyId.NotFound': 'AccessKeyId不存在',
    'SignatureDoesNotMatch': '签名验证失败',
    'ServiceUnavailable': '服务暂时不可用',
    'InternalError': '服务器内部错误',
    'Throttling': '请求被限流',
  };

  return errorMap[code] || message || `语音合成失败 (Code: ${code})`;
}

/**
 * 添加到播放队列
 */
export function addToPlayQueue(
  text: string,
  params?: Partial<TTSParams>
): AudioQueueItem {
  const item: AudioQueueItem = {
    id: `tts_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    text,
    status: 'pending',
    params: {
      text,
      voice: params?.voice || VOICE_MAP.default,
      speed: params?.speed || 0,
      volume: params?.volume || 50,
      pitch: params?.pitch || 0,
      format: params?.format || 'wav',
      sampleRate: params?.sampleRate || 16000,
    },
    timestamp: Date.now(),
  };

  audioQueue.add(item);
  return item;
}

/**
 * 批量添加到队列
 */
export function addBatchToQueue(
  texts: string[],
  params?: Partial<TTSParams>
): AudioQueueItem[] {
  const items: AudioQueueItem[] = texts.map(text => ({
    id: `tts_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    text,
    status: 'pending' as const,
    params: {
      text,
      voice: params?.voice || VOICE_MAP.default,
      speed: params?.speed || 0,
      volume: params?.volume || 50,
      pitch: params?.pitch || 0,
      format: params?.format || 'wav',
      sampleRate: params?.sampleRate || 16000,
    },
    timestamp: Date.now(),
  }));

  audioQueue.addBatch(items);
  return items;
}

/**
 * 获取队列状态
 */
export function getQueueStatus() {
  return audioQueue.getStatus();
}

/**
 * 停止播放
 */
export function stopPlayback(): void {
  audioQueue.stop();
}

/**
 * 暂停播放
 */
export function pausePlayback(): void {
  audioQueue.pause();
}

/**
 * 继续播放
 */
export function resumePlayback(): void {
  audioQueue.resume();
}

/**
 * 清空队列
 */
export function clearQueue(): void {
  audioQueue.clear();
}

/**
 * 阿里云 TTS 服务类
 */
export class AliyunTTS {
  private config: AliyunConfig;
  private defaultVoice: string = VOICE_MAP.default;
  private defaultSpeed: number = 0;
  private defaultVolume: number = 50;
  private defaultPitch: number = 0;

  constructor(config: AliyunConfig) {
    this.config = config;
  }

  /**
   * 设置默认发音人
   */
  setVoice(voice: string): void {
    this.defaultVoice = voice;
  }

  /**
   * 设置语速 (-500 ~ 500)
   */
  setSpeed(speed: number): void {
    this.defaultSpeed = Math.max(-500, Math.min(500, speed));
  }

  /**
   * 设置音量 (0 ~ 100)
   */
  setVolume(volume: number): void {
    this.defaultVolume = Math.max(0, Math.min(100, volume));
  }

  /**
   * 设置语调 (-500 ~ 500)
   */
  setPitch(pitch: number): void {
    this.defaultPitch = Math.max(-500, Math.min(500, pitch));
  }

  /**
   * 合成并播放
   */
  async speak(text: string): Promise<void> {
    const item = addToPlayQueue(text, {
      voice: this.defaultVoice,
      speed: this.defaultSpeed,
      volume: this.defaultVolume,
      pitch: this.defaultPitch,
    });

    try {
      const { taskId } = await synthesizeSingle(this.config, item.params);
      const audioData = await waitForSynthesis(this.config, taskId);
      audioQueue.markSynthesisComplete(item, audioData);
    } catch (err) {
      audioQueue.markSynthesisError(item, err instanceof Error ? err.message : '合成失败');
      throw err;
    }
  }

  /**
   * 批量合成
   */
  async speakBatch(texts: string[]): Promise<void> {
    const items = addBatchToQueue(texts, {
      voice: this.defaultVoice,
      speed: this.defaultSpeed,
      volume: this.defaultVolume,
      pitch: this.defaultPitch,
    });

    // 并发合成（最多3个）
    const batchSize = 3;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        try {
          const { taskId } = await synthesizeSingle(this.config, item.params);
          const audioData = await waitForSynthesis(this.config, taskId);
          audioQueue.markSynthesisComplete(item, audioData);
        } catch (err) {
          audioQueue.markSynthesisError(item, err instanceof Error ? err.message : '合成失败');
        }
      }));
    }
  }

  /**
   * 停止
   */
  stop(): void {
    stopPlayback();
  }

  /**
   * 暂停
   */
  pause(): void {
    pausePlayback();
  }

  /**
   * 继续
   */
  resume(): void {
    resumePlayback();
  }

  /**
   * 清空
   */
  clear(): void {
    clearQueue();
  }

  /**
   * 获取状态
   */
  getStatus() {
    return getQueueStatus();
  }
}

/**
 * 发音人列表
 */
export const AVAILABLE_VOICES = [
  { id: 'xiaoyun', name: '小云（女声）', languages: ['zh', 'en'] },
  { id: 'xiaogang', name: '小刚（男声）', languages: ['zh', 'en'] },
  { id: 'xiaomei', name: '小美（台湾女声）', languages: ['zh-tw'] },
  { id: 'xiaoxue', name: '小雪（温柔女声）', languages: ['zh'] },
  { id: 'xiaobei', name: '小北（知性女声）', languages: ['zh'] },
  { id: 'siyue', name: '思悦（客服女声）', languages: ['zh'] },
  { id: 'aiqi', name: '艾琪（温柔女声）', languages: ['zh'] },
  { id: 'aijia', name: '艾佳（标准女声）', languages: ['zh'] },
  { id: 'aicheng', name: '艾诚（新闻男声）', languages: ['zh'] },
  { id: 'aida', name: '艾达（新闻女声）', languages: ['zh'] },
];

/**
 * 错误码映射
 */
export const TTS_ERROR_CODES: Record<string, string> = {
  '100': '参数错误',
  '101': '文本过长',
  '102': '文本内容不合法',
  '103': '发音人不支持',
  '104': '语速参数错误',
  '105': '音量参数错误',
  '106': '语调参数错误',
  '107': '音频格式不支持',
  '108': '采样率不支持',
  'InvalidAccessKeyId.NotFound': 'AccessKeyId不存在',
  'SignatureDoesNotMatch': '签名验证失败',
  'ServiceUnavailable': '服务暂时不可用',
  'InternalError': '服务器内部错误',
};