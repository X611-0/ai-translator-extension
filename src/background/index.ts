import { ExtensionMessage, AppSettings } from '@/types';
import { setupOffscreenDocument, closeOffscreenDocument } from './offscreenManager';
import { MessageHandler } from './messageHandler';
import { DEFAULT_SETTINGS } from '@/config';

// ========== 全局状态 ==========
let messageHandler: any = null;
let isRunning = false;
let currentTabId: number | null = null;
let appSettings: AppSettings | null = null;
let lastCaptureTabId: number | null = null; // 记录上次捕获的标签页

// ========== 监听来自popup和content的消息 ==========
chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  // 跳过离屏文档和内部消息，由专门的监听器处理
  if (message.type && (message.type.startsWith('OFFSCREEN_') || message.type === 'CONTENT_SCRIPT_READY')) {
    // CONTENT_SCRIPT_READY 仅记录日志，不需要响应
    if (message.type === 'CONTENT_SCRIPT_READY') {
      console.log('[Background] 📋 Content Script 状态报告:', JSON.stringify(message.payload, null, 2));
    }
    return false; // 不处理，让其他监听器或直接忽略
  }

  handleMessage(message, sender).then(sendResponse).catch((err: Error) => {
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

    case 'CONTENT_SCRIPT_READY': {
      const status = payload as any;
      console.log('[Background] 📋 Content Script 状态报告:', JSON.stringify(status, null, 2));
      return { success: true };
    }

    case 'TEST_ALIYUN_API': {
      const { service, accessKeyId, accessKeySecret, appKey } = (payload || {}) as any;
      try {
        const result = await testAliyunApi(service, accessKeyId, accessKeySecret, appKey);
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    case 'STATUS_UPDATE': {
      return {
        isRunning,
        status: isRunning ? 'translating' : 'idle',
        currentTabId,
      };
    }

    default:
      console.log('[Background] 未知消息类型:', type, payload);
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

  // 确保 content script 已注入
  try {
    // 先尝试发送测试消息，如果失败则注入 content script
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log('[Background] Content script 已存在');
    } catch {
      // Content script 未注入，手动注入
      console.log('[Background] Content script 未注入，尝试动态注入...');
      // 从 manifest 动态读取 content_scripts 配置，避免硬编码 hash
      const manifest = chrome.runtime.getManifest();
      const contentScripts = manifest.content_scripts;
      if (contentScripts && contentScripts.length > 0) {
        const files = contentScripts[0].js || [];
        console.log('[Background] 注入文件:', files);
        if (files.length > 0) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: files,
          });
        }
      }
      // 等待脚本加载
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (err: unknown) {
    // 某些页面无法注入，忽略错误
    console.warn('[Background] Content script 注入检查失败:', err);
  }

  // 获取配置（使用环境变量默认值）
  const settings = (await chrome.storage.sync.get('appSettings')) as {
    appSettings?: AppSettings;
  };
  // 合并默认配置，确保环境变量的值被使用
  appSettings = {
    ...DEFAULT_SETTINGS,
    ...settings.appSettings,
    xfyun: { ...DEFAULT_SETTINGS.xfyun, ...settings.appSettings?.xfyun },
    aliyun: { ...DEFAULT_SETTINGS.aliyun, ...settings.appSettings?.aliyun },
  };

  console.log('[Background] 配置加载完成:', {
    xfyunAppId: appSettings.xfyun.appId || '(空)',
    xfyunApiKey: appSettings.xfyun.apiKey ? appSettings.xfyun.apiKey.substring(0, 8) + '...' : '(空)',
    xfyunApiSecret: appSettings.xfyun.apiSecret ? '已配置(长度:' + appSettings.xfyun.apiSecret.length + ')' : '(空)',
    aliyunKeyId: appSettings.aliyun.accessKeyId ? '已配置' : '未配置',
  });

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

  // 初始化消息处理器（传入目标标签页ID）
  messageHandler = new MessageHandler(tabId);

  isRunning = true;

  // 通知 content script
  chrome.tabs.sendMessage(tabId, {
    type: 'STATUS_UPDATE',
    payload: { isRunning: true, status: 'translating' },
  }).then((resp) => {
    console.log('[Background] STATUS_UPDATE 响应:', JSON.stringify(resp));
  }).catch((err: Error) => {
    console.warn('[Background] STATUS_UPDATE 发送失败 (content script 可能未注入):', err.message);
  });

  console.log('[Background] 翻译已启动, tabId:', tabId, 'streamId:', streamId);
}

/**
 * 处理来自离屏文档的音频数据
 */
function handleAudioData(audioData: number[], analysis: any): void {
  console.log('[Background] 收到音频数据, isRunning:', isRunning, 'messageHandler:', !!messageHandler, 'appSettings:', !!appSettings);

  if (!isRunning || !messageHandler || !appSettings) {
    console.warn('[Background] 状态不完整，跳过音频处理');
    return;
  }

  // 过滤静音
  if (analysis?.isSilent) {
    console.log('[Background] 检测到静音，跳过');
    return;
  }

  // 将普通数组转换为 ArrayBuffer
  const uint8 = new Uint8Array(audioData);
  const arrayBuffer = uint8.buffer;

  console.log('[Background] 音频数据:', {
    rms: analysis?.rms?.toFixed(4),
    peak: analysis?.peak?.toFixed(4),
    length: arrayBuffer.byteLength,
  });

  messageHandler.onAudioData(arrayBuffer, appSettings).catch((err: unknown) => {
    console.error('[Background] 处理音频数据失败:', err);
  });
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
  } catch (err: unknown) {
    // 忽略错误
  }

  // 关闭离屏文档
  try {
    await closeOffscreenDocument();
  } catch (err: unknown) {
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

/**
 * 代理阿里云 API 测试（选项页面不能直接 fetch 外部 URL，由 background 代理）
 */
async function testAliyunApi(
  service: 'translation' | 'tts',
  accessKeyId: string,
  accessKeySecret: string,
  appKey?: string
): Promise<{ success: boolean; data?: string; error?: string }> {
  const timestamp = new Date().toISOString().replace(/\.\d{3}/, '');
  const nonce = Math.random().toString(36).substring(2);

  let params: Record<string, string>;
  let endpoint: string;

  if (service === 'translation') {
    endpoint = 'https://mt.cn-hangzhou.aliyuncs.com/';
    params = {
      Action: 'TranslateGeneral',
      Version: '2018-10-12',
      Format: 'JSON',
      FormatType: 'text',
      AccessKeyId: accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: timestamp,
      SourceLanguage: 'en',
      TargetLanguage: 'zh',
      SourceText: 'hello',
      Scene: 'general',
    };
  } else {
    // TTS 测试：获取 Token 即可验证连通性
    if (!appKey) {
      return { success: false, error: '请先在选项页面填写语音合成 AppKey（在 nls.console.aliyun.com 创建项目获取）' };
    }
    endpoint = 'https://nls-meta.cn-shanghai.aliyuncs.com/';
    params = {
      AccessKeyId: accessKeyId,
      Action: 'CreateToken',
      Version: '2019-02-28',
      Format: 'JSON',
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: timestamp,
    };
  }

  // HMAC-SHA1 签名 (GET)
  const sortedKeys = Object.keys(params).sort();
  const canonicalized = sortedKeys
    .map(k => encodeURIComponent(k).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + '=' +
                encodeURIComponent(params[k]).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('&');
  const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalized)}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(accessKeySecret + '&'),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  params.Signature = signature;
  const queryString = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const url = `${endpoint}?${queryString}`;

  console.log('[Background] 测试阿里云 API:', service, 'URL:', url.substring(0, 200));

  let response: Response;
  try {
    response = await fetch(url);
  } catch (fetchErr: any) {
    console.error('[Background] fetch 失败:', fetchErr.message, 'URL:', url);
    return { success: false, error: `网络请求失败: ${fetchErr.message}` };
  }

  let data: any;
  try {
    data = await response.json();
  } catch (jsonErr: any) {
    const text = await response.text().catch(() => '');
    console.error('[Background] JSON 解析失败, 原始响应:', text.substring(0, 200));
    return { success: false, error: `响应解析失败 (HTTP ${response.status}): ${text.substring(0, 100)}` };
  }

  if (data.Code === '200') {
    if (service === 'translation') {
      return { success: true, data: data.Data?.Translated || 'hello' };
    } else {
      return { success: true, data: `Token 获取成功, 有效期至 ${data.Data?.ExpireTime || '?'}` };
    }
  } else {
    return { success: false, error: `${data.Code}: ${data.Message || '未知错误'}` };
  }
}

console.log('[Background] Service Worker 已启动');
