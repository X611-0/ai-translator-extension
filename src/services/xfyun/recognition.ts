/**
 * 讯飞实时语音转写服务（AST API v1）
 * 文档: https://www.xfyun.cn/doc/asr/rtasr/API.html
 *
 * WebSocket 直连，握手后发送 PCM16 二进制音频，接收 JSON 转写结果
 */

import { XFYunConfig, RecognitionResult } from '@/types';

export type RecognitionCallback = (result: RecognitionResult) => void;

export interface RecognitionEvents {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string, message: string) => void;
  onResult?: RecognitionCallback;
  onPartialResult?: RecognitionCallback;
  onFinalResult?: RecognitionCallback;
}

export interface RecognitionStats {
  totalFrames: number;
  totalBytes: number;
  totalResults: number;
  averageLatency: number;
  lastLatency: number;
  errorCount: number;
  startTime: number | null;
}

export class XFYunRecognition {
  private config: XFYunConfig & { language?: string };
  private ws: WebSocket | null = null;
  private callback: RecognitionCallback | null = null;
  private events: RecognitionEvents = {};
  private segmentId = 0;
  private isConnected = false;
  private connecting = false;
  private sessionId: string = '';
  private stats: RecognitionStats = {
    totalFrames: 0,
    totalBytes: 0,
    totalResults: 0,
    averageLatency: 0,
    lastLatency: 0,
    errorCount: 0,
    startTime: null,
  };

  private readonly WS_URL = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1';

  constructor(config: XFYunConfig & { language?: string }) {
    this.config = config;
    console.log('[XFYun AST] 初始化, appId:', config.appId, 'language:', config.language);
  }

  /**
   * 生成 UUID v4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 生成 UTC+8 格式的时间字符串
   * 文档格式: 2025-09-04T15:38:07+0800
   */
  private formatUtcTime(): string {
    const now = new Date();
    // 转为 UTC+8 (北京时间)
    const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const iso = utc8.toISOString();
    // toISOString 输出: 2025-06-07T10:30:00.000Z
    // 去掉毫秒和 Z，加上 +0800
    return iso.replace(/\.\d{3}Z$/, '') + '+0800';
  }

