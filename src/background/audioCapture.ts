/**
 * 音频捕获模块
 * 使用 chrome.tabCapture API 捕获标签页音频流
 * 通过 Web Audio API 分析和分段音频
 */

type AudioCallback = (audioData: ArrayBuffer, analysis: AudioAnalysis) => void;

export interface AudioAnalysis {
  rms: number;           // 均方根振幅
  peak: number;          // 峰值振幅
  frequencyData: Uint8Array; // 频谱数据
  isSilent: boolean;      // 是否静音
  timestamp: number;
}

export enum CaptureError {
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NO_AUDIO = 'NO_AUDIO',
  ALREADY_CAPTURING = 'ALREADY_CAPTURING',
  UNKNOWN = 'UNKNOWN',
}

export interface CaptureResult {
  success: boolean;
  error?: CaptureError;
  message?: string;
}

export class AudioCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private callback: AudioCallback | null = null;
  private sampleRate = 16000;
  private isCapturing = false;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private silenceThreshold = 0.01;  // 静音阈值
  private minSegmentDuration = 500;  // 最小分段时长(ms)
  private lastSpeechTime = 0;

  async startCapture(tabId: number): Promise<CaptureResult> {
    if (this.isCapturing) {
      return { success: false, error: CaptureError.ALREADY_CAPTURING, message: '已经在捕获中' };
    }

    try {
      const stream = await this.getTabCaptureStream(tabId);

      // 检查是否有音频轨道
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        return { success: false, error: CaptureError.NO_AUDIO, message: '该标签页没有音频轨道' };
      }

      this.stream = stream;

      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

      // 创建分析节点
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // 注册 AudioWorklet (包含VAD和分段逻辑)
      await this.audioContext.audioWorklet.addModule(
        URL.createObjectURL(
          new Blob(
            [
              `
              class AudioSegmenter extends AudioWorkletProcessor {
                constructor() {
                  super();
                  this.buffer = [];
                  this.speechBuffer = [];
                  this.silenceThreshold = 0.01;
                  this.minSpeechFrames = 8;
                  this.speechFrames = 0;
                  this.lastSpeechTime = 0;

                  this.port.onmessage = (e) => {
                    if (e.data === 'flush') {
                      this.flushBuffer();
                    }
                  };
                }

                process(inputs, outputs) {
                  const input = inputs[0][0];
                  if (input && input.length > 0) {
                    const { rms, peak, isSilent } = this.analyzeFrame(input);
                    this.buffer.push(...input);

                    if (!isSilent) {
                      this.speechBuffer.push(...input);
                      this.speechFrames++;
                      this.lastSpeechTime = currentTime;
                    } else if (this.speechFrames >= this.minSpeechFrames) {
                      // 语音结束，发送分段
                      const segment = new Float32Array(this.speechBuffer);
                      this.port.postMessage({
                        type: 'segment',
                        data: segment,
                        analysis: { rms, peak, isSilent }
                      });
                      this.speechBuffer = [];
                      this.speechFrames = 0;
                    } else {
                      this.speechBuffer = [];
                      this.speechFrames = 0;
                    }
                  }
                  return true;
                }

                analyzeFrame(frame) {
                  let sum = 0;
                  let peak = 0;
                  for (let i = 0; i < frame.length; i++) {
                    const abs = Math.abs(frame[i]);
                    sum += abs * abs;
                    if (abs > peak) peak = abs;
                  }
                  const rms = Math.sqrt(sum / frame.length);
                  return { rms, peak, isSilent: rms < this.silenceThreshold };
                }

                flushBuffer() {
                  if (this.buffer.length > 0) {
                    this.port.postMessage({
                      type: 'flush',
                      data: new Float32Array(this.buffer)
                    });
                    this.buffer = [];
                  }
                }
              }
              registerProcessor('audio-segmenter', AudioSegmenter);
            `,
            ],
            { type: 'application/javascript' }
          )
        )
      );

      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-segmenter');

      // 连接节点: source -> analyser -> worklet -> destination
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      // 处理来自 worklet 的分段音频
      this.workletNode.port.onmessage = (event) => {
        if (!this.isCapturing || !this.callback) return;
        const { type, data, analysis } = event.data;
        if (type === 'segment' && data.length > 0) {
          const analysisResult = this.analyzeAudioData(data);
          const pcm16 = this.float32ToPCM16(data);
          this.callback(pcm16.buffer, analysisResult);
        }
      };

      // 定期刷新非语音数据
      this.flushInterval = setInterval(() => {
        if (this.workletNode) {
          this.workletNode.port.postMessage('flush');
        }
      }, 1500);

      this.isCapturing = true;
      console.log('[AudioCapture] 音频捕获已启动, sampleRate:', this.sampleRate);
      return { success: true };
    } catch (err: any) {
      console.error('[AudioCapture] 启动捕获失败:', err);
      this.cleanup();

      // 分类错误类型
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        return { success: false, error: CaptureError.PERMISSION_DENIED, message: '请授权音频捕获权限' };
      }
      if (err.name === 'NotSupportedError') {
        return { success: false, error: CaptureError.NOT_SUPPORTED, message: '浏览器不支持音频捕获' };
      }
      return { success: false, error: CaptureError.UNKNOWN, message: err.message };
    }
  }

  private getTabCaptureStream(tabId: number): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      // @ts-ignore
      chrome.tabCapture.capture(
        { audio: true, video: false },
        (stream: MediaStream | null) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!stream) {
            reject(new Error('无法捕获音频流'));
            return;
          }
          resolve(stream);
        }
      );
    });
  }

  /**
   * 分析音频数据
   */
  private analyzeAudioData(data: Float32Array): AudioAnalysis {
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      sum += abs * abs;
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sum / data.length);
    const frequencyData = new Uint8Array(this.analyserNode?.frequencyBinCount || 1024);

    if (this.analyserNode) {
      // 获取频谱数据（需要连接到分析节点）
      this.analyserNode.getByteFrequencyData(frequencyData);
    }

    return {
      rms,
      peak,
      frequencyData,
      isSilent: rms < this.silenceThreshold,
      timestamp: Date.now(),
    };
  }

  stopCapture(): void {
    this.isCapturing = false;
    this.cleanup();
    console.log('[AudioCapture] 音频捕获已停止');
  }

  private cleanup(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
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
  }

  /**
   * 注册音频数据回调
   */
  onAudioData(callback: AudioCallback): void {
    this.callback = callback;
  }

  /**
   * 设置静音阈值
   */
  setSilenceThreshold(threshold: number): void {
    this.silenceThreshold = threshold;
  }

  /**
   * 设置最小分段时长
   */
  setMinSegmentDuration(ms: number): void {
    this.minSegmentDuration = ms;
  }

  private float32ToPCM16(float32: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  getIsCapturing(): boolean {
    return this.isCapturing;
  }
}
