/**
 * 字幕浮层组件
 * 使用Shadow DOM隔离样式，支持拖拽、缩放、双语对照、样式自定义
 */

import { SubtitleEntry, DisplaySettings } from '@/types';

// ========== 配置 ==========
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const DEFAULT_SCALE = 1.0;

// ========== 样式预设 ==========
interface StylePreset {
  name: string;
  background: string;
  textColor: string;
  originalColor: string;
  borderRadius: string;
  fontSizeRatio: number;
}

const STYLE_PRESETS: Record<string, StylePreset> = {
  default: {
    name: '默认',
    background: 'rgba(0, 0, 0, 0.75)',
    textColor: '#FFFFFF',
    originalColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: '12px',
    fontSizeRatio: 1.0,
  },
  netflix: {
    name: 'Netflix风格',
    background: 'rgba(0, 0, 0, 0.85)',
    textColor: '#FFFFFF',
    originalColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: '4px',
    fontSizeRatio: 1.1,
  },
  youtube: {
    name: 'YouTube风格',
    background: 'rgba(0, 0, 0, 0.7)',
    textColor: '#FFFFFF',
    originalColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: '8px',
    fontSizeRatio: 0.95,
  },
  glass: {
    name: '玻璃效果',
    background: 'rgba(30, 30, 50, 0.6)',
    textColor: '#FFFFFF',
    originalColor: 'rgba(200, 200, 255, 0.6)',
    borderRadius: '16px',
    fontSizeRatio: 1.0,
  },
  minimal: {
    name: '极简',
    background: 'rgba(0, 0, 0, 0.5)',
    textColor: '#FFFFFF',
    originalColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: '0px',
    fontSizeRatio: 0.9,
  },
  darkBlue: {
    name: '深蓝',
    background: 'rgba(20, 30, 60, 0.85)',
    textColor: '#E0E8FF',
    originalColor: 'rgba(180, 200, 255, 0.6)',
    borderRadius: '10px',
    fontSizeRatio: 1.0,
  },
};

// ========== 网站兼容性配置 ==========
interface SiteCompatibility {
  hostname: string;
  zIndex: number;
  positionOffset: { top?: number; bottom?: number };
  avoidElements: string[];
}

const SITE_COMPATIBILITY: SiteCompatibility[] = [
  {
    hostname: 'youtube.com',
    zIndex: 2147483647,
    positionOffset: { bottom: 60 },
    avoidElements: ['.ytp-chrome-bottom', '.ytp-player-content'],
  },
  {
    hostname: 'www.youtube.com',
    zIndex: 2147483647,
    positionOffset: { bottom: 60 },
    avoidElements: ['.ytp-chrome-bottom', '.ytp-player-content'],
  },
  {
    hostname: 'netflix.com',
    zIndex: 2147483647,
    positionOffset: { bottom: 100 },
    avoidElements: ['.watch-video--player-view'],
  },
  {
    hostname: 'bilibili.com',
    zIndex: 2147483647,
    positionOffset: { bottom: 50 },
    avoidElements: ['.bpx-player-control-wrap'],
  },
  {
    hostname: 'vimeo.com',
    zIndex: 2147483647,
    positionOffset: { bottom: 80 },
    avoidElements: ['.vp-controls'],
  },
];

// ========== DOM元素引用 ==========
let overlayRoot: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let subtitleContainer: HTMLElement | null = null;
let currentSubtitleEl: HTMLElement | null = null;
let historyContainer: HTMLElement | null = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let isLocked = false;
let isVisible = true;
let bilingualMode = true;
let currentScale = DEFAULT_SCALE;
let isResizing = false;
let resizeStartWidth = 0;
let resizeStartX = 0;
let currentPreset = 'default';

// 缓存当前显示的字幕
let displayedSubtitles: SubtitleEntry[] = [];

// 当前显示设置
let displaySettings: DisplaySettings = {
  subtitlePosition: 'bottom',
  subtitleFontSize: 20,
  subtitleBackgroundOpacity: 0.75,
  subtitleColor: '#FFFFFF',
  maxLines: 2,
  bilingual: true,
};

// 网站兼容性设置
let siteConfig: SiteCompatibility | null = null;

/**
 * 检测当前网站并应用兼容性配置
 */
function detectSiteCompatibility(): void {
  const hostname = window.location.hostname;
  siteConfig = SITE_COMPATIBILITY.find(site => hostname.includes(site.hostname)) || null;

  if (siteConfig) {
    console.log(`[SubtitleOverlay] 检测到网站: ${siteConfig.hostname}, 应用兼容性配置`);
  }
}

