/**
 * 离屏文档管理器
 * Manifest V3 中，service worker 无法直接使用 tabCapture，需要通过 offscreen document
 */

let offscreenDocCreating: Promise<void> | null = null;

export interface OffscreenCaptureRequest {
  type: 'OFFSCREEN_START_CAPTURE';
  tabId: number;
}

export interface OffscreenCaptureResult {
  type: 'OFFSCREEN_CAPTURE_RESULT';
  success: boolean;
  streamId?: string;
  error?: string;
}

/**
 * 确保离屏文档存在
 */
export async function setupOffscreenDocument(): Promise<void> {
  // 检查是否已存在
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // 如果正在创建，等待
  if (offscreenDocCreating) {
    await offscreenDocCreating;
    return;
  }

  // 创建离屏文档
  offscreenDocCreating = chrome.offscreen.createDocument({
    url: 'src/background/offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA as chrome.offscreen.Reason],
    justification: '需要捕获标签页音频用于实时翻译',
  });

  await offscreenDocCreating;
  offscreenDocCreating = null;
}

/**
 * 通过离屏文档获取 tab 音频流
 */
export async function captureTabAudioViaOffscreen(tabId: number): Promise<string> {
  await setupOffscreenDocument();

  // 向离屏文档发送消息
  const response = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_CAPTURE_TAB',
    target: 'offscreen',
    tabId,
  });

  if (!response?.success) {
    throw new Error(response?.error || '离屏捕获失败');
  }

  return response.streamId;
}

/**
 * 关闭离屏文档
 */
export async function closeOffscreenDocument(): Promise<void> {
  try {
    // @ts-ignore - closeDocument may not be in types
    if (chrome.offscreen?.closeDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch (err) {
    // 忽略关闭错误
  }
}
