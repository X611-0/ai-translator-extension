/**
 * AudioWorklet 处理器
 * 用于音频分段和 VAD（语音活动检测）
 * 注意：AudioWorklet 运行在 AudioWorkletGlobalScope，没有 document 对象
 */
class AudioSegmenter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.speechBuffer = [];
    this.silenceThreshold = 0.01;
    this.minSpeechFrames = 8;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.maxSilenceFrames = 15; // 连续静音帧数阈值，用于分段

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
        // 有声音：添加到语音缓冲区
        this.speechBuffer.push(...input);
        this.speechFrames++;
        this.silenceFrames = 0;
      } else {
        // 静音：增加静音计数
        this.silenceFrames++;

        // 如果有足够的语音帧，且静音帧数达到阈值，发送分段
        if (this.speechFrames >= this.minSpeechFrames && this.silenceFrames >= this.maxSilenceFrames) {
          const segment = new Float32Array(this.speechBuffer);
          this.port.postMessage({
            type: 'segment',
            data: segment,
            analysis: { rms, peak, isSilent: false } // 这是语音分段，标记为非静音
          });
          this.speechBuffer = [];
          this.speechFrames = 0;
        }
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
    if (this.speechBuffer.length > 0 && this.speechFrames >= this.minSpeechFrames) {
      // 发送剩余的语音数据
      const segment = new Float32Array(this.speechBuffer);
      this.port.postMessage({
        type: 'segment',
        data: segment,
        analysis: { rms: 0, peak: 0, isSilent: false }
      });
    }
    this.speechBuffer = [];
    this.speechFrames = 0;
    this.buffer = [];
  }
}

registerProcessor('audio-segmenter', AudioSegmenter);