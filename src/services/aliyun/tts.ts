/**
 * 阿里云 NLS 语音合成（WebSocket API）
 * 流程: 获取 Token → WebSocket 连接 → 发送合成参数 → 接收音频 → 播放
 */

import { AliyunConfig } from '@/types';

// API 配置
// 阿里云智能语音交互 域名（就近接入）
// Token: 管控 API，上海端点
const TOKEN_ENDPOINT = 'https://nls-meta.cn-shanghai.aliyuncs.com/';
// WebSocket: 智能就近接入
const WS_ENDPOINT = 'wss://nls-gateway.aliyuncs.com/ws/v1';

// 音频队列
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isPlaying = false;
let audioQueue: ArrayBuffer[] = [];
let onPlayEnd: (() => void) | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: 16000 });
  }
  return audioContext;
}

function playNextChunk(): void {
  if (isPlaying || audioQueue.length === 0) return;
  const chunk = audioQueue.shift()!;
  isPlaying = true;

  const ctx = getAudioContext();
  ctx.decodeAudioData(chunk.slice(0), (buffer) => {
    currentSource = ctx.createBufferSource();
    currentSource.buffer = buffer;
    currentSource.connect(ctx.destination);
    currentSource.onended = () => {
      isPlaying = false;
      currentSource = null;
      if (audioQueue.length > 0) {
        playNextChunk();
      } else {
        onPlayEnd?.();
      }
    };
    currentSource.start(0);
  }, () => {
    isPlaying = false;
    playNextChunk();
  });
}

// ========== Token 获取 ==========

async function fetchToken(config: AliyunConfig): Promise<string> {
  const timestamp = new Date().toISOString().replace(/\.\d{3}/, '');
  const nonce = Math.random().toString(36).substring(2);

  const params: Record<string, string> = {
    AccessKeyId: config.accessKeyId,
    Action: 'CreateToken',
    Version: '2019-02-28',
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    Timestamp: timestamp,
  };

  // HMAC-SHA1 签名
  const sortedKeys = Object.keys(params).sort();
  const canonicalized = sortedKeys
    .map(k => encodeURIComponent(k).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + '=' +
                encodeURIComponent(params[k]).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('&');
  const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalized)}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(config.accessKeySecret + '&'),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  params.Signature = signature;
  const queryString = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const url = `${TOKEN_ENDPOINT}?${queryString}`;

  console.log('[AliyunTTS] 获取 Token...');
  const response = await fetch(url);
  const data = await response.json();

  if (data.Code !== '200' || !data.Data?.Token) {
    throw new Error(`Token 获取失败: ${data.Code} ${data.Message || ''}`);
  }

  console.log('[AliyunTTS] Token 获取成功, 有效期:', data.Data.ExpireTime);
  return data.Data.Token;
}

// ========== WebSocket TTS ==========

async function synthesizeViaWebSocket(
  config: AliyunConfig,
  text: string,
  voice: string,
  format: string,
  sampleRate: number,
  speechRate: number,
  volume: number,
): Promise<ArrayBuffer[]> {
  const appKey = config.ttsAppKey;
  if (!appKey) throw new Error('缺少 TTS AppKey');

  // 1. 获取 Token
  const token = await fetchToken(config);

  // 2. WebSocket 连接
  const wsUrl = `${WS_ENDPOINT}?token=${token}`;
  console.log('[AliyunTTS] 连接 WebSocket...');

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  const audioChunks: ArrayBuffer[] = [];
  let taskId = '';

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('TTS WebSocket 超时'));
    }, 30000);

    ws.onopen = () => {
      console.log('[AliyunTTS] WebSocket 已连接，发送合成请求...');
      // 发送合成参数
      const request: any = {
        header: {
          message_id: Date.now().toString(36) + Math.random().toString(36).substring(2),
          task_id: Date.now().toString(36) + Math.random().toString(36).substring(2),
          namespace: 'SpeechSynthesizer',
          name: 'StartSynthesis',
          appkey: appKey,
        },
        payload: {
          voice,
          text,
          format,
          sample_rate: sampleRate,
          volume,
          speech_rate: speechRate,
          enable_subtitle: false,
        },
      };
      ws.send(JSON.stringify(request));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // 音频数据
        audioChunks.push(event.data);
        return;
      }

      // JSON 状态消息
      try {
        const msg = JSON.parse(event.data as string);
        const header = msg.header;
        const name = header?.name;

        if (name === 'TaskFailed') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`TTS 合成失败: ${header?.status_text || header?.status}`));
        } else if (name === 'SynthesisCompleted') {
          clearTimeout(timeout);
          taskId = header?.task_id || '';
          console.log('[AliyunTTS] 合成完成, 共', audioChunks.length, '个音频块');
          ws.close();
          resolve();
        }
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('TTS WebSocket 连接失败'));
    };

    ws.onclose = (event) => {
      if (event.code !== 1000 && audioChunks.length === 0) {
        clearTimeout(timeout);
        reject(new Error(`TTS WebSocket 异常关闭: ${event.code}`));
      }
    };
  });

  return audioChunks;
}

// ========== 公开 API ==========

export function setPlayEndCallback(cb: (() => void) | null): void {
  onPlayEnd = cb;
}

export function stopPlayback(): void {
  if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource = null;
  }
  isPlaying = false;
  audioQueue = [];
}

export function clearQueue(): void {
  audioQueue = [];
}

export class AliyunTTS {
  private config: AliyunConfig;
  private appKey: string;
  private voice: string = 'xiaoyun';
  private format: string = 'wav';
  private sampleRate: number = 16000;
  private speechRate: number = 0;
  private volume: number = 50;

  constructor(config: AliyunConfig) {
    this.config = config;
    this.appKey = config.ttsAppKey || '';
    if (!this.appKey) {
      console.warn('[AliyunTTS] 未配置 ttsAppKey，TTS 不可用');
    }
  }

  setVoice(voice: string): void { this.voice = voice; }
  setSpeed(speed: number): void { this.speechRate = Math.max(-500, Math.min(500, speed)); }
  setVolume(vol: number): void { this.volume = Math.max(0, Math.min(100, vol)); }

  async speak(text: string): Promise<void> {
    if (!this.appKey) throw new Error('TTS AppKey 未配置');

    const chunks = await synthesizeViaWebSocket(
      this.config, text, this.voice, this.format,
      this.sampleRate, this.speechRate, this.volume,
    );

    if (chunks.length === 0) {
      console.warn('[AliyunTTS] 未收到音频数据');
      return;
    }

    // 合并所有音频块并加入播放队列
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    audioQueue.push(merged.buffer);
    playNextChunk();
  }

  async speakBatch(texts: string[]): Promise<void> {
    for (const text of texts) {
      if (!text.trim()) continue;
      try {
        await this.speak(text);
      } catch (err) {
        console.error('[AliyunTTS] 批量合成失败:', err);
      }
    }
  }

  stop(): void { stopPlayback(); }
  clear(): void { clearQueue(); }
}
