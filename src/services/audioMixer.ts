/**
 * 音频混音器
 * 在播放 TTS 时降低原音频音量，实现平滑过渡
 */

// 混音配置
interface MixerConfig {
  originalVolume: number;      // 原音频正常音量 (0-1)
  duckingVolume: number;       // 原音频降低后的音量 (0-1)
  duckingDuration: number;     // 音量降低过渡时间 (ms)
  restoreDuration: number;     // 音量恢复过渡时间 (ms)
}

// 默认配置
const DEFAULT_MIXER_CONFIG: MixerConfig = {
  originalVolume: 1.0,
  duckingVolume: 0.3,          // 降低到 30%
  duckingDuration: 300,        // 300ms 过渡
  restoreDuration: 500,        // 500ms 恢复
};

// 音频节点
interface AudioNodes {
  gainNode: GainNode;
  sourceNode: MediaStreamAudioSourceNode | null;
}

// 混音器状态
interface MixerState {
  isDucking: boolean;
  currentVolume: number;
  targetVolume: number;
  transitionStartTime: number;
}

/**
 * 音频混音器类
 * 管理原音频和 TTS 音频的混音
 */
export class AudioMixer {
  private audioContext: AudioContext | null = null;
  private originalAudioNodes: Map<number, AudioNodes> = new Map();
  private ttsGainNode: GainNode | null = null;
  private config: MixerConfig = DEFAULT_MIXER_CONFIG;
  private state: MixerState = {
    isDucking: false,
    currentVolume: 1.0,
    targetVolume: 1.0,
    transitionStartTime: 0,
  };
  private animationFrameId: number | null = null;

  /**
   * 初始化混音器
   */
  async initialize(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    // 创建 TTS 音量控制节点
    this.ttsGainNode = this.audioContext.createGain();
    this.ttsGainNode.gain.value = 1.0;
    this.ttsGainNode.connect(this.audioContext.destination);

    console.log('[AudioMixer] 初始化完成');
  }

  /**
   * 添加原音频流（来自 tabCapture）
   */
  addOriginalAudio(stream: MediaStream, tabId: number): void {
    if (!this.audioContext) {
      console.warn('[AudioMixer] AudioContext 未初始化');
      return;
    }

    // 创建音频源节点
    const sourceNode = this.audioContext.createMediaStreamSource(stream);
    
    // 创建音量控制节点
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = this.config.originalVolume;

    // 连接节点
    sourceNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // 存储
    this.originalAudioNodes.set(tabId, {
      gainNode,
      sourceNode,
    });

    console.log(`[AudioMixer] 添加原音频流: tabId=${tabId}`);
  }

  /**
   * 移除原音频流
   */
  removeOriginalAudio(tabId: number): void {
    const nodes = this.originalAudioNodes.get(tabId);
    if (nodes) {
      if (nodes.sourceNode) {
        nodes.sourceNode.disconnect();
      }
      nodes.gainNode.disconnect();
      this.originalAudioNodes.delete(tabId);
      console.log(`[AudioMixer] 移除原音频流: tabId=${tabId}`);
    }
  }

  /**
   * 开始降低原音频音量（TTS 播放前）
   */
  startDucking(): void {
    if (this.state.isDucking) return;

    this.state.isDucking = true;
    this.state.targetVolume = this.config.duckingVolume;
    this.state.transitionStartTime = this.audioContext?.currentTime || 0;

    // 平滑过渡
    this.smoothTransition(this.config.duckingDuration);

    console.log(`[AudioMixer] 开始降低音量: ${this.config.originalVolume} -> ${this.config.duckingVolume}`);
  }

  /**
   * 恢复原音频音量（TTS 播放后）
   */
  stopDucking(): void {
    if (!this.state.isDucking) return;

    this.state.isDucking = false;
    this.state.targetVolume = this.config.originalVolume;
    this.state.transitionStartTime = this.audioContext?.currentTime || 0;

    // 平滑过渡
    this.smoothTransition(this.config.restoreDuration);

    console.log(`[AudioMixer] 开始恢复音量: ${this.config.duckingVolume} -> ${this.config.originalVolume}`);
  }

