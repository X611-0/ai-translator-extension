/**
 * 讯飞语音识别服务
 * 基于WebSocket的实时流式语音识别
 * 支持中间结果、最终结果、延迟统计、错误处理
 */

import { XFYunConfig, XFYunResponse, RecognitionResult } from '@/types';
import { arrayBufferToBase64, buildWebSocketUrl } from './websocket';

export type RecognitionCallback = (result: RecognitionResult) => void;

export enum RecognitionError {
  NOT_CONNECTED = 'NOT_CONNECTED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  AUTH_FAILED = 'AUTH_FAILED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  SERVER_ERROR = 'SERVER_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_CONFIG = 'INVALID_CONFIG',
  UNKNOWN = 'UNKNOWN',
}

export interface RecognitionEvents {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: RecognitionError, message: string) => void;
  onResult?: RecognitionCallback;
  onPartialResult?: RecognitionCallback;     // 中间结果
  onFinalResult?: RecognitionCallback;       // 最终结果
}

export interface RecognitionStats {
  totalFrames: number;        // 发送的总帧数
  totalBytes: number;          // 发送的总字节数
  totalResults: number;        // 收到结果数
  averageLatency: number;      // 平均延迟
  lastLatency: number;         // 最近延迟
  errorCount: number;          // 错误数
  startTime: number | null;    // 会话开始时间
}

export class XFYunRecognition {
  private config: XFYunConfig;
  private ws: WebSocket | null = null;
  private callback: RecognitionCallback | null = null;
  private events: RecognitionEvents = {};
  private segmentId = 0;
  private isConnected = false;
  private isClosing = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private sessionStartTime = 0;
  private readonly WS_URL = 'wss://iat-api.xfyun.cn/v2/iat';
  private readonly RECONNECT_DELAY = 3000;
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly CONNECT_TIMEOUT = 10000;

  private stats: RecognitionStats = {
    totalFrames: 0,
    totalBytes: 0,
    totalResults: 0,
    averageLatency: 0,
    lastLatency: 0,
    errorCount: 0,
    startTime: null,
  };

  // 跟踪当前句子的中间结果
  private currentSegment: {
    sn: number;
    text: string;
    lastUpdate: number;
    audioStartTime: number;
  } | null = null;

  constructor(config: XFYunConfig) {
    this.config = config;
  }

