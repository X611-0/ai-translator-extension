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

    // 使用 streamId 获取 MediaStream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    } as any);

    if (!mediaStream) {
      return { success: false, error: '无法获取音频流' };
    }

    // 检查音频轨道
    if (mediaStream.getAudioTracks().length === 0) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
      return { success: false, error: '音频流没有音频轨道' };
    }

    // 创建 AudioContext
    audioContext = new AudioContext({ sampleRate: 16000 });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // 创建 GainNode 用于分流音频（一路处理，一路播放）
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    // 连接音频图：
    // sourceNode -> gainNode -> analyserNode -> workletNode (处理)
    // gainNode -> audioContext.destination (播放，让用户听到原视频声音)
    sourceNode.connect(gainNode);
    gainNode.connect(analyserNode);
    gainNode.connect(audioContext.destination); // 播放音频

    // 注册 AudioWorklet
    // 使用 public 目录下的 JS 文件（Vite 不处理，直接复制）
    await audioContext.audioWorklet.addModule(
      chrome.runtime.getURL('audio-worklet-processor.js')
    );

    workletNode = new AudioWorkletNode(audioContext, 'audio-segmenter');

    // analyserNode 已经连接到 gainNode，现在连接到 workletNode
    analyserNode.connect(workletNode);

    // 处理音频分段
    workletNode.port.onmessage = (event) => {
      const { type, data, analysis } = event.data;
      if (type === 'segment' && data.length > 0) {
        // 转换为 PCM16
        const pcm16 = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          const s = Math.max(-1, Math.min(1, data[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // 发送回 background
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_AUDIO_DATA',
          audioData: pcm16.buffer,
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