/**
 * 创建字幕浮层
 */
export function createSubtitleOverlay(settings?: Partial<DisplaySettings>): void {
  // 检查是否已存在浮层（可能是之前的注入留下的）
  const existingOverlay = document.getElementById('ai-translator-overlay');
  if (existingOverlay) {
    console.log('[SubtitleOverlay] 发现已存在的浮层，尝试恢复引用');
    // 恢复模块级变量引用
    overlayRoot = existingOverlay;
    shadowRoot = existingOverlay.shadowRoot;
    if (shadowRoot) {
      currentSubtitleEl = shadowRoot.getElementById('current-subtitle');
      historyContainer = shadowRoot.getElementById('history-container');
      subtitleContainer = shadowRoot.querySelector('.subtitle-wrapper') as HTMLElement;
    }

    // 检查恢复是否成功
    if (overlayRoot && shadowRoot && currentSubtitleEl && historyContainer) {
      console.log('[SubtitleOverlay] 浮层引用恢复成功');
      if (settings) {
        updateDisplaySettings(settings);
      }
      return;
    } else {
      console.warn('[SubtitleOverlay] 浮层引用恢复失败，重新创建');
      // 恢复失败，移除旧元素重新创建
      existingOverlay.remove();
    }
  }

  // 检测网站兼容性
  detectSiteCompatibility();

  // 合并设置
  if (settings) {
    displaySettings = { ...displaySettings, ...settings };
    bilingualMode = displaySettings.bilingual;
  }

  // 创建宿主元素
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'ai-translator-overlay';
  overlayRoot.style.cssText = `
    position: fixed !important;
    z-index: ${siteConfig?.zIndex || 2147483647} !important;
    pointer-events: auto !important;
    font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif !important;
    transition: opacity 0.3s ease !important;
    transform-origin: center center !important;
  `;

  // 设置初始位置
  setPosition(displaySettings.subtitlePosition);

  // 创建Shadow DOM
  shadowRoot = overlayRoot.attachShadow({ mode: 'open' });

  // 注入样式
  const style = document.createElement('style');
  style.textContent = getStyles(displaySettings, currentPreset);
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

    <!-- 缩放手柄 -->
    <div class="resize-handle" title="缩放大小">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="M10 2L10 10L2 10" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
    </div>

    <!-- 控制按钮 -->
    <div class="controls">
      <button class="ctrl-btn" data-action="bilingual" title="切换双语 (Ctrl+Shift+B)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 8l6 6"/>
          <path d="M7 4l6 6"/>
          <path d="M13 4l6 6"/>
          <path d="M5 16l6 6"/>
          <path d="M13 16l6 6"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="style" title="切换样式">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v10"/>
          <path d="M1 12h6m6 0h10"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="position" title="切换位置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="3" y1="15" x2="21" y2="15"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="scaleUp" title="放大">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="scaleDown" title="缩小">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="lock" title="锁定位置 (Ctrl+Shift+L)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </button>
      <button class="ctrl-btn" data-action="hide" title="隐藏字幕 (Ctrl+Shift+H)">
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
  subtitleContainer = wrapper;

  // 绑定事件
  bindEvents(wrapper);

  // 添加到页面
  if (!document.body) {
    console.error('[SubtitleOverlay] document.body 不存在，无法添加浮层');
    return;
  }
  document.body.appendChild(overlayRoot);

  // 验证元素引用
  console.log('[SubtitleOverlay] 浮层创建完成:', {
    hasOverlayRoot: !!overlayRoot,
    hasShadowRoot: !!shadowRoot,
    hasCurrentSubtitleEl: !!currentSubtitleEl,
    hasHistoryContainer: !!historyContainer,
    overlayInDOM: !!document.getElementById('ai-translator-overlay'),
    bodyExists: !!document.body,
  });

  // 更新双语按钮状态
  updateBilingualButton();

  // 应用初始缩放
  applyScale(currentScale);

  console.log('[SubtitleOverlay] 字幕浮层已创建');
}

/**
 * 设置位置（考虑网站兼容性）
 */
