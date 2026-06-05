import { ExtensionMessage, AppSettings } from '@/types';
import { AudioCapture, CaptureResult, CaptureError } from './audioCapture';
import { MessageHandler } from './messageHandler';

// ========== 全局状态 ==========
let audioCapture: AudioCapture | null = null;
let messageHandler: MessageHandler | null = null;
let isRunning = false;
let currentTabId: number | null = null;

// ========== 初始化 ==========
messageHandler = new MessageHandler();

// ========== 监听来自popup和content的消息 ==========
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // 异步响应
});

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const { type, payload } = message;

  switch (type) {
    case 'START_TRANSLATION': {
      const tabId = sender.tab?.id;
      if (!tabId) return { success: false, error: '无法获取标签页' };

      try {
        await startTranslation(tabId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    case 'STOP_TRANSLATION': {
      await stopTranslation();
      return { success: true };
    }

    case 'GET_SETTINGS': {
      const settings = await chrome.storage.sync.get(null);
      return { success: true, data: settings };
    }

    case 'UPDATE_SETTINGS': {
      await chrome.storage.sync.set(payload as Record<string, unknown>);
      return { success: true };
    }

    case 'STATUS_UPDATE': {
      return {
        isRunning,
        status: isRunning ? 'translating' : 'idle',
        currentTabId,
      };
    }

    default:
      return { success: false, error: '未知消息类型' };
  }
}

// ========== 开始翻译 ==========
async function startTranslation(tabId: number): Promise<void> {
  if (isRunning) {
    await stopTranslation();
  }

  currentTabId = tabId;

  // 获取配置
  const settings = (await chrome.storage.sync.get('appSettings')) as {
    appSettings?: AppSettings;
  };
  const appSettings = settings.appSettings;

  if (!appSettings?.xfyun?.appId) {
    throw new Error('请先在设置中配置讯飞语音识别');
  }
  if (!appSettings?.aliyun?.accessKeyId) {
    throw new Error('请先在设置中配置阿里云翻译');
  }

  // 启动音频捕获
  audioCapture = new AudioCapture();
  const result: CaptureResult = await audioCapture.startCapture(tabId);

  if (!result.success) {
    audioCapture = null;
    switch (result.error) {
      case CaptureError.PERMISSION_DENIED:
        throw new Error('音频捕获权限被拒绝，请在Chrome扩展设置中授权');
      case CaptureError.NO_AUDIO:
        throw new Error('该页面没有可捕获的音频，请确保页面正在播放媒体');
      case CaptureError.ALREADY_CAPTURING:
        throw new Error('音频捕获已在进行中');
      case CaptureError.NOT_SUPPORTED:
        throw new Error('当前浏览器不支持音频捕获');
      default:
        throw new Error(result.message || '音频捕获启动失败');
    }
  }

  // 监听音频数据
  audioCapture.onAudioData((audioData: ArrayBuffer, analysis) => {
    if (!isRunning) return;

    // 过滤静音段（避免发送无意义数据）
    if (analysis.isSilent) {
      console.log('[Background] 检测到静音，跳过');
      return;
    }

    console.log('[Background] 音频数据:', {
      rms: analysis.rms.toFixed(4),
      peak: analysis.peak.toFixed(4),
      length: audioData.byteLength
    });

    if (messageHandler) {
      messageHandler.onAudioData(audioData, appSettings);
    }
  });

  isRunning = true;

  // 通知content script开始翻译
  chrome.tabs.sendMessage(tabId, {
    type: 'STATUS_UPDATE',
    payload: { isRunning: true, status: 'translating' },
  });

  console.log('[Background] 翻译已启动, tabId:', tabId);
}

// ========== 停止翻译 ==========
async function stopTranslation(): Promise<void> {
  isRunning = false;

  if (audioCapture) {
    audioCapture.stopCapture();
    audioCapture = null;
  }

  if (messageHandler) {
    messageHandler.cleanup();
  }

  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, {
      type: 'STATUS_UPDATE',
      payload: { isRunning: false, status: 'idle' },
    }).catch(() => {});
  }

  currentTabId = null;
  console.log('[Background] 翻译已停止');
}

console.log('[Background] Service Worker 已启动');