  /**
   * 生成 HMAC-SHA1 签名
   * 文档: 参数升序排序 → URL编码 → &拼接 → HmacSHA1 → Base64
   */
  private async generateSignature(params: Record<string, string>): Promise<string> {
    // 1. 按参数名升序排序
    const sortedKeys = Object.keys(params).sort();

    // 2. 对每个参数的键和值分别进行 URL 编码，按 "键=值&" 拼接
    const baseString = sortedKeys
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    console.log('[XFYun AST] 签名 baseString:', baseString);

    // 3. 以 accessKeySecret 为密钥，对 baseString 进行 HmacSHA1 加密
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.config.apiSecret);
    const messageData = encoder.encode(baseString);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);

    // 4. Base64 编码
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    console.log('[XFYun AST] signature:', signatureBase64.substring(0, 20) + '...');

    return signatureBase64;
  }

  /**
   * 构建 WebSocket URL（带鉴权参数）
   */
  private async buildWebSocketUrl(): Promise<string> {
    const uuid = this.generateUUID();
    const utc = this.formatUtcTime();

    const params: Record<string, string> = {
      appId: this.config.appId,
      accessKeyId: this.config.apiKey,
      uuid: uuid,
      utc: utc,
      lang: this.config.language || 'autodialect',
      audio_encode: 'pcm_s16le',
      samplerate: '16000',
    };

    const signature = await this.generateSignature(params);

    // 所有参数（包括 signature）按 key 排序后 URL 编码
    // 打印参数（隐藏敏感信息）
    console.log('[XFYun AST] 请求参数:', {
      appId: params.appId,
      accessKeyId: params.accessKeyId.substring(0, 8) + '...',
      utc: params.utc,
      lang: params.lang,
      audio_encode: params.audio_encode,
      samplerate: params.samplerate,
      uuid: params.uuid,
      signature: signature.substring(0, 10) + '...',
    });

    const allParams: Record<string, string> = { ...params, signature };
    const sortedKeys = Object.keys(allParams).sort();
    const queryString = sortedKeys
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
      .join('&');

    const url = `${this.WS_URL}?${queryString}`;
    console.log('[XFYun AST] 完整 URL (前150字符):', url.substring(0, 150) + '...');

    return url;
  }

  /**
   * 连接服务器
   */
  async connect(): Promise<void> {
    if (this.connecting) {
      console.log('[XFYun AST] 正在连接中，等待...');
      return;
    }
    this.connecting = true;

    try {
      if (this.ws) {
        try { this.ws.close(); } catch {}
        this.ws = null;
      }
      this.isConnected = false;

      console.log('[XFYun AST] 构建连接 URL...');
      const url = await this.buildWebSocketUrl();

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          this.connecting = false;
          reject(new Error('WebSocket 创建失败'));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error('WebSocket 连接超时 (10秒)'));
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          console.log('[XFYun AST] WebSocket 已连接，等待握手响应...');
          this.isConnected = true;
          this.stats.startTime = Date.now();
          this.events.onConnect?.();
          resolve();
        };

        this.ws.onerror = () => {
          clearTimeout(timeout);
          console.error('[XFYun AST] WebSocket 连接失败');
          console.error('[XFYun AST] 可能原因: 1) appId/apiKey/apiSecret 错误 2) 签名算法不正确 3) 网络不通');
          this.isConnected = false;
          this.ws = null;
          this.stats.errorCount++;
          reject(new Error('WebSocket 连接失败，请检查 API 配置'));
        };

        this.ws.onclose = (event) => {
          console.log('[XFYun AST] WebSocket 关闭, code:', event.code, 'reason:', event.reason);
          // 如果是认证失败 (通常 code 4001/4002)
          if (event.code === 4001 || event.code === 4002) {
            console.error('[XFYun AST] 认证失败! 请检查 appId/apiKey/apiSecret');
          }
          this.isConnected = false;
          this.ws = null;
          this.events.onDisconnect?.();
        };

        this.ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            this.handleMessage(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            // 忽略二进制回显
          }
        };
      });
    } catch (err: any) {
      console.error('[XFYun AST] 连接失败:', err.message);
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * 处理收到的 JSON 消息
   * 文档格式:
   *   握手: { action: "started", code: "0", sid: "xxx" }
   *   结果: { msg_type: "result", res_type: "asr", data: { cn: { st: { rt: [...], type: "0" } }, ls: false } }
   *   错误: { msg_type: "result", res_type: "frc", data: { desc: "..." } }
   */
  private handleMessage(data: string): void {
    try {
      const response = JSON.parse(data);
      console.log('[XFYun AST] 收到消息:', JSON.stringify(response).substring(0, 400));

      const action = response.action;
      const msgType = response.msg_type;
      const resType = response.res_type;
      const code = response.code;
      const sid = response.sid;

      // === 握手成功 ===
      if (action === 'started' && code === '0') {
        this.sessionId = sid || '';
        console.log('[XFYun AST] ✅ 握手成功, sessionId:', this.sessionId);
        return;
      }

      // === 错误 (通用格式: action=error 或 res_type=frc) ===
      if (action === 'error' || resType === 'frc') {
        const desc = response.desc || response.data?.desc || '未知错误';
        console.error('[XFYun AST] ❌ 服务端错误:', desc, '完整响应:', JSON.stringify(response));
        this.stats.errorCount++;
        this.events.onError?.(code || 'SERVER_ERROR', desc);
        return;
      }

      // === 转写结果 (msg_type=result, res_type=asr) ===
      if (msgType === 'result' && resType === 'asr') {
        this.parseResult(response);
        return;
      }

      // === 其他未知消息 ===
      console.log('[XFYun AST] 未处理的消息格式:', JSON.stringify(response).substring(0, 200));

    } catch (err) {
      console.error('[XFYun AST] 解析消息失败:', err);
    }
  }

  /**
   * 解析转写结果
   * 文档格式:
   * {
   *   data: {
   *     cn: { st: { rt: [{ ws: [{ cw: [{ w: "文字" }] }] }], type: "0", bg: 930, ed: 2590 } },
   *     ls: false  // true=最终结果
   *   }
   * }
   */
  private parseResult(response: any): void {
    const payload = response.data;
    if (!payload) {
      console.log('[XFYun AST] 结果中无 data 字段');
      return;
    }

    // 检查异常结果 (data.normal === false)
    if (payload.normal === false) {
      console.error('[XFYun AST] 转写异常:', payload.desc || '未知异常');
      this.stats.errorCount++;
      return;
    }

    const cn = payload.cn;
    if (!cn || !cn.st) {
      console.log('[XFYun AST] 结果中无 cn.st 数据');
      return;
    }

    const st = cn.st;
    const typeStr = st.type; // "0"=最终结果, "1"=中间结果
    const isFinal = payload.ls === true;
    const isPartial = typeStr === '1';

    // 提取文本
    const text = this.extractText(st);
    if (!text) {
      return;
    }

    this.stats.totalResults++;
    const latency = Date.now() - (this.stats.startTime || Date.now());
    this.stats.lastLatency = latency;
    this.stats.averageLatency =
      (this.stats.averageLatency * (this.stats.totalResults - 1) + latency) /
      this.stats.totalResults;

    const result: RecognitionResult = {
      text,
      isEnd: isFinal,
      isPartial,
      segmentId: this.segmentId,
      timestamp: Date.now(),
      latency,
    };

    console.log('[XFYun AST] 📝 转写:', text.substring(0, 60), isPartial ? '(中间)' : isFinal ? '(最终)' : '');

    this.callback?.(result);

    if (isPartial) {
      this.events.onPartialResult?.(result);
    }

    if (isFinal) {
      this.segmentId++;
      this.events.onFinalResult?.(result);
    }
  }

  /**
   * 从识别结果中提取文本
   * st.rt 是一个数组: rt: [{ ws: [{ cw: [{ w: "文字" }] }] }]
   */
  private extractText(st: any): string {
    const rt = st.rt;
    if (!rt || !Array.isArray(rt)) {
      console.warn('[XFYun AST] st.rt 不是数组:', typeof rt);
      return '';
    }

    const words: string[] = [];
    for (const segment of rt) {
      const ws = segment.ws;
      if (!ws || !Array.isArray(ws)) continue;

      for (const word of ws) {
        const cw = word.cw;
        if (!cw || !Array.isArray(cw)) continue;

        for (const char of cw) {
          if (char.w) {
            words.push(char.w);
          }
        }
      }
    }

    return words.join('');
  }

  /**
   * 发送音频数据 (二进制 PCM16)
   * 文档建议: 每 40ms 发送 1280 字节
   */
  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    if (!this.ws || !this.isConnected) {
      console.warn('[XFYun AST] WebSocket 未连接 (ws:', !!this.ws, 'connected:', this.isConnected, 'connecting:', this.connecting, ')');

      // 清理死连接
      if (this.ws && !this.isConnected && !this.connecting) {
        try { this.ws.close(); } catch {}
        this.ws = null;
      }

      // 尝试新建连接
      if (!this.ws && !this.connecting) {
        try {
          await this.connect();
        } catch (err: any) {
          console.error('[XFYun AST] 自动连接失败:', err.message);
          return;
        }
      }

      if (!this.isConnected) {
        console.warn('[XFYun AST] 连接未就绪，丢弃音频帧 (connecting:', this.connecting, ')');
        return;
      }
    }

    try {
      this.ws!.send(audioData);
      this.stats.totalFrames++;
      this.stats.totalBytes += audioData.byteLength;
    } catch (err: any) {
      console.error('[XFYun AST] 发送音频失败:', err.message);
      this.isConnected = false;
      this.ws = null;
    }
  }

  /**
   * 发送结束标识
   * 文档格式: {"end": true, "sessionId": "xxx"}
   */
  endSession(): void {
    if (this.ws && this.isConnected && this.sessionId) {
      try {
        const endMessage = JSON.stringify({
          end: true,
          sessionId: this.sessionId,
        });
        this.ws.send(endMessage);
        console.log('[XFYun AST] 已发送结束标识, sessionId:', this.sessionId);
      } catch (err) {
        console.error('[XFYun AST] 发送结束标识失败:', err);
      }
    }
  }

  close(): void {
    this.endSession();
    if (this.ws) {
      this.ws.close(1000, '正常关闭');
      this.ws = null;
    }
    this.isConnected = false;
    this.connecting = false;
    console.log('[XFYun AST] 连接已关闭');
  }

  onResult(callback: RecognitionCallback): void {
    this.callback = callback;
  }

  setEvents(events: RecognitionEvents): void {
    this.events = events;
  }

  getStats(): RecognitionStats {
    return { ...this.stats };
  }

  isReady(): boolean {
    return this.isConnected && this.ws !== null;
  }
}