function setPosition(position: 'top' | 'middle' | 'bottom'): void {
  if (!overlayRoot) return;

  const offset = siteConfig?.positionOffset || {};

  switch (position) {
    case 'top':
      overlayRoot.style.top = `${offset.top || 80}px`;
      overlayRoot.style.bottom = 'auto';
      overlayRoot.style.left = '50%';
      overlayRoot.style.transform = `translateX(-50%) scale(${currentScale})`;
      break;
    case 'middle':
      overlayRoot.style.top = '50%';
      overlayRoot.style.bottom = 'auto';
      overlayRoot.style.left = '50%';
      overlayRoot.style.transform = `translate(-50%, -50%) scale(${currentScale})`;
      break;
    case 'bottom':
      overlayRoot.style.top = 'auto';
      overlayRoot.style.bottom = `${offset.bottom || 80}px`;
      overlayRoot.style.left = '50%';
      overlayRoot.style.transform = `translateX(-50%) scale(${currentScale})`;
      break;
  }
}

/**
 * 应用缩放
 */
function applyScale(scale: number): void {
  currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

  if (overlayRoot) {
    const position = displaySettings.subtitlePosition;
    if (position === 'middle') {
      overlayRoot.style.transform = `translate(-50%, -50%) scale(${currentScale})`;
    } else {
      overlayRoot.style.transform = `translateX(-50%) scale(${currentScale})`;
    }
  }

  console.log(`[SubtitleOverlay] 缩放: ${currentScale.toFixed(2)}`);
}

/**
 * 切换样式预设
 */
function switchStylePreset(): void {
  const presets = Object.keys(STYLE_PRESETS);
  const currentIndex = presets.indexOf(currentPreset);
  currentPreset = presets[(currentIndex + 1) % presets.length];

  if (shadowRoot) {
    const styleEl = shadowRoot.querySelector('style');
    if (styleEl) {
      styleEl.textContent = getStyles(displaySettings, currentPreset);
    }
  }

  console.log(`[SubtitleOverlay] 样式切换: ${STYLE_PRESETS[currentPreset].name}`);
}

/**
 * 更新显示设置
 */
export function updateDisplaySettings(settings: Partial<DisplaySettings>): void {
  displaySettings = { ...displaySettings, ...settings };
  bilingualMode = displaySettings.bilingual;

  if (!shadowRoot) return;

  // 更新样式
  const styleEl = shadowRoot.querySelector('style');
  if (styleEl) {
    styleEl.textContent = getStyles(displaySettings, currentPreset);
  }

  // 更新位置
  setPosition(displaySettings.subtitlePosition);

  // 更新双语按钮
  updateBilingualButton();

  // 更新当前字幕显示
  if (currentSubtitleEl) {
    const originalEl = currentSubtitleEl.querySelector('.original-text');
    if (originalEl) {
      (originalEl as HTMLElement).style.display = bilingualMode ? 'block' : 'none';
    }
  }

  console.log('[SubtitleOverlay] 设置已更新:', displaySettings);
}

/**
 * 更新双语按钮状态
 */
function updateBilingualButton(): void {
  if (!shadowRoot) return;

  const bilingualBtn = shadowRoot.querySelector('[data-action="bilingual"]');
  if (bilingualBtn) {
    bilingualBtn.classList.toggle('active', bilingualMode);
  }
}

/**
 * 检查浮层是否已就绪
 */
export function isOverlayReady(): boolean {
  return !!(overlayRoot && shadowRoot && currentSubtitleEl && historyContainer);
}

/**
 * 更新字幕显示
 */
