/**
 * 字幕浮层组件
 * 使用Shadow DOM隔离样式，支持拖拽、双语对照
 */

import { SubtitleEntry } from '@/types';

// ========== 配置 ==========
const MAX_VISIBLE_LINES = 5;
const FADE_DURATION = 300; // ms

// ========== DOM元素引用 ==========
let overlayRoot: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let subtitleContainer: HTMLElement | null = null;
let currentSubtitleEl: HTMLElement | null = null;
let historyContainer: HTMLElement | null = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let isLocked = false;

// 缓存当前显示的字幕
let displayedSubtitles: SubtitleEntry[] = [];

/**
 * 创建字幕浮层
 */
export function createSubtitleOverlay(): void {
  if (document.getElementById('ai-translator-overlay')) return;

  // 创建宿主元素
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'ai-translator-overlay';
  overlayRoot.style.cssText = `
    position: fixed !important;
    bottom: 80px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    z-index: 2147483647 !important;
    pointer-events: auto !important;
    font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif !important;
  `;

  // 创建Shadow DOM
  shadowRoot = overlayRoot.attachShadow({ mode: 'open' });

  // 注入样式
  const style = document.createElement('style');
  style.textContent = getStyles();
  shadowRoot.appendChild(style);

  // 创建UI结构
  const wrapper = document.createElement('div');
  wrapper.className = 'subtitle-wrapper';
  wrapper.innerHTML = `
    <!-- 拖拽手柄 -->
    <div class="drag-handle" title="拖拽移动">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="4" cy="4" r="1.5"/>
        <circle cx="10" cy="4" r="1.5"/>
        <circle cx="4" cy="8" r="1.5"/>
        <circle cx="10" cy="8" r="1.5"/>
        <circle cx="4" cy="12" r="1.5"/>
        <circle cx="10" cy="12" r="1.5"/>
      </svg>
    </div>

    <!-- 控制按钮 -->
    <div class="controls">
      <button class="ctrl-btn" data-action="lock" title="锁定位置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="hide" title="隐藏字幕">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="clear" title="清除历史">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>

    <!-- 当前字幕 -->
    <div class="current-subtitle" id="current-subtitle">
      <span class="original-text"></span>
      <span class="translated-text"></span>
    </div>

    <!-- 历史字幕 -->
    <div class="history-container" id="history-container"></div>
  `;

  shadowRoot.appendChild(wrapper);

  // 获取元素引用
  currentSubtitleEl = shadowRoot.getElementById('current-subtitle');
  historyContainer = shadowRoot.getElementById('history-container');

  // 绑定事件
  bindEvents(wrapper);

  // 添加到页面
  document.body.appendChild(overlayRoot);

  console.log('[SubtitleOverlay] 字幕浮层已创建');
}

/**
 * 更新字幕显示
 */
export function updateSubtitle(entry: SubtitleEntry): void {
  if (!currentSubtitleEl || !historyContainer) return;

  // 更新当前字幕
  const originalEl = currentSubtitleEl.querySelector('.original-text');
  const translatedEl = currentSubtitleEl.querySelector('.translated-text');

  if (originalEl) {
    originalEl.textContent = entry.original;
    if (entry.isEnd) {
      originalEl.classList.remove('partial');
    } else {
      originalEl.classList.add('partial');
    }
  }

  if (translatedEl) {
    translatedEl.textContent = entry.translated || '';
    if (entry.translated) {
      translatedEl.style.opacity = '1';
    } else {
      translatedEl.style.opacity = '0.5';
    }
  }

  // 如果是最终结果，添加到历史记录
  if (entry.isEnd && entry.translated) {
    addToHistory(entry);
  }

  // 显示浮层
  if (overlayRoot) {
    overlayRoot.style.display = 'block';
  }
}

/**
 * 添加字幕到历史记录
 */
function addToHistory(entry: SubtitleEntry): void {
  if (!historyContainer) return;

  displayedSubtitles.push(entry);
  if (displayedSubtitles.length > MAX_VISIBLE_LINES) {
    displayedSubtitles.shift();
  }

  // 重建历史字幕
  historyContainer.innerHTML = '';
  displayedSubtitles.forEach((sub, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.animation = 'slideUp 0.3s ease-out';

    if (index === displayedSubtitles.length - 1) {
      item.classList.add('latest');
    }

    item.innerHTML = `
      <div class="history-original">${escapeHtml(sub.original)}</div>
      <div class="history-translated">${escapeHtml(sub.translated)}</div>
    `;

    historyContainer.appendChild(item);
  });
}

/**
 * 绑定事件
 */
