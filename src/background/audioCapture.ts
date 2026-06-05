/**
 * 音频捕获模块
 * 使用 chrome.tabCapture API 捕获标签页音频流
 * 通过 Web Audio API 分段处理音频数据
 */

type AudioCallback = (audioData: ArrayBuffer) => void;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private callback: AudioCallback | null = null;
  private sampleRate = 16000; // 讯飞要求16kHz采样率
  private bufferSize = 4096; // 缓冲区大小
  private audioChunks: Float32Array[] = [];
  private segmentInterval: ReturnType<typeof setInterval> | null = null;
  private isCapturing = false;

  /**
   * 开始捕获指定标签页的音频
   */
  async startCapture(tabId: number): Promise<void> {
    if (this.isCapturing) {
      console.warn('[AudioCapture] 已经在捕获中');
      return;
    }

    try {
      // 使用 tabCapture 获取标签页音频流
      const stream = await new Promise<MediaStream>((resolve, reject) => {
        chrome.tabCapture.capture(
          {
            audio: true,
            video: false,
          },
          (capturedStream) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!capturedStream) {
              reject(new Error('无法捕获音频流'));
              return;
            }
            resolve(capturedStream);
          }
        );
      });

      this.stream = stream;

      // 创建 AudioContext 处理音频
      this.audioContext = new AudioContext({
        sampleRate: this.sampleRate,
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.scriptNode = this.audioContext.createScriptProcessor(
        this.bufferSize,
        1, // 单声道输入
        1  // 单声道输出
      );

      // 处理音频数据
      this.scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
        if (!this.isCapturing) return;
        const inputData = event.inputBuffer.getChannelData(0);
        // 复制数据避免引用问题
        const chunk = new Float32Array(inputData.length);
        chunk.set(inputData);
        this.audioChunks.push(chunk);
      };

      this.sourceNode.connect(this.scriptNode);
      this.scriptNode.connect(this.audioContext.destination);

      this.isCapturing = true;

      // 定期发送累积的音频数据（每1.5秒）
      this.segmentInterval = setInterval(() => {
        this.flushAudioData();
      }, 1500);

      console.log('[AudioCapture] 音频捕获已启动, sampleRate:', this.sampleRate);
    } catch (err) {
      console.error('[AudioCapture] 启动捕获失败:', err);
      throw err;
    }
  }

  /**
   * 停止音频捕获
   */
  stopCapture(): void {
    this.isCapturing = false;

    if (this.segmentInterval) {
      clearInterval(this.segmentInterval);
      this.segmentInterval = null;
    }

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.audioChunks = [];
    console.log('[AudioCapture] 音频捕获已停止');
  }

  /**
   * 注册音频数据回调
   */
  onAudioData(callback: AudioCallback): void {
    this.callback = callback;
  }

  /**
   * 将累积的音频片段合并并发送
   */
  private flushAudioData(): void {
    if (this.audioChunks.length === 0 || !this.callback) return;

    // 合并所有音频片段
    const totalLength = this.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.audioChunks = [];

    // 转换为 PCM16 格式
    const pcm16 = this.float32ToPCM16(merged);
    this.callback(pcm16.buffer);
  }

  /**
   * Float32 (-1.0~1.0) 转 PCM16 Int16
   */
  private float32ToPCM16(float32: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  /**
   * 检查是否正在捕获
   */
  getIsCapturing(): boolean {
    return this.isCapturing;
  }
}