  /**
   * 平滑音量过渡
   */
  private smoothTransition(durationMs: number): void {
    if (!this.audioContext) return;

    const durationSec = durationMs / 1000;
    const startTime = this.audioContext.currentTime;
    const startVolume = this.state.currentVolume;
    const endVolume = this.state.targetVolume;

    // 对所有原音频节点应用过渡
    this.originalAudioNodes.forEach((nodes) => {
      const gainNode = nodes.gainNode;
      gainNode.gain.cancelScheduledValues(startTime);
      gainNode.gain.setValueAtTime(startVolume, startTime);
      gainNode.gain.linearRampToValueAtTime(endVolume, startTime + durationSec);
    });

    // 更新当前音量状态
    this.state.currentVolume = endVolume;
  }

  /**
   * 设置原音频正常音量
   */
  setOriginalVolume(volume: number): void {
    this.config.originalVolume = Math.max(0, Math.min(1, volume));
    
    if (!this.state.isDucking) {
      this.originalAudioNodes.forEach((nodes) => {
        nodes.gainNode.gain.value = this.config.originalVolume;
      });
      this.state.currentVolume = this.config.originalVolume;
    }

    console.log(`[AudioMixer] 设置原音频音量: ${this.config.originalVolume}`);
  }

  /**
   * 设置降低后的音量
   */
  setDuckingVolume(volume: number): void {
    this.config.duckingVolume = Math.max(0, Math.min(1, volume));
    console.log(`[AudioMixer] 设置降低音量: ${this.config.duckingVolume}`);
  }

  /**
   * 设置过渡时间
   */
  setTransitionDuration(duckingMs: number, restoreMs: number): void {
    this.config.duckingDuration = duckingMs;
    this.config.restoreDuration = restoreMs;
    console.log(`[AudioMixer] 设置过渡时间: 降低=${duckingMs}ms, 恢复=${restoreMs}ms`);
  }

  /**
   * 设置 TTS 音量
   */
  setTTSVolume(volume: number): void {
    if (this.ttsGainNode) {
      this.ttsGainNode.gain.value = Math.max(0, Math.min(1, volume));
      console.log(`[AudioMixer] 设置 TTS 音量: ${volume}`);
    }
  }

  /**
   * 获取 TTS GainNode（用于连接 TTS 音频源）
   */
  getTTSGainNode(): GainNode | null {
    return this.ttsGainNode;
  }

  /**
   * 获取 AudioContext
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * 获取当前状态
   */
  getState(): MixerState & { config: MixerConfig } {
    return {
      ...this.state,
      config: this.config,
    };
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 停止所有过渡动画
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // 断开所有原音频节点
    this.originalAudioNodes.forEach((nodes, tabId) => {
      this.removeOriginalAudio(tabId);
    });

    // 断开 TTS 节点
    if (this.ttsGainNode) {
      this.ttsGainNode.disconnect();
      this.ttsGainNode = null;
    }

    // 关闭 AudioContext
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // 重置状态
    this.state = {
      isDucking: false,
      currentVolume: 1.0,
      targetVolume: 1.0,
      transitionStartTime: 0,
    };

    console.log('[AudioMixer] 清理完成');
  }
}

// 全局混音器实例
let mixerInstance: AudioMixer | null = null;

/**
 * 获取混音器实例
 */
export function getAudioMixer(): AudioMixer {
  if (!mixerInstance) {
    mixerInstance = new AudioMixer();
  }
  return mixerInstance;
}

/**
 * 初始化混音器
 */
export async function initAudioMixer(): Promise<AudioMixer> {
  const mixer = getAudioMixer();
  await mixer.initialize();
  return mixer;
}

/**
 * 清理混音器
 */
export function cleanupAudioMixer(): void {
  if (mixerInstance) {
    mixerInstance.cleanup();
    mixerInstance = null;
  }
}