function bindEvents(wrapper: HTMLElement): void {
  // 拖拽手柄
  const dragHandle = wrapper.querySelector('.drag-handle');
  if (dragHandle) {
    dragHandle.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  // 控制按钮
  wrapper.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-action]') as HTMLElement;
    if (!btn) return;

    const action = btn.dataset.action;
    switch (action) {
      case 'lock':
        isLocked = !isLocked;
        btn.classList.toggle('active', isLocked);
        if (dragHandle) {
          (dragHandle as HTMLElement).style.display = isLocked ? 'none' : 'block';
        }
        break;
      case 'hide':
        if (overlayRoot) {
          overlayRoot.style.display = 'none';
        }
        break;
      case 'clear':
        displayedSubtitles = [];
        if (historyContainer) historyContainer.innerHTML = '';
        break;
    }
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+H: 显示/隐藏字幕
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      if (overlayRoot) {
        const isVisible = overlayRoot.style.display !== 'none';
        overlayRoot.style.display = isVisible ? 'none' : 'block';
      }
    }
    // Ctrl+Shift+L: 锁定/解锁
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      isLocked = !isLocked;
      if (dragHandle) {
        (dragHandle as HTMLElement).style.display = isLocked ? 'none' : 'block';
      }
    }
  });
}

/**
 * 拖拽开始
 */
function onDragStart(e: Event): void {
  if (isLocked) return;
  const mouseEvent = e as MouseEvent;
  isDragging = true;

  if (overlayRoot) {
    const rect = overlayRoot.getBoundingClientRect();
    dragOffset.x = mouseEvent.clientX - rect.left;
    dragOffset.y = mouseEvent.clientY - rect.top;
    overlayRoot.style.transform = 'none';
    overlayRoot.style.left = `${rect.left}px`;
    overlayRoot.style.top = `${rect.top}px`;
  }
}

/**
 * 拖拽移动
 */
function onDragMove(e: Event): void {
  if (!isDragging || !overlayRoot) return;
  const mouseEvent = e as MouseEvent;

  overlayRoot.style.left = `${mouseEvent.clientX - dragOffset.x}px`;
  overlayRoot.style.top = `${mouseEvent.clientY - dragOffset.y}px`;
}

/**
 * 拖拽结束
 */
function onDragEnd(): void {
  isDragging = false;
}

/**
 * 移除浮层
 */
export function removeSubtitleOverlay(): void {
  if (overlayRoot) {
    overlayRoot.remove();
    overlayRoot = null;
    shadowRoot = null;
    currentSubtitleEl = null;
    historyContainer = null;
  }
}

/**
 * HTML转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 获取样式
 */
function getStyles(): string {
  return `
    :host {
      all: initial;
    }

    .subtitle-wrapper {
      background: rgba(0, 0, 0, 0.75);
      border-radius: 12px;
      padding: 12px 16px;
      min-width: 400px;
      max-width: 800px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      position: relative;
    }

    .drag-handle {
      position: absolute;
      top: 4px;
      left: 50%;
      transform: translateX(-50%);
      cursor: move;
      color: rgba(255, 255, 255, 0.4);
      padding: 2px;
      transition: color 0.2s;
      display: block;
    }

    .drag-handle:hover {
      color: rgba(255, 255, 255, 0.8);
    }

    .controls {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .subtitle-wrapper:hover .controls {
      opacity: 1;
    }

    .ctrl-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ctrl-btn:hover {
      color: rgba(255, 255, 255, 0.9);
      background: rgba(255, 255, 255, 0.1);
    }

    .ctrl-btn.active {
      color: #4F46E5;
    }

    .current-subtitle {
      padding: 8px 0;
      margin-top: 16px;
    }

    .original-text {
      display: block;
      color: rgba(255, 255, 255, 0.6);
      font-size: 13px;
      margin-bottom: 4px;
      font-style: italic;
      transition: opacity 0.3s;
    }

    .original-text.partial {
      opacity: 0.5;
    }

    .translated-text {
      display: block;
      color: #ffffff;
      font-size: 20px;
      font-weight: 500;
      line-height: 1.4;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      transition: opacity 0.3s;
    }

    .history-container {
      margin-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 8px;
    }

    .history-item {
      padding: 4px 0;
      animation: slideUp 0.3s ease-out;
    }

    .history-item.latest {
      animation: fadeIn 0.3s ease-in;
    }

    .history-original {
      color: rgba(255, 255, 255, 0.4);
      font-size: 11px;
      margin-bottom: 2px;
      font-style: italic;
    }

    .history-translated {
      color: rgba(255, 255, 255, 0.7);
      font-size: 14px;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
}