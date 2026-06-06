import React, { useState, useEffect } from 'react';
import { ExtensionMessage } from '@/types';
import { captureTabAudioInPopup } from './audioCapturePopup';

type OutputMode = 'subtitle' | 'speech' | 'both';
type Status = 'idle' | 'capturing' | 'recognizing' | 'translating' | 'error';

const Popup: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [outputMode, setOutputMode] = useState<OutputMode>('both');
  const [subtitleCount, setSubtitleCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ttsSpeed, setTtsSpeed] = useState(0);      // 语速 -500~500
  const [ttsVolume, setTtsVolume] = useState(80);   // 音量 0~100
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 检查状态
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
      } as ExtensionMessage);
      if (response?.isRunning !== undefined) {
        setIsRunning(response.isRunning);
        setStatus(response.status || 'idle');
      }
    } catch {
      // background可能未启动
    }
  };

  const handleStart = async () => {
    setErrorMessage(null);
    setStatus('capturing');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setErrorMessage('无法获取当前标签页');
        setStatus('idle');
        return;
      }

      // 在 popup 中捕获音频，获取 streamId（内部会先停止旧流）
      const captureResult = await captureTabAudioInPopup(tab.id);
      
      if (!captureResult.success) {
        setErrorMessage(captureResult.error || '音频捕获失败');
        setStatus('idle');
        return;
      }

      // 发送 streamId 给 background
      const response = await chrome.runtime.sendMessage({
        type: 'START_TRANSLATION',
        payload: { tabId: tab.id, streamId: captureResult.streamId },
      } as ExtensionMessage);

      if (response?.success) {
        setIsRunning(true);
        setStatus('translating');
      } else {
        setErrorMessage(response?.error || '启动失败');
        setStatus('idle');
      }
    } catch (err: any) {
      setErrorMessage(err.message || '启动失败，请检查设置');
      setStatus('idle');
    }
  };

  const handleStop = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'STOP_TRANSLATION',
      } as ExtensionMessage);
      setIsRunning(false);
      setStatus('idle');
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleOutputModeChange = (mode: OutputMode) => {
    setOutputMode(mode);
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { outputMode: mode },
    } as ExtensionMessage);
  };

  const handleOpenSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="p-4 space-y-4">
      {/* 标题 */}
      <div className="flex items-center space-x-2">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold">AI同声传译</h1>
          <p className="text-xs text-gray-400">实时翻译 · 双语字幕</p>
        </div>
      </div>

      {/* 状态指示 */}
      <div className="flex items-center space-x-2">
        <div
          className={`w-2 h-2 rounded-full ${
            isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
          }`}
        />
        <span className="text-sm text-gray-300">
          {isRunning ? getStatusText(status) : '未启动'}
        </span>
      </div>

      {/* 错误信息 */}
      {errorMessage && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-2 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      {/* 输出模式选择 */}
      <div className="space-y-1">
        <label className="text-xs text-gray-400">输出模式</label>
        <div className="flex space-x-1">
          {(['subtitle', 'speech', 'both'] as OutputMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleOutputModeChange(mode)}
              disabled={isRunning}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                outputMode === mode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {mode === 'subtitle' && '字幕'}
              {mode === 'speech' && '语音'}
              {mode === 'both' && '两者'}
            </button>
          ))}
        </div>
      </div>

      {/* 高级设置折叠 */}
      {(outputMode === 'speech' || outputMode === 'both') && (
        <div className="space-y-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center space-x-1 text-xs text-gray-400 hover:text-gray-300"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transform transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
            >
              <polyline points="9,18 15,12 9,6" />
            </svg>
            <span>语音设置</span>
          </button>

          {showAdvanced && (
            <div className="space-y-3 bg-gray-800 rounded-lg p-3">
              {/* 语速控制 */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">语速</span>
                  <span className="text-gray-200">
                    {ttsSpeed === 0 ? '正常' : ttsSpeed > 0 ? `+${ttsSpeed}` : ttsSpeed}
                  </span>
                </div>
                <input
                  type="range"
                  min="-500"
                  max="500"
                  value={ttsSpeed}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setTtsSpeed(value);
                    chrome.runtime.sendMessage({
                      type: 'UPDATE_TTS_SETTINGS',
                      payload: { speed: value },
                    });
                  }}
                  className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>慢</span>
                  <span>快</span>
                </div>
              </div>

              {/* 音量控制 */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">音量</span>
                  <span className="text-gray-200">{ttsVolume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={ttsVolume}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setTtsVolume(value);
                    chrome.runtime.sendMessage({
                      type: 'UPDATE_TTS_SETTINGS',
                      payload: { volume: value },
                    });
                  }}
                  className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>静音</span>
                  <span>最大</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 控制按钮 */}
      <div className="space-y-2">
        <button
          onClick={isRunning ? handleStop : handleStart}
          className={`w-full py-2.5 rounded-xl font-medium text-sm transition-all ${
            isRunning
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          }`}
        >
          {isRunning ? (
            <span className="flex items-center justify-center space-x-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              <span>停止翻译</span>
            </span>
          ) : (
            <span className="flex items-center justify-center space-x-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              <span>开始翻译</span>
            </span>
          )}
        </button>

        <button
          onClick={handleOpenSettings}
          className="w-full py-2 rounded-xl font-medium text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 transition-all"
        >
          <span className="flex items-center justify-center space-x-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            <span>设置</span>
          </span>
        </button>
      </div>

      {/* 统计信息 */}
      {isRunning && subtitleCount > 0 && (
        <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400">
          <div className="flex justify-between">
            <span>翻译句数</span>
            <span className="text-gray-200">{subtitleCount}</span>
          </div>
        </div>
      )}

      {/* 快捷键提示 */}
      <div className="border-t border-gray-700 pt-3">
        <p className="text-xs text-gray-500">
          <span className="text-gray-400">快捷键:</span>
          {' '}Ctrl+Shift+H 隐藏/显示
          {' '}| Ctrl+Shift+L 锁定
        </p>
      </div>
    </div>
  );
};

function getStatusText(status: Status): string {
  switch (status) {
    case 'capturing': return '正在捕获音频...';
    case 'recognizing': return '正在语音识别...';
    case 'translating': return '正在翻译...';
    case 'error': return '发生错误';
    default: return '空闲';
  }
}

export default Popup;