  /**
   * 验证配置
   */
  static validateConfig(config: XFYunConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!config.appId?.trim()) errors.push('AppID 不能为空');
    if (!config.apiKey?.trim()) errors.push('APIKey 不能为空');
    if (!config.apiSecret?.trim()) errors.push('APISecret 不能为空');
    if (config.appId && !/^[a-f0-9]{8,}$/i.test(config.appId.trim())) {
      errors.push('AppID 格式不正确');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * 连接服务器
   */
  async connect(): Promise<void> {
    if (this.ws && (this.isConnected || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[XFYun] WebSocket已在连接中');
      return;
    }

    // 验证配置
    const validation = XFYunRecognition.validateConfig(this.config);
    if (!validation.valid) {
      const err = new Error(validation.errors.join(', '));
      this.events.onError?.(RecognitionError.INVALID_CONFIG, err.message);
      throw err;
    }

    return new Promise(async (resolve, reject) => {
      try {
        const url = await buildWebSocketUrl(
          this.config.appId,
          this.config.apiKey,
          this.config.apiSecret
        );

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[XFYun] WebSocket已连接');
          this.isConnected = true;
          this.isClosing = false;
          this.reconnectAttempts = 0;
          this.segmentId = 0;
          this.sessionStartTime = Date.now();
          this.stats.startTime = this.sessionStartTime;
          this.startHeartbeat();
          this.events.onConnect?.();
          this.flushAudioQueue();
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (event: Event) => {
          console.error('[XFYun] WebSocket错误:', event);
          this.stats.errorCount++;
          this.events.onError?.(RecognitionError.CONNECTION_FAILED, 'WebSocket连接失败');
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.log('[XFYun] WebSocket关闭, code:', event.code, 'reason:', event.reason);
          this.isConnected = false;
          this.stopHeartbeat();
          this.events.onDisconnect?.();

          // 认证失败不重连
          if (event.code === 40001 || event.code === 40002) {
            this.events.onError?.(RecognitionError.AUTH_FAILED, '认证失败，请检查API密钥');
            return;
          }

          // 正常关闭不重连
          if (this.isClosing) {
            return;
          }

          // 自动重连
          this.scheduleReconnect();
        };

        // 连接超时
        setTimeout(() => {
          if (!this.isConnected) {
            this.ws?.close();
            this.stats.errorCount++;
            this.events.onError?.(RecognitionError.TIMEOUT, '连接超时');
            reject(new Error('连接超时'));
          }
        }, this.CONNECT_TIMEOUT);
      } catch (err) {
        this.stats.errorCount++;
        reject(err);
      }
    });
  }

  /**
   * 发送音频数据
   */
  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    if (!this.ws) {
      console.warn('[XFYun] WebSocket未初始化');
      return;
    }

    this.stats.totalFrames++;
    this.stats.totalBytes += audioData.byteLength;

    if (!this.isConnected) {
      this.audioQueue.push(audioData);
      try {
        await this.connect();
      } catch {
        console.warn('[XFYun] 重连失败，音频数据已加入队列');
      }
      return;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[XFYun] WebSocket未就绪，当前状态:', this.ws.readyState);
      this.audioQueue.push(audioData);
      return;
    }

    const base64 = arrayBufferToBase64(audioData);
    const frame = {
      data: {
        status: 1,
        format: 'audio/L16;rate=16000',
        audio: base64,
        encoding: 'raw',
      },
    };

    try {
      this.ws.send(JSON.stringify(frame));
    } catch (err) {
      console.error('[XFYun] 发送音频失败:', err);
      this.audioQueue.push(audioData);
    }
  }

  /**
   * 发送结束帧
   */
  sendEndFrame(): void {
    if (!this.ws || !this.isConnected) return;

    const frame = {
      data: {
        status: 2,
        format: 'audio/L16;rate=16000',
        audio: '',
        encoding: 'raw',
      },
    };

    try {
      this.ws.send(JSON.stringify(frame));
    } catch (err) {
      console.error('[XFYun] 发送结束帧失败:', err);
    }
  }

  /**
   * 注册结果回调
   */
  onResult(callback: RecognitionCallback): void {
    this.callback = callback;
  }

  /**
   * 注册事件监听
   */
  onEvents(events: RecognitionEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.isClosing = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.sendEndFrame();

    if (this.ws) {
      this.ws.close(1000, '正常关闭');
      this.ws = null;
    }

    this.isConnected = false;
    this.audioQueue = [];
    this.currentSegment = null;
    console.log('[XFYun] 连接已关闭');
  }

  /**
   * 获取统计信息
   */
  getStats(): RecognitionStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalFrames: 0,
      totalBytes: 0,
      totalResults: 0,
      averageLatency: 0,
      lastLatency: 0,
      errorCount: 0,
      startTime: this.stats.startTime,
    };
  }

  /**
   * 处理WebSocket消息
   */
  private handleMessage(data: string | ArrayBuffer): void {
    if (data instanceof ArrayBuffer) return;

    try {
      const response: XFYunResponse = JSON.parse(data);

      if (response.code !== 0) {
        console.error('[XFYun] 识别错误:', response.code, response.message);
        this.stats.errorCount++;
        this.handleErrorCode(response.code, response.message);
        return;
      }

      if (!response.data?.result) return;

      const result = response.data.result;
      const status = response.data.status;
      const sn = result.sn;

      // 提取识别文本
      const text = this.extractText(result);
      const now = Date.now();
      const isEnd = status === 2;
      const isPartial = status === 1;

      // 计算延迟
      let latency = 0;
      if (this.currentSegment && this.currentSegment.audioStartTime > 0) {
        latency = now - this.currentSegment.audioStartTime;
        this.updateLatency(latency);
      }

      // 更新当前段落追踪
      if (this.currentSegment === null || (sn !== undefined && this.currentSegment.sn !== sn)) {
        this.currentSegment = {
          sn: sn ?? 0,
          text: '',
          lastUpdate: now,
          audioStartTime: now,
        };
      }

      if (text) {
        this.currentSegment.text = text;
        this.currentSegment.lastUpdate = now;
      }

      this.stats.totalResults++;
      this.segmentId++;

      // 构造结果
      const recognitionResult: RecognitionResult = {
        text,
        isEnd,
        isPartial,
        segmentId: this.segmentId,
        timestamp: now,
        latency,
        sn,
      };

      // 触发回调
      this.callback?.(recognitionResult);

      if (isPartial) {
        this.events.onPartialResult?.(recognitionResult);
      } else if (isEnd) {
        this.events.onFinalResult?.(recognitionResult);
        // 最终结果后重置当前段落
        this.currentSegment = null;
      }
    } catch (err) {
      console.error('[XFYun] 解析消息失败:', err);
      this.stats.errorCount++;
    }
  }

  /**
   * 更新延迟统计
   */
  private updateLatency(latency: number): void {
    this.stats.lastLatency = latency;
    if (this.stats.totalResults === 0) {
      this.stats.averageLatency = latency;
    } else {
      // 指数移动平均
      const alpha = 0.3;
      this.stats.averageLatency =
        alpha * latency + (1 - alpha) * this.stats.averageLatency;
    }
  }

  /**
   * 从识别结果中提取文本
   */
  private extractText(result: XFYunResponse['data']['result']): string {
    if (!result?.ws) return '';
    return result.ws.map((word) => word.cw.map((c) => c.w).join('')).join('');
  }

  /**
   * 处理错误码
   */
  private handleErrorCode(code: number, message: string): void {
    switch (code) {
      case 10005:
      case 10006:
      case 10105:
        this.events.onError?.(RecognitionError.AUTH_FAILED, '认证失败');
        break;
      case 10106:
        this.events.onError?.(RecognitionError.AUTH_FAILED, '时间戳过期');
        break;
      case 10010:
        this.events.onError?.(RecognitionError.QUOTA_EXCEEDED, '服务授权已过期');
        break;
      case 10019:
      case 10020:
      case 10021:
        this.events.onError?.(RecognitionError.QUOTA_EXCEEDED, '试用额度已用完');
        break;
      case 10212:
        this.events.onError?.(RecognitionError.SERVER_ERROR, '音频格式错误');
        break;
      case 20001:
        this.events.onError?.(RecognitionError.SERVER_ERROR, '服务内部错误');
        break;
      case 20002:
        this.events.onError?.(RecognitionError.TIMEOUT, '识别超时');
        break;
      case 20003:
        this.events.onError?.(RecognitionError.SERVER_ERROR, '识别失败');
        break;
      default:
        this.events.onError?.(RecognitionError.UNKNOWN, message || `错误码: ${code}`);
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[XFYun] 达到最大重连次数');
      this.events.onError?.(RecognitionError.CONNECTION_FAILED, '连接失败，请检查网络');
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY * this.reconnectAttempts;

    console.log(`[XFYun] ${delay}ms后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[XFYun] 重连失败:', err);
      });
    }, delay);
  }

  /**
   * 清空音频队列
   */
  private flushAudioQueue(): void {
    if (this.audioQueue.length === 0) return;

    console.log(`[XFYun] 清空音频队列，共${this.audioQueue.length}帧`);
    const queue = [...this.audioQueue];
    this.audioQueue = [];

    queue.forEach((audioData) => {
      this.sendAudio(audioData);
    });
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        try {
          this.ws.send('ping');
        } catch {
          // 忽略心跳失败
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 获取连接状态
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }
}
