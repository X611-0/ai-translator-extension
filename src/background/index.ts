import { ExtensionMessage, AppSettings } from '@/types';
import { setupOffscreenDocument, closeOffscreenDocument } from './offscreenManager';
import { MessageHandler } from './messageHandler';

// ========== 全局状态 ==========
let messageHandler: any = null;
let isRunning = false;
let currentTabId: number | null = null;
let appSettings: AppSettings | null = null;
let lastCaptureTabId: number | null = null; // 记录上次捕获的标签页

// ========== 监听来自popup和content的消息 ==========
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

// 监听来自离屏文档的音频数据
chrome.runtime.onMessage.addListener((message: any) => {
  if (message.type === 'OFFSCREEN_AUDIO_DATA') {
    handleAudioData(message.audioData, message.analysis);
  }
  return false; // 不需要响应
});

// 扩展安装/更新时清理残留状态
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] 扩展已安装/更新，清理残留状态');
  forceCleanup();
});

// Service Worker 启动时清理
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Service Worker 启动，清理残留状态');
  forceCleanup();
});

/**
 * 强制清理所有残留状态
 */
async function forceCleanup(): Promise<void> {
  isRunning = false;
  lastCaptureTabId = null;

  // 关闭离屏文档
  try {
    await closeOffscreenDocument();
  } catch {
    // 忽略
  }

  if (messageHandler) {
    messageHandler.cleanup();
    messageHandler = null;
  }

  console.log('[Background] 强制清理完成');
}

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const { type, payload } = message;

  switch (type) {
    case 'START_TRANSLATION': {
      const payloadTabId = (payload as any)?.tabId;
      const streamId = (payload as any)?.streamId;
      const tabId = payloadTabId || sender.tab?.id;
      if (!tabId) return { success: false, error: '无法获取标签页' };
      if (!streamId) return { success: false, error: '缺少音频流ID' };

      try {
        await startTranslation(tabId, streamId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    case 'STOP_TRANSLATION': {
      await stopTranslation();
      return { success: true };
    }

    case 'FORCE_CLEANUP': {
      await forceCleanup();
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

/**
 * 启动翻译
 */
async function startTranslation(tabId: number, streamId: string): Promise<void> {
  if (isRunning) {
    await stopTranslation();
  }

  currentTabId = tabId;

  // 获取配置
  const settings = (await chrome.storage.sync.get('appSettings')) as {
    appSettings?: AppSettings;
  };
  appSettings = settings.appSettings || null;

  if (!appSettings?.xfyun?.appId) {
    throw new Error('请先在设置中配置讯飞语音识别');
  }
  if (!appSettings?.aliyun?.accessKeyId) {
    throw new Error('请先在设置中配置阿里云翻译');
  }

  // 创建离屏文档进行音频处理
  await setupOffscreenDocument();

  // 通知离屏文档开始处理音频
  const response = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_START_PROCESSING',
    target: 'offscreen',
    streamId,
    tabId,
  });

  if (!response?.success) {
    throw new Error(response?.error || '音频处理启动失败');
  }

  // 初始化消息处理器（静态导入）
  messageHandler = new MessageHandler();

  isRunning = true;

  // 通知 content script
  chrome.tabs.sendMessage(tabId, {
    type: 'STATUS_UPDATE',
    payload: { isRunning: true, status: 'translating' },
  }).catch(() => {});

  console.log('[Background] 翻译已启动, tabId:', tabId, 'streamId:', streamId);
}

/**
 * 处理来自离屏文档的音频数据
 */
function handleAudioData(audioData: ArrayBuffer, analysis: any): void {
  if (!isRunning || !messageHandler || !appSettings) return;

  // 过滤静音
  if (analysis?.isSilent) {
    console.log('[Background] 检测到静音，跳过');
    return;
  }

  console.log('[Background] 音频数据:', {
    rms: analysis?.rms?.toFixed(4),
    peak: analysis?.peak?.toFixed(4),
    length: audioData.byteLength,
  });

  messageHandler.onAudioData(audioData, appSettings);
}

/**
 * 停止翻译
 */
async function stopTranslation(): Promise<void> {
  isRunning = false;

  // 通知离屏文档停止
  try {
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_STOP_PROCESSING',
      target: 'offscreen',
    });
  } catch (err) {
    // 忽略错误
  }

  // 关闭离屏文档
  try {
    await closeOffscreenDocument();
  } catch (err) {
    // 忽略错误
  }

  if (messageHandler) {
    messageHandler.cleanup();
    messageHandler = null;
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
