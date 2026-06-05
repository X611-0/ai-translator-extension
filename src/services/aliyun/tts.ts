/**
 * 阿里云语音合成服务（TTS）
 * 将翻译后的文字转换为语音播报
 */

import { AliyunConfig } from '@/types';

export class AliyunTTS {
  private config: AliyunConfig;
  private audioContext: AudioContext | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private volume = 1.0;
  private speed = 1.0;

  private readonly ENDPOINT = 'https://nls-gateway.cn-shanghai.aliyuncs.com/stream/v1/tts';

  constructor(config: AliyunConfig) {
    this.config = config;
  }

  /**
   * 设置音量 (0.0 ~ 1.0)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * 设置语速 (0.5 ~ 2.0)
   */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.5, Math.min(2, speed));
  }

  /**
   * 合成并播放语音
   */
  async speak(text: string): Promise<void> {
    if (!text.trim()) return;

    try {
      const audioData = await this.synthesize(text);
      this.audioQueue.push(audioData);
      this.processQueue();
    } catch (err) {
      console.error('[AliyunTTS] 语音合成失败:', err);
      // 开发阶段：使用浏览器内置TTS作为fallback
      this.fallbackSpeak(text);
    }
  }

  /**
   * 调用阿里云TTS API合成语音
   */
  private async synthesize(text: string): Promise<ArrayBuffer> {
    try {
      const response = await fetch(this.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.accessKeyId}:${this.config.accessKeySecret}`,
        },
        body: JSON.stringify({
          appkey: this.config.accessKeyId,
          token: this.config.accessKeySecret,
          text,
          format: 'mp3',
          sample_rate: 16000,
          voice: 'xiaoyun', // 中文女声
          volume: Math.floor(this.volume * 100),
          speech_rate: Math.floor(this.speed * 100),
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS API返回错误: ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (err) {
      throw err;
    }
  }

  /**
   * 处理音频播放队列
   */
  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.audioQueue.length === 0) return;

    this.isPlaying = true;

    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    const audioData = this.audioQueue.shift()!;

    try {
      const audioBuffer = await this.audioContext.decodeAudioData(audioData);
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();

      gainNode.gain.value = this.volume;
      source.buffer = audioBuffer;
      source.playbackRate.value = this.speed;

      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start(0);
      });
    } catch (err) {
      console.error('[AliyunTTS] 播放失败:', err);
    }

    this.isPlaying = false;

    // 继续处理队列
    if (this.audioQueue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * 使用浏览器内置TTS作为fallback（开发阶段）
   */
  private fallbackSpeak(text: string): void {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = this.speed;
      utterance.volume = this.volume;
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.audioQueue = [];
    this.isPlaying = false;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}