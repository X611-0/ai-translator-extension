/**
 * 讯飞语音识别服务
 * 基于WebSocket的实时流式语音识别
 */

import { XFYunConfig, XFYunResponse } from '@/types';
import { arrayBufferToBase64 } from './websocket';

type RecognitionCallback = (result: {
  text: string;
  isEnd: boolean;
  segmentId: number;
}) => void;

export class XFYunRecognition {
  private config: XFYunConfig;
  private ws: WebSocket | null = null;
  private callback: RecognitionCallback | null = null;
  private segmentId = 0;
  private isConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  private readonly WS_URL = 'wss://iat-api.xfyun.cn/v2/iat';

  constructor(config: XFYunConfig) {
    this.config = config;
    this.connect();
  }

  /**
   * 建立WebSocket连接
   */
  private connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    const url = this.buildUrl();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[XFYun] WebSocket已连接');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.segmentId = 0;

      // 发送开始帧
      this.sendStartFrame();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error: Event) => {
      console.error('[XFYun] WebSocket错误:', error);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.isConnected = false;
      console.log('[XFYun] WebSocket已关闭, code:', event.code);

      // 自动重连
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectAttempts++;
          console.log(`[XFYun] 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          this.connect();
        }, 2000 * this.reconnectAttempts);
      }
    };
  }

  /**
   * 发送音频数据
   */
  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    if (!this.isConnected || !this.ws) {
      console.warn('[XFYun] WebSocket未连接，跳过发送');
      return;
    }

    const base64 = arrayBufferToBase64(audioData);
    const frame = {
      data: {
        status: 1, // 1=继续
        format: 'audio/L16;rate=16000',
        audio: base64,
        encoding: 'raw',
      },
    };

    this.ws.send(JSON.stringify(frame));
  }

  /**
   * 注册识别结果回调
   */
  onResult(callback: RecognitionCallback): void {
    this.callback = callback;
  }

  /**
   * 发送结束帧
   */
  private sendEndFrame(): void {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(JSON.stringify({
      data: {
        status: 2, // 2=结束
        format: 'audio/L16;rate=16000',
        audio: '',
        encoding: 'raw',
      },
    }));
  }

  /**
   * 发送开始帧
   */
  private sendStartFrame(): void {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(JSON.stringify({
      data: {
        status: 0, // 0=开始
        format: 'audio/L16;rate=16000',
        audio: '',
        encoding: 'raw',
      },
    }));
  }

  /**
   * 处理WebSocket消息
   */
  private handleMessage(data: string): void {
    try {
      const response: XFYunResponse = JSON.parse(data);

      if (response.code !== 0) {
        console.error('[XFYun] 识别错误:', response.code, response.message);
        return;
      }

      if (!response.data?.result) return;

      const result = response.data.result;
      const status = response.data.status;

      // 提取识别文本
      const text = this.extractText(result);
      const isEnd = status === 2; // status=2表示最终结果

      if (text && this.callback) {
        this.segmentId++;
        this.callback({
          text,
          isEnd,
          segmentId: this.segmentId,
        });
      }
    } catch (err) {
      console.error('[XFYun] 解析消息失败:', err);
    }
  }

  /**
   * 从识别结果中提取文本
   */
  private extractText(result: XFYunResponse['data']['result']): string {
    if (!result?.ws) return '';
    return result.ws
      .map((word) => word.cw.map((c) => c.w).join(''))
      .join('');
  }

  /**
   * 构建WebSocket URL
   */
  private buildUrl(): string {
    const host = 'iat-api.xfyun.cn';
    const date = new Date().toUTCString();
    const path = '/v2/iat';

    // 简单签名处理（实际生产需要完整的HMAC-SHA256签名）
    const params = new URLSearchParams({
      host,
      date,
      appid: this.config.appId,
      apikey: this.config.apiKey,
    });

    return `${this.WS_URL}?${params.toString()}`;
  }

  /**
   * 关闭连接
   */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.sendEndFrame();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }
}