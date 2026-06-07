import React, { useState, useEffect } from 'react';
import { AppSettings, DisplaySettings, LanguageSettings } from '@/types';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/config';

const Options: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'display' | 'language'>('display');

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('保存失败:', err);
    }
  };

  const updateDisplay = (field: keyof DisplaySettings, value: any) => {
    setSettings((prev) => ({
      ...prev,
      display: { ...prev.display, [field]: value },
    }));
  };

  const updateLanguages = (field: keyof LanguageSettings, value: string) => {
    setSettings((prev) => ({
      ...prev,
      languages: { ...prev.languages, [field]: value },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 标题 */}
        <div className="border-b border-gray-700 pb-4">
          <h1 className="text-2xl font-bold">AI同声传译助手 - 设置</h1>
          <p className="text-gray-400 text-sm mt-1">配置显示偏好和语言设置</p>
        </div>

        {/* 标签页导航 */}
        <div className="flex space-x-2 bg-gray-800 rounded-lg p-1">
          {[
            { key: 'display', label: '显示设置', icon: '🎨' },
            { key: 'language', label: '语言设置', icon: '🌐' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 保存成功提示 */}
        {saved && (
          <div className="bg-green-900/50 border border-green-700 rounded-lg p-4 text-green-200">
            保存成功！
          </div>
        )}

        {/* 显示设置 */}
        {activeTab === 'display' && (
          <section className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold flex items-center space-x-2">
              <span>🎨</span>
              <span>字幕显示设置</span>
            </h2>

            <div className="grid gap-4">
              {/* 字幕位置 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">字幕位置</label>
                <div className="flex space-x-2">
                  {[
                    { value: 'top', label: '顶部' },
                    { value: 'middle', label: '中间' },
                    { value: 'bottom', label: '底部' },
                  ].map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => updateDisplay('subtitlePosition', pos.value)}
                      className={`px-4 py-2 rounded-lg text-sm ${
                        settings.display.subtitlePosition === pos.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 字体大小 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  字体大小: {settings.display.subtitleFontSize}px
                </label>
                <input
                  type="range"
                  min="12"
                  max="32"
                  value={settings.display.subtitleFontSize}
                  onChange={(e) => updateDisplay('subtitleFontSize', parseInt(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* 背景透明度 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  背景透明度: {Math.round(settings.display.subtitleBackgroundOpacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.display.subtitleBackgroundOpacity * 100}
                  onChange={(e) => updateDisplay('subtitleBackgroundOpacity', parseInt(e.target.value) / 100)}
                  className="w-full accent-indigo-600"
                />
              </div>

              {/* 字幕颜色 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">字幕颜色</label>
                <div className="flex space-x-2">
                  <input
                    type="color"
                    value={settings.display.subtitleColor}
                    onChange={(e) => updateDisplay('subtitleColor', e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={settings.display.subtitleColor}
                    onChange={(e) => updateDisplay('subtitleColor', e.target.value)}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* 最大行数 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">历史字幕行数</label>
                <select
                  value={settings.display.maxLines}
                  onChange={(e) => updateDisplay('maxLines', parseInt(e.target.value))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} 行</option>
                  ))}
                </select>
              </div>

              {/* 双语模式 */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-400">显示原文（双语模式）</label>
                <button
                  onClick={() => updateDisplay('bilingual', !settings.display.bilingual)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    settings.display.bilingual ? 'bg-indigo-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      settings.display.bilingual ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 语言设置 */}
        {activeTab === 'language' && (
          <section className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold flex items-center space-x-2">
              <span>🌐</span>
              <span>语言设置</span>
            </h2>

            <div className="grid gap-4">
              {/* 源语言 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">源语言（识别语言）</label>
                <select
                  value={settings.languages.sourceLanguage}
                  onChange={(e) => updateLanguages('sourceLanguage', e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm"
                >
                  {[
                    { value: 'en', label: '英语' },
                    { value: 'zh', label: '中文' },
                    { value: 'ja', label: '日语' },
                    { value: 'ko', label: '韩语' },
                    { value: 'ru', label: '俄语' },
                    { value: 'es', label: '西班牙语' },
                    { value: 'fr', label: '法语' },
                    { value: 'de', label: '德语' },
                    { value: 'ar', label: '阿拉伯语' },
                    { value: 'pt', label: '葡萄牙语' },
                    { value: 'vi', label: '越南语' },
                    { value: 'th', label: '泰语' },
                  ].map((lang) => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
              </div>

              {/* 目标语言 */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">目标语言（翻译语言）</label>
                <select
                  value={settings.languages.targetLanguage}
                  onChange={(e) => updateLanguages('targetLanguage', e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm"
                >
                  {[
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: '英语' },
                    { value: 'ja', label: '日语' },
                    { value: 'ko', label: '韩语' },
                    { value: 'ru', label: '俄语' },
                    { value: 'es', label: '西班牙语' },
                    { value: 'fr', label: '法语' },
                    { value: 'de', label: '德语' },
                  ].map((lang) => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-gray-500">
                源语言决定语音识别的语言，目标语言决定翻译结果的语言
              </p>
            </div>
          </section>
        )}

        {/* 保存按钮 */}
        <div className="flex space-x-4">
          <button
            onClick={handleSave}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            保存设置
          </button>

          <button
            onClick={() => setSettings(DEFAULT_SETTINGS)}
            className="px-6 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium py-2.5 rounded-lg transition-colors"
          >
            重置
          </button>
        </div>

        {/* 页脚 */}
        <div className="border-t border-gray-700 pt-4 text-center">
          <p className="text-xs text-gray-500">
            AI同声传译助手 v1.0.0 | API已内置，可直接使用
          </p>
        </div>
      </div>
    </div>
  );
};

export default Options;