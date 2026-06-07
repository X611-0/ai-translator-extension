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
  private readonly CONNECT_TIMEOUT = 15000; // 增加到15秒

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
    console.log('[XFYun] 开始连接..., 当前状态: ws=', !!this.ws, 'isConnected=', this.isConnected, 'readyState=', this.ws ? this.ws.readyState : 'N/A');

    if (this.ws && (this.isConnected || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[XFYun] WebSocket已在连接中');
      return;
    }

    // 清理旧连接
    if (this.ws) {
      console.log('[XFYun] 清理旧的WebSocket连接');
      try {
        this.ws.close();
      } catch (e) {
        console.warn('[XFYun] 关闭旧连接失败:', e);
      }
      this.ws = null;
    }

    // 验证配置
    const validation = XFYunRecognition.validateConfig(this.config);
    if (!validation.valid) {
      const err = new Error(validation.errors.join(', '));
      console.error('[XFYun] 配置验证失败:', validation.errors);
      this.events.onError?.(RecognitionError.INVALID_CONFIG, err.message);
      throw err;
    }

    console.log('[XFYun] 配置验证通过, appId:', this.config.appId);

    return new Promise(async (resolve, reject) => {
      try {
        console.log('[XFYun] 构建WebSocket URL...');
        const url = await buildWebSocketUrl(
          this.config.appId,
          this.config.apiKey,
          this.config.apiSecret
        );

        console.log('[XFYun] WebSocket URL:', url.substring(0, 100) + '...');

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        console.log('[XFYun] WebSocket 创建完成, readyState:', this.ws.readyState);

        this.ws.onopen = () => {
          console.log('[XFYun] WebSocket已连接, readyState:', this.ws?.readyState);
          this.isConnected = true;
          this.isClosing = false;
          this.reconnectAttempts = 0;
          this.segmentId = 0;
          this.sessionStartTime = Date.now();
          this.stats.startTime = this.sessionStartTime;
          this.startHeartbeat();
          this.events.onConnect?.();

          // 立即发送第一帧（first=true, status=0, 包含音频参数）
          this.sendFirstFrame();

          this.flushAudioQueue();
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          console.log('[XFYun] 收到消息, type:', typeof event.data, 'data:', typeof event.data === 'string' ? event.data.substring(0, 200) : event.data);
          this.handleMessage(event.data);
        };

        this.ws.onerror = (event: Event) => {
          console.error('[XFYun] WebSocket错误:', event, 'readyState:', this.ws?.readyState);
          this.stats.errorCount++;
          this.events.onError?.(RecognitionError.CONNECTION_FAILED, 'WebSocket连接失败');
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.log('[XFYun] WebSocket关闭, code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
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
            console.error('[XFYun] 连接超时');
            this.ws?.close();
            this.ws = null;
            this.stats.errorCount++;
            this.events.onError?.(RecognitionError.TIMEOUT, '连接超时');
            reject(new Error('连接超时'));
          }
        }, this.CONNECT_TIMEOUT);
      } catch (err) {
        console.error('[XFYun] 连接异常:', err);
        this.stats.errorCount++;
        reject(err);
      }
    });
  }

  /**
   * 发送音频数据
   */
  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    console.log('[XFYun] sendAudio 调用, byteLength:', audioData.byteLength, 'ws状态:', {
      hasWs: !!this.ws,
      isConnected: this.isConnected,
      readyState: this.ws ? this.ws.readyState : 'N/A',
      queueLength: this.audioQueue.length,
    });

    // 如果 WebSocket 未初始化，先连接
    if (!this.ws) {
      console.log('[XFYun] WebSocket未初始化，开始连接...');
      try {
        await this.connect();
      } catch (err) {
        console.error('[XFYun] 连接失败:', err);
        return;
      }
      // 连接后再次检查
      if (!this.ws) {
        console.error('[XFYun] 连接后 ws 仍为空');
        return;
      }
    }

    this.stats.totalFrames++;
    this.stats.totalBytes += audioData.byteLength;

    if (!this.isConnected || !this.ws) {
      console.warn('[XFYun] 未连接，将音频放入队列 (isConnected:', this.isConnected, ', ws:', !!this.ws, ')');
      this.audioQueue.push(audioData);
      return;
    }

    const ws = this.ws; // 保存引用，避免 TypeScript 类型问题
    if (ws.readyState !== WebSocket.OPEN) {
      console.warn('[XFYun] WebSocket未就绪，当前状态:', ws.readyState, '将音频放入队列');
      this.audioQueue.push(audioData);
      return;
    }

    const base64 = arrayBufferToBase64(audioData);
    // 中间帧：status=1
    const frame = {
      data: {
        status: 1,
        format: 'audio/L16;rate=16000',
        audio: base64,
        encoding: 'raw',
      },
    };

    try {
      ws.send(JSON.stringify(frame));
      console.log('[XFYun] 已发送音频帧, byteLength:', audioData.byteLength);
    } catch (err) {
      console.error('[XFYun] 发送音频失败:', err);
      this.audioQueue.push(audioData);
    }
  }

  /**
   * 发送第一帧
   */
  private sendFirstFrame(): void {
    console.log('[XFYun] sendFirstFrame 调用, ws:', !!this.ws);
    if (!this.ws) {
      console.error('[XFYun] sendFirstFrame: ws 为空');
      return;
    }

    // 讯飞 IAT v2 第一帧格式：
    // - common: 包含 app_id
    // - business: 包含业务参数
    // - data: 包含音频参数（status=0 表示第一帧）
    // 语言设置：默认英文，可通过配置切换
    const language = this.config.language || 'en_us';
    console.log('[XFYun] 识别语言:', language);

    const firstFrame = {
      common: {
        app_id: this.config.appId,
      },
      business: {
        domain: 'iat',
        language: language, // en_us=英文, zh_cn=中文
        accent: language === 'en_us' ? '' : 'mandarin',
        vad_eos: 3000, // 静音检测超时时间（ms），3秒静音后发送最终结果
        dwa: 'wpgs', // 动态修正
        ptt: 0, // 0=不添加标点, 1=添加标点（必须是整数）
      },
      data: {
        status: 0,
        format: 'audio/L16;rate=16000',
        audio: '',
        encoding: 'raw',
      },
    };

    const frameStr = JSON.stringify(firstFrame);
    console.log('[XFYun] 第一帧内容:', frameStr.substring(0, 200));

    try {
      this.ws.send(frameStr);
      console.log('[XFYun] 已发送第一帧（status=0, app_id:', this.config.appId, '）');
    } catch (err) {
      console.error('[XFYun] 发送第一帧失败:', err);
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
      const pgs = result.pgs; // 修正类型：apd=追加, rpl=替换
      const rg = result.rg;   // 替换范围

      // 提取识别文本
      const text = this.extractText(result);
      const now = Date.now();
      const isEnd = status === 2;
      const isPartial = status === 1;
      const isCorrection = pgs === 'rpl'; // 是否是修正结果

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

      // 修正结果不增加 segmentId，保持与原句相同的 ID
      if (!isCorrection) {
        this.segmentId++;
      }

      // 构造结果
      const recognitionResult: RecognitionResult = {
        text,
        isEnd,
        isPartial,
        segmentId: isCorrection ? this.segmentId : this.segmentId,
        timestamp: now,
        latency,
        sn,
        pgs,
        rg,
        isCorrection,
      };

      // 触发回调
      this.callback?.(recognitionResult);

      if (isCorrection) {
        console.log('[XFYun] 检测到修正:', { sn, pgs, rg, text });
      }

      if (isPartial && !isCorrection) {
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