export function updateSubtitle(entry: SubtitleEntry): void {
  if (!currentSubtitleEl || !historyContainer) {
    console.warn('[SubtitleOverlay] updateSubtitle: 浮层元素未就绪', {
      hasOverlayRoot: !!overlayRoot,
      hasShadowRoot: !!shadowRoot,
      hasCurrentSubtitleEl: !!currentSubtitleEl,
      hasHistoryContainer: !!historyContainer,
    });
    return;
  }

  console.log('[SubtitleOverlay] updateSubtitle:', {
    original: entry.original?.substring(0, 50),
    translated: entry.translated?.substring(0, 50),
    isEnd: entry.isEnd,
    isCorrection: entry.isCorrection,
    isVisible,
    bilingualMode,
  });

  // 更新当前字幕
  const originalEl = currentSubtitleEl.querySelector('.original-text');
  const translatedEl = currentSubtitleEl.querySelector('.translated-text');

  // 处理修正动画
  if (entry.isCorrection) {
    // 添加修正动画类
    currentSubtitleEl.classList.add('correction');
    setTimeout(() => {
      currentSubtitleEl?.classList.remove('correction');
    }, 500);
  }

  if (originalEl) {
    originalEl.textContent = entry.original;
    (originalEl as HTMLElement).style.display = bilingualMode ? 'block' : 'none';
    if (entry.isEnd) {
      originalEl.classList.remove('partial');
    } else {
      originalEl.classList.add('partial');
    }
    // 修正时添加闪烁效果
    if (entry.isCorrection) {
      originalEl.classList.add('correcting');
      setTimeout(() => originalEl.classList.remove('correcting'), 300);
    }
  } else {
    console.warn('[SubtitleOverlay] .original-text 元素未找到');
  }

  if (translatedEl) {
    // 修正时先淡出再淡入
    if (entry.isCorrection && entry.translated) {
      (translatedEl as HTMLElement).style.transition = 'opacity 0.2s ease';
      (translatedEl as HTMLElement).style.opacity = '0';
      setTimeout(() => {
        translatedEl.textContent = entry.translated || '';
        (translatedEl as HTMLElement).style.opacity = '1';
      }, 200);
    } else {
      translatedEl.textContent = entry.translated || '';
      if (entry.translated) {
        (translatedEl as HTMLElement).style.opacity = '1';
      } else {
        (translatedEl as HTMLElement).style.opacity = '0.5';
      }
    }
  } else {
    console.warn('[SubtitleOverlay] .translated-text 元素未找到');
  }

  // 如果是最终结果，添加到历史记录（修正结果更新历史）
  if (entry.isEnd && entry.translated) {
    addToHistory(entry, entry.isCorrection);
  }

  // 显示浮层
  if (overlayRoot && isVisible) {
    overlayRoot.style.opacity = '1';
    console.log('[SubtitleOverlay] 浮层已设为可见, opacity:', overlayRoot.style.opacity);
  } else if (!isVisible) {
    console.log('[SubtitleOverlay] 浮层被隐藏 (isVisible=false)');
  }
}

/**
 * 添加字幕到历史记录
 */
function addToHistory(entry: SubtitleEntry, isCorrection?: boolean): void {
  if (!historyContainer) return;

  const container = historyContainer; // 类型收窄

  // 如果是修正，更新已存在的条目
  if (isCorrection) {
    const existingIndex = displayedSubtitles.findIndex(sub => sub.id === entry.id);
    if (existingIndex >= 0) {
      displayedSubtitles[existingIndex] = entry;
    } else {
      // 如果找不到，添加新条目
      displayedSubtitles.push(entry);
    }
  } else {
    displayedSubtitles.push(entry);
  }

  if (displayedSubtitles.length > displaySettings.maxLines) {
    displayedSubtitles.shift();
  }

  // 重建历史字幕
  container.innerHTML = '';
  displayedSubtitles.forEach((sub, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    if (index === displayedSubtitles.length - 1) {
      item.classList.add('latest');
    }

    // 如果是修正的条目，添加修正动画
    if (isCorrection && sub.id === entry.id) {
      item.classList.add('corrected');
    }

    const opacity = 0.4 + (index / displayedSubtitles.length) * 0.3;

    item.innerHTML = `
      <div class="history-original" style="display: ${bilingualMode ? 'block' : 'none'}">${escapeHtml(sub.original)}</div>
      <div class="history-translated">${escapeHtml(sub.translated)}</div>
    `;

    (item as HTMLElement).style.opacity = String(opacity);
    container.appendChild(item);
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

  // 缩放手柄
  const resizeHandle = wrapper.querySelector('.resize-handle');
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', onResizeStart);
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  // 控制按钮
  wrapper.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-action]') as HTMLElement;
    if (!btn) return;

    const action = btn.dataset.action;
    switch (action) {
      case 'bilingual':
        bilingualMode = !bilingualMode;
        displaySettings.bilingual = bilingualMode;
        btn.classList.toggle('active', bilingualMode);
        if (currentSubtitleEl) {
          const originalEl = currentSubtitleEl.querySelector('.original-text');
          if (originalEl) {
            (originalEl as HTMLElement).style.display = bilingualMode ? 'block' : 'none';
          }
        }
        // 更新历史记录显示
        if (historyContainer) {
          historyContainer.querySelectorAll('.history-original').forEach(el => {
            (el as HTMLElement).style.display = bilingualMode ? 'block' : 'none';
          });
        }
        break;
      case 'style':
        switchStylePreset();
        break;
      case 'position':
        const positions: Array<'top' | 'middle' | 'bottom'> = ['top', 'middle', 'bottom'];
        const currentIndex = positions.indexOf(displaySettings.subtitlePosition);
        const nextPosition = positions[(currentIndex + 1) % 3];
        displaySettings.subtitlePosition = nextPosition;
        setPosition(nextPosition);
        break;
      case 'scaleUp':
        applyScale(currentScale + 0.1);
        break;
      case 'scaleDown':
        applyScale(currentScale - 0.1);
        break;
      case 'lock':
        isLocked = !isLocked;
        btn.classList.toggle('active', isLocked);
        if (dragHandle) {
          (dragHandle as HTMLElement).style.display = isLocked ? 'none' : 'block';
        }
        if (resizeHandle) {
          (resizeHandle as HTMLElement).style.display = isLocked ? 'none' : 'block';
        }
        break;
      case 'hide':
        isVisible = false;
        if (overlayRoot) {
          overlayRoot.style.opacity = '0';
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
      isVisible = !isVisible;
      if (overlayRoot) {
        overlayRoot.style.opacity = isVisible ? '1' : '0';
      }
    }
    // Ctrl+Shift+L: 锁定/解锁
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      isLocked = !isLocked;
      if (dragHandle) {
        (dragHandle as HTMLElement).style.display = isLocked ? 'none' : 'block';
      }
    }
    // Ctrl+Shift+B: 切换双语
    if (e.ctrlKey && e.shiftKey && e.key === 'B') {
      bilingualMode = !bilingualMode;
      displaySettings.bilingual = bilingualMode;
      updateBilingualButton();
    }
    // Ctrl+Shift+S: 切换样式
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      switchStylePreset();
    }
    // Ctrl++: 放大
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
      applyScale(currentScale + 0.1);
    }
    // Ctrl+-: 缩小
    if (e.ctrlKey && e.key === '-') {
      applyScale(currentScale - 0.1);
    }
  });

  // 监听全屏变化，调整位置
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      // 全屏模式下，将浮层移到全屏元素内
      document.fullscreenElement.appendChild(overlayRoot!);
    } else {
      // 退出全屏，移回 body
      document.body.appendChild(overlayRoot!);
    }
    setPosition(displaySettings.subtitlePosition);
  });
}

