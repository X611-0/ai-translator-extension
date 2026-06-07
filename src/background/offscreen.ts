/**
 * 离屏文档脚本
 * 接收 streamId，使用 navigator.mediaDevices.getUserMedia 获取音频流
 */

let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let analyserNode: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let isProcessing = false;
let flushInterval: number | null = null;
let outputNode: AudioWorkletNode | null = null; // 用于播放音频

// 处理来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  handleOffscreenMessage(message).then(sendResponse);
  return true; // 异步响应
});

async function handleOffscreenMessage(message: any): Promise<any> {
  switch (message.type) {
    case 'OFFSCREEN_START_PROCESSING': {
      return await startAudioProcessing(message.streamId);
    }
    case 'OFFSCREEN_STOP_PROCESSING': {
      stopAudioProcessing();
      return { success: true };
    }
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * 使用 streamId 获取音频流并处理
 */
async function startAudioProcessing(streamId: string): Promise<any> {
  try {
    // 先停止之前的处理（确保资源释放）
    stopAudioProcessing();

    console.log('[Offscreen] 开始获取音频流, streamId:', streamId);

    // 使用 streamId 获取 MediaStream
    // 简化配置，避免不必要的约束
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    });

    if (!mediaStream) {
      return { success: false, error: '无法获取音频流' };
    }

    // 检查音频轨道
    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
      return { success: false, error: '音频流没有音频轨道' };
    }

    // 打印音频轨道信息
    const audioTrack = audioTracks[0];
    console.log('[Offscreen] 音频轨道信息:', {
      id: audioTrack.id,
      kind: audioTrack.kind,
      label: audioTrack.label,
      enabled: audioTrack.enabled,
      muted: audioTrack.muted,
      readyState: audioTrack.readyState,
      settings: audioTrack.getSettings?.(),
    });

    // 如果轨道被静音，尝试取消静音
    if (audioTrack.muted) {
      console.warn('[Offscreen] 音频轨道被静音，尝试取消...');
      audioTrack.enabled = true;
    }

    // 创建 AudioContext
    audioContext = new AudioContext({ sampleRate: 16000 });
    console.log('[Offscreen] AudioContext 状态:', {
      state: audioContext.state,
      sampleRate: audioContext.sampleRate,
    });

    // 如果 AudioContext 是 suspended，需要 resume
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
      console.log('[Offscreen] AudioContext 已 resume，状态:', audioContext.state);
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    console.log('[Offscreen] MediaStreamSource 已创建');

    // 创建 GainNode 用于分流音频
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    // 连接音频图：
    // sourceNode -> gainNode -> workletNode (处理)
    // gainNode -> audioContext.destination (播放，让用户听到原视频声音)
    sourceNode!.connect(gainNode);
    gainNode.connect(audioContext.destination); // 播放音频

    // 注册 AudioWorklet
    await audioContext.audioWorklet.addModule(
      chrome.runtime.getURL('audio-worklet-processor.js')
    );

    workletNode = new AudioWorkletNode(audioContext, 'audio-segmenter');
    gainNode.connect(workletNode!);

    // 处理音频分段
    workletNode!.port.onmessage = (event) => {
      const { type, data, analysis } = event.data;
      if (type === 'segment' && data.length > 0) {
        // 转换为 PCM16
        const pcm16 = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          const s = Math.max(-1, Math.min(1, data[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // 转换为普通数组（Chrome sendMessage 可以正确序列化）
        const audioArray = Array.from(new Uint8Array(pcm16.buffer));

        // 发送回 background
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_AUDIO_DATA',
          audioData: audioArray,
          analysis,
        }).catch(() => {});
      }
    };

    // 定期刷新
    flushInterval = window.setInterval(() => {
      if (workletNode) {
        workletNode.port.postMessage('flush');
      }
    }, 1500);

    isProcessing = true;

    console.log('[Offscreen] 音频处理已启动');
    return { success: true };
  } catch (err: any) {
    console.error('[Offscreen] 处理失败:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 停止音频处理
 */
function stopAudioProcessing(): void {
  isProcessing = false;

  // 清理定时器
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (audioContext) {
    audioContext.close().catch(console.error);
    audioContext = null;
  }

  // 停止 MediaStream 轨道（重要：释放 tabCapture 资源）
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  console.log('[Offscreen] 音频处理已停止');
}

console.log('[Offscreen] 离屏文档已加载');