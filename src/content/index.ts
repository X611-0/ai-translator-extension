/**
 * Content Script入口
 * 注入字幕浮层到网页中
 */

import { ExtensionMessage, SubtitleEntry } from '@/types';
import { createSubtitleOverlay, updateSubtitle, removeSubtitleOverlay } from './SubtitleOverlay';
import { AudioInjector } from './audioInjector';

// ========== 全局状态 ==========
let isRunning = false;
let audioInjector: AudioInjector | null = null;

// ========== 初始化 ==========
function init(): void {
  console.log('[Content] AI同声传译助手已加载');

  // 创建字幕浮层
  createSubtitleOverlay();

  // 监听来自background的消息
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      handleMessage(message);
      sendResponse({ success: true });
      return true;
    }
  );
}

// ========== 消息处理 ==========
function handleMessage(message: ExtensionMessage): void {
  const { type, payload } = message;

  switch (type) {
    case 'TRANSLATION_RESULT': {
      const entry = payload as SubtitleEntry;
      if (entry) {
        updateSubtitle(entry);
      }
      break;
    }

    case 'STATUS_UPDATE': {
      const status = payload as { isRunning: boolean; status: string };
      isRunning = status.isRunning;

      if (status.isRunning) {
        // 显示字幕浮层
        const overlay = document.getElementById('ai-translator-overlay');
        if (overlay) overlay.style.display = 'block';
      } else {
        // 隐藏字幕浮层
        const overlay = document.getElementById('ai-translator-overlay');
        if (overlay) overlay.style.display = 'none';
      }
      break;
    }

    case 'ERROR': {
      const error = payload as { message: string };
      console.error('[Content] 错误:', error.message);
      break;
    }
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