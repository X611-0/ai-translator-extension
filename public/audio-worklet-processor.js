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
      } else if (this.speechFrames >= this.minSpeechFrames) {
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