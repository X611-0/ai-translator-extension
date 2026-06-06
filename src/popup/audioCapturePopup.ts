/**
 * 音频捕获模块（Popup 版）
 * 在 popup 中调用 chrome.tabCapture.getMediaStreamId 获取 streamId
 * 注意：不需要先 capture()，getMediaStreamId 本身就是获取 streamId 的"票据"API
 */

export interface CaptureResult {
  success: boolean;
  streamId?: string;
  error?: string;
}

/**
 * 在 popup 中获取 streamId
 * 关键修复：
 * 1) 使用 getMediaStreamId() 而不是 capture()
 * 2) 只传 targetTabId，不要传 consumerTabId（两者冲突，且 consumerTabId 是用于指定消费 streamId 的 tab，但最终消费方是 offscreen）
 */
export async function captureTabAudioInPopup(tabId: number): Promise<CaptureResult> {
  try {
    // 先停止之前的翻译，清理可能存在的资源
    try {
      await chrome.runtime.sendMessage({
        type: 'FORCE_CLEANUP',
      });
    } catch {
      // 忽略错误
    }

    // 直接调用 getMediaStreamId 获取 streamId
    // 关键：只传 targetTabId（要捕获的 tab）
    const streamId = await new Promise<string>((resolve, reject) => {
      if (!chrome.tabCapture?.getMediaStreamId) {
        reject(new Error('Chrome 版本不支持 getMediaStreamId'));
        return;
      }

      (chrome.tabCapture as any).getMediaStreamId(
        { targetTabId: tabId },
        (id: string) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!id) {
            reject(new Error('未能获取 streamId'));
          } else {
            resolve(id);
          }
        }
      );
    });

    console.log('[PopupCapture] 成功获取 streamId');
    return { success: true, streamId };
  } catch (err: any) {
    console.error('[PopupCapture] 获取 streamId 失败:', err);
    return { success: false, error: err.message };
  }
}