/**
 * 拖拽开始
 */
function onDragStart(e: Event): void {
  if (isLocked) return;
  e.preventDefault();
  const mouseEvent = e as MouseEvent;
  isDragging = true;

  if (overlayRoot) {
    const rect = overlayRoot.getBoundingClientRect();
    dragOffset.x = mouseEvent.clientX - rect.left;
    dragOffset.y = mouseEvent.clientY - rect.top;
    overlayRoot.style.transform = `scale(${currentScale})`;
    overlayRoot.style.left = `${rect.left}px`;
    overlayRoot.style.top = `${rect.top}px`;
    overlayRoot.style.bottom = 'auto';
  }
}

/**
 * 拖拽移动
 */
function onDragMove(e: Event): void {
  if (!isDragging || !overlayRoot) return;
  const mouseEvent = e as MouseEvent;

  // 边界检查
  const newX = mouseEvent.clientX - dragOffset.x;
  const newY = mouseEvent.clientY - dragOffset.y;

  const maxX = window.innerWidth - 100;
  const maxY = window.innerHeight - 50;

  overlayRoot.style.left = `${Math.max(0, Math.min(newX, maxX))}px`;
  overlayRoot.style.top = `${Math.max(0, Math.min(newY, maxY))}px`;
}

/**
 * 拖拽结束
 */
function onDragEnd(): void {
  isDragging = false;
}

/**
 * 缩放开始
 */
function onResizeStart(e: Event): void {
  if (isLocked) return;
  e.preventDefault();
  const mouseEvent = e as MouseEvent;
  isResizing = true;

  if (subtitleContainer) {
    resizeStartWidth = subtitleContainer.offsetWidth;
    resizeStartX = mouseEvent.clientX;
  }
}

/**
 * 缩放移动
 */
function onResizeMove(e: Event): void {
  if (!isResizing) return;
  const mouseEvent = e as MouseEvent;

  const deltaX = mouseEvent.clientX - resizeStartX;
  const newWidth = Math.max(300, Math.min(1000, resizeStartWidth + deltaX));

  if (subtitleContainer) {
    subtitleContainer.style.width = `${newWidth}px`;
    subtitleContainer.style.minWidth = `${newWidth}px`;
    subtitleContainer.style.maxWidth = `${newWidth}px`;
  }
}

