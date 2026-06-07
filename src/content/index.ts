/**
 * Content Script入口
 * 注入字幕浮层到网页中
 */

import { ExtensionMessage, SubtitleEntry } from '@/types';
import { createSubtitleOverlay, updateSubtitle, removeSubtitleOverlay, isOverlayReady } from './SubtitleOverlay';
import { AudioInjector } from './audioInjector';

// ========== 全局状态 ==========
let isRunning = false;
let audioInjector: AudioInjector | null = null;

// ========== 初始化 ==========
function init(): void {
  console.log('[Content] AI同声传译助手已加载, location:', window.location.href);

  // 设置注入标记，防止重复注入
  (window as any).__subtitleOverlayInjected = true;

  // 创建字幕浮层
  let overlayCreated = false;
  let overlayError: string | null = null;
  try {
    createSubtitleOverlay();
    const overlay = document.getElementById('ai-translator-overlay');
    overlayCreated = !!overlay;
    console.log('[Content] 浮层创建完成, overlay元素:', overlayCreated);
  } catch (err: any) {
    overlayError = err.message || String(err);
    console.error('[Content] 创建浮层失败:', err);
  }

  // 向 background 报告初始化状态（background 可以看到此日志）
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    payload: {
      url: window.location.href,
      overlayCreated,
      overlayError,
      bodyExists: !!document.body,
      isOverlayReady: isOverlayReady(),
    },
  }).then(() => {
    console.log('[Content] 状态已上报 background');
  }).catch(() => {
    // background 可能暂时不可用
  });

  // 监听来自background的消息
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      const result = handleMessage(message);
      // 在响应中附带诊断信息
      sendResponse({
        success: true,
        overlayExists: !!document.getElementById('ai-translator-overlay'),
        isOverlayReady: isOverlayReady(),
        result,
      });
      return true;
    }
  );
}

// ========== 消息处理 ==========
function handleMessage(message: ExtensionMessage): string {
  const { type, payload } = message;

  switch (type) {
    case 'PING': {
      const exists = !!document.getElementById('ai-translator-overlay');
      const ready = isOverlayReady();
      console.log('[Content] 收到 PING，overlay存在:', exists, 'ready:', ready);
      return `overlay:${exists},ready:${ready}`;
    }

    case 'TRANSLATION_RESULT': {
      const entry = payload as SubtitleEntry;
      if (!entry) {
        console.warn('[Content] TRANSLATION_RESULT payload 为空');
        return 'no_payload';
      }
      console.log('[Content] 收到字幕:', entry.original?.substring(0, 50));
      updateSubtitle(entry);
      return 'updated';
    }

    case 'STATUS_UPDATE': {
      const status = payload as { isRunning: boolean; status: string };
      isRunning = status.isRunning;
      console.log('[Content] STATUS_UPDATE:', status);

      if (status.isRunning) {
        // 确保浮层存在
        if (!document.getElementById('ai-translator-overlay')) {
          console.warn('[Content] 浮层不存在，重新创建');
          createSubtitleOverlay();
        }
        const overlay = document.getElementById('ai-translator-overlay');
        if (overlay) overlay.style.display = 'block';
      } else {
        const overlay = document.getElementById('ai-translator-overlay');
        if (overlay) overlay.style.display = 'none';
      }
      return 'status_ok';
    }

    case 'ERROR': {
      const error = payload as { message: string };
      console.error('[Content] 错误:', error.message);
      return 'error_logged';
    }

    default:
      console.log('[Content] 未知消息类型:', type);
      return 'unknown_type';
  }
}

// ========== 启动 ==========
init();

// ========== 页面卸载时清理 ==========
window.addEventListener('beforeunload', () => {
  removeSubtitleOverlay();
  if (audioInjector) {
    audioInjector.cleanup();
  }
});
