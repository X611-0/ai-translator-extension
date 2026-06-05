import { ExtensionMessage, AppState } from '@/types';

// ========== 默认设置 ==========

export const DEFAULT_SETTINGS: AppState = {
  isRunning: false,
  status: 'idle',
  errorMessage: null,
  outputMode: 'both',
  currentSubtitle: null,
  subtitleHistory: [],
  stats: {
    totalSegments: 0,
    totalCharacters: 0,
    averageLatency: 0,
  },
};

// ========== Chrome Storage 封装 ==========

export async function getSettings<T>(key: string): Promise<T | null> {
  try {
    const result = await chrome.storage.sync.get(key);
    return result[key] ?? null;
  } catch {
    return null;
  }
}

export async function setSettings<T>(key: string, value: T): Promise<void> {
  try {
    await chrome.storage.sync.set({ [key]: value });
  } catch (err) {
    console.error('[Storage] Failed to save settings:', err);
  }
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  try {
    return await chrome.storage.sync.get(null);
  } catch {
    return {};
  }
}

// ========== 消息发送 ==========

export async function sendMessageToContent(tabId: number, message: ExtensionMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.warn('[Message] Failed to send to content script:', err);
  }
}

export async function sendMessageToBackground(message: ExtensionMessage): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.warn('[Message] Failed to send to background:', err);
    return null;
  }
}

// ========== 工具函数 ==========

export function generateId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}