/**
 * 缩放结束
 */
function onResizeEnd(): void {
  isResizing = false;
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
  displayedSubtitles = [];
}

/**
 * 显示浮层
 */
export function showSubtitleOverlay(): void {
  isVisible = true;
  if (overlayRoot) {
    overlayRoot.style.opacity = '1';
  }
}

/**
 * 隐藏浮层
 */
export function hideSubtitleOverlay(): void {
  isVisible = false;
  if (overlayRoot) {
    overlayRoot.style.opacity = '0';
  }
}

/**
 * 获取当前状态
 */
export function getOverlayState(): {
  isVisible: boolean;
  isLocked: boolean;
  bilingualMode: boolean;
  position: 'top' | 'middle' | 'bottom';
  scale: number;
  preset: string;
} {
  return {
    isVisible,
    isLocked,
    bilingualMode,
    position: displaySettings.subtitlePosition,
    scale: currentScale,
    preset: currentPreset,
  };
}

/**
 * 获取所有样式预设
 */
export function getStylePresets(): Record<string, StylePreset> {
  return STYLE_PRESETS;
}

/**
 * 设置样式预设
 */
export function setStylePreset(presetName: string): void {
  if (STYLE_PRESETS[presetName]) {
    currentPreset = presetName;
    if (shadowRoot) {
      const styleEl = shadowRoot.querySelector('style');
      if (styleEl) {
        styleEl.textContent = getStyles(displaySettings, currentPreset);
      }
    }
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
 * 获取样式（支持预设）
 */
function getStyles(settings: DisplaySettings, presetName: string): string {
  const preset = STYLE_PRESETS[presetName] || STYLE_PRESETS.default;
  const fontSize = settings.subtitleFontSize * preset.fontSizeRatio;

  return `
    :host {
      all: initial;
    }

    .subtitle-wrapper {
      background: ${preset.background};
      border-radius: ${preset.borderRadius};
      padding: 12px 16px;
      min-width: 400px;
      max-width: 800px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      position: relative;
      user-select: none;
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

    .resize-handle {
      position: absolute;
      bottom: 4px;
      right: 4px;
      cursor: ew-resize;
      color: rgba(255, 255, 255, 0.3);
      padding: 2px;
      transition: color 0.2s;
      display: block;
    }

    .resize-handle:hover {
      color: rgba(255, 255, 255, 0.7);
    }

    .controls {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
      flex-wrap: wrap;
      max-width: 200px;
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
      color: ${preset.originalColor};
      font-size: ${fontSize - 7}px;
      margin-bottom: 4px;
      font-style: italic;
      transition: opacity 0.3s;
    }

    .original-text.partial {
      opacity: 0.5;
    }

    .translated-text {
      display: block;
      color: ${preset.textColor};
      font-size: ${fontSize}px;
      font-weight: 500;
      line-height: 1.4;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      transition: opacity 0.3s;
    }

    .history-container {
      margin-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 8px;
      max-height: 120px;
      overflow-y: auto;
    }

    .history-item {
      padding: 4px 0;
      animation: slideUp 0.3s ease-out;
    }

    .history-item.latest {
      animation: fadeIn 0.3s ease-in;
    }

    .history-original {
      color: ${preset.originalColor};
      font-size: 11px;
      margin-bottom: 2px;
      font-style: italic;
    }

    .history-translated {
      color: ${preset.textColor};
      font-size: 14px;
      opacity: 0.8;
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

    /* 修正动画 */
    @keyframes correctionFlash {
      0% { background-color: rgba(255, 200, 0, 0.3); }
      50% { background-color: rgba(255, 200, 0, 0.1); }
      100% { background-color: transparent; }
    }

    @keyframes correctingText {
      0% { opacity: 0.5; transform: scale(0.98); }
      50% { opacity: 0.8; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .current-subtitle.correction {
      animation: correctionFlash 0.5s ease-out;
    }

    .original-text.correcting {
      animation: correctingText 0.3s ease-out;
      color: #FFD700;
    }

    .history-item.corrected {
      animation: correctionFlash 0.5s ease-out;
      border-left: 2px solid rgba(255, 200, 0, 0.6);
      padding-left: 8px;
    }

    /* 滚动条样式 */
    .history-container::-webkit-scrollbar {
      width: 4px;
    }

    .history-container::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
    }

    .history-container::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
    }
  `;
}