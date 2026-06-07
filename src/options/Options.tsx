import React, { useState, useEffect } from 'react';
import { AppSettings, DisplaySettings, LanguageSettings, XFYunConfig, AliyunConfig } from '@/types';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/config';

type TabKey = 'api' | 'display' | 'language';

const Options: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('api');
  const [showSecrets, setShowSecrets] = useState(false);
  const [testStatus, setTestStatus] = useState<{ xfyun?: string; aliyun?: string; tts?: string }>({});
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  // 测试阿里云翻译连接（先保存再通过 background 代理）
  const handleTestAliyun = async () => {
    setTesting(true);
    setTestStatus(prev => ({ ...prev, aliyun: '保存并测试中...' }));

    try {
      // 先保存配置
      await saveSettings(settings);

      const { accessKeyId, accessKeySecret } = settings.aliyun;
      if (!accessKeyId || !accessKeySecret) {
        setTestStatus(prev => ({ ...prev, aliyun: '❌ 请先填写 AccessKey' }));
        setTesting(false);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'TEST_ALIYUN_API',
        payload: { service: 'translation', accessKeyId, accessKeySecret },
      });

      if (response?.success) {
        setTestStatus(prev => ({ ...prev, aliyun: `✅ 翻译连接成功! "hello" → "${response.data}"` }));
      } else {
        setTestStatus(prev => ({ ...prev, aliyun: `❌ ${response?.error || '未知错误'}` }));
      }
    } catch (err: any) {
      setTestStatus(prev => ({ ...prev, aliyun: `❌ 请求失败: ${err.message}。请确认已 Reload 扩展` }));
    }
    setTesting(false);
  };

  // 测试阿里云 TTS 连接（先保存再通过 background 代理）
  const handleTestTTS = async () => {
    setTesting(true);
    setTestStatus(prev => ({ ...prev, tts: '保存并测试中...' }));

    try {
      // 先保存配置
      await saveSettings(settings);

      const { accessKeyId, accessKeySecret, ttsAppKey } = settings.aliyun;
      if (!accessKeyId || !accessKeySecret) {
        setTestStatus(prev => ({ ...prev, tts: '❌ 请先填写 AccessKey' }));
        setTesting(false);
        return;
      }
      if (!ttsAppKey) {
        setTestStatus(prev => ({ ...prev, tts: '❌ 请先填写语音合成 AppKey（在 nls.console.aliyun.com 创建项目）' }));
        setTesting(false);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'TEST_ALIYUN_API',
        payload: { service: 'tts', accessKeyId, accessKeySecret, appKey: ttsAppKey },
      });

      if (response?.success) {
        setTestStatus(prev => ({ ...prev, tts: `✅ TTS 连接成功! 任务ID: ${response.data}` }));
      } else {
        setTestStatus(prev => ({ ...prev, tts: `❌ ${response?.error || '未知错误'}` }));
      }
    } catch (err: any) {
      setTestStatus(prev => ({ ...prev, tts: `❌ 请求失败: ${err.message}。请确认已 Reload 扩展` }));
    }
    setTesting(false);
  };

  // 测试讯飞配置（验证格式）
  const handleTestXFYun = () => {
    setTestStatus(prev => ({ ...prev, xfyun: '' }));
    const { appId, apiKey, apiSecret } = settings.xfyun;
    if (!appId || !apiKey || !apiSecret) {
      setTestStatus(prev => ({ ...prev, xfyun: '❌ 请填写完整的讯飞配置' }));
      return;
    }
    if (!/^[a-f0-9]{8}$/i.test(appId.trim())) {
      setTestStatus(prev => ({ ...prev, xfyun: '❌ App ID 格式不正确 (应为8位十六进制)' }));
      return;
    }
    setTestStatus(prev => ({ ...prev, xfyun: '✅ 配置格式正确 (实际连接需启动翻译时验证)' }));
  };

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('保存失败:', err);
    }
  };

  const updateXFYun = (field: keyof XFYunConfig, value: string) => {
    setSettings((prev) => ({
      ...prev,
      xfyun: { ...prev.xfyun, [field]: value },
    }));
  };

  const updateAliyun = (field: keyof AliyunConfig, value: string) => {
    setSettings((prev) => ({
      ...prev,
      aliyun: { ...prev.aliyun, [field]: value },
    }));
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
          <p className="text-gray-400 text-sm mt-1">配置 API 密钥、显示偏好和语言</p>
        </div>

        {/* 标签页导航 */}
        <div className="flex space-x-2 bg-gray-800 rounded-lg p-1">
          {[
            { key: 'api', label: 'API 密钥', icon: '🔑' },
            { key: 'display', label: '显示设置', icon: '🎨' },
            { key: 'language', label: '语言设置', icon: '🌐' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabKey)}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 保存成功提示 */}
        {saved && (
          <div className="bg-green-900/50 border border-green-700 rounded-lg p-4 text-green-200 text-sm">
            ✅ 设置已保存！刷新页面后生效。
          </div>
        )}

        {/* ========== API 密钥设置 ========== */}
        {activeTab === 'api' && (
          <section className="space-y-4">
            {/* 讯飞设置 */}
            <div className="bg-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="font-semibold flex items-center space-x-2">
                <span>🎤</span>
                <span>讯飞语音识别 (AST)</span>
              </h2>
              <p className="text-xs text-gray-500">
                前往 <a href="https://console.xfyun.cn/" target="_blank" className="text-indigo-400 underline">讯飞开放平台控制台</a> 获取，
                需开通「实时语音转写」服务
              </p>

              <div className="grid gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">App ID</label>
                  <input
                    type="text"
                    value={settings.xfyun.appId}
                    onChange={(e) => updateXFYun('appId', e.target.value)}
                    placeholder="例如: 65692fc6"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">API Key (accessKeyId)</label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={settings.xfyun.apiKey}
                    onChange={(e) => updateXFYun('apiKey', e.target.value)}
                    placeholder="32位十六进制字符串"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">API Secret (用于签名)</label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={settings.xfyun.apiSecret}
                    onChange={(e) => updateXFYun('apiSecret', e.target.value)}
                    placeholder="32位字符串"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  {showSecrets ? '🙈 隐藏密钥' : '👁 显示密钥'}
                </button>
                <button
                  onClick={handleTestXFYun}
                  className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-600 rounded px-2 py-0.5"
                >
                  🔍 验证配置
                </button>
              </div>
              {testStatus.xfyun && (
                <div className={`text-xs rounded p-2 ${
                  testStatus.xfyun.startsWith('✅') ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                }`}>
                  {testStatus.xfyun}
                </div>
              )}
            </div>

            {/* 阿里云设置 */}
            <div className="bg-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="font-semibold flex items-center space-x-2">
                <span>🌍</span>
                <span>阿里云翻译</span>
              </h2>
              <p className="text-xs text-gray-500">
                前往 <a href="https://ram.console.aliyun.com/manage/ak" target="_blank" className="text-indigo-400 underline">阿里云 RAM 访问控制</a> 获取 AccessKey
              </p>

              <div className="grid gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">AccessKey ID</label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={settings.aliyun.accessKeyId}
                    onChange={(e) => updateAliyun('accessKeyId', e.target.value)}
                    placeholder="例如: LTAI5t..."
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">AccessKey Secret</label>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    value={settings.aliyun.accessKeySecret}
                    onChange={(e) => updateAliyun('accessKeySecret', e.target.value)}
                    placeholder="例如: ***"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {/* TTS AppKey */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  语音合成 AppKey <span className="text-gray-600">(可选，需朗读功能时填写)</span>
                </label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  value={settings.aliyun.ttsAppKey || ''}
                  onChange={(e) => updateAliyun('ttsAppKey', e.target.value)}
                  placeholder="在 nls.console.aliyun.com 创建项目获取"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono"
                />
                <p className="text-xs text-gray-600 mt-1">
                  前往 <a href="https://nls.console.aliyun.com/" target="_blank" className="text-indigo-400 underline">智能语音交互控制台</a> 创建项目获取 AppKey
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  {showSecrets ? '🙈 隐藏密钥' : '👁 显示密钥'}
                </button>
                <button
                  onClick={handleTestAliyun}
                  disabled={testing}
                  className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-600 rounded px-2 py-0.5 disabled:opacity-50"
                >
                  {testing ? '⏳' : '🔍'} 测试翻译
                </button>
                <button
                  onClick={handleTestTTS}
                  disabled={testing}
                  className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-600 rounded px-2 py-0.5 disabled:opacity-50"
                >
                  🔍 测试语音
                </button>
              </div>
              {testStatus.aliyun && (
                <div className={`text-xs rounded p-2 ${
                  testStatus.aliyun.startsWith('✅') ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                }`}>
                  {testStatus.aliyun}
                </div>
              )}
              {testStatus.tts && (
                <div className={`text-xs rounded p-2 ${
                  testStatus.tts.startsWith('✅') ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                }`}>
                  {testStatus.tts}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ========== 显示设置 ========== */}
        {activeTab === 'display' && (
          <section className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold flex items-center space-x-2">
              <span>🎨</span>
              <span>字幕显示设置</span>
            </h2>

            <div className="grid gap-4">
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

        {/* ========== 语言设置 ========== */}
        {activeTab === 'language' && (
          <section className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold flex items-center space-x-2">
              <span>🌐</span>
              <span>语言设置</span>
            </h2>

            <div className="grid gap-4">
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

        {/* 保存 / 重置按钮 */}
        <div className="flex space-x-4">
          <button
            onClick={handleSave}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            保存设置
          </button>

          <button
            onClick={() => { setSettings(DEFAULT_SETTINGS); }}
            className="px-6 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium py-2.5 rounded-lg transition-colors"
          >
            重置
          </button>
        </div>

        <div className="border-t border-gray-700 pt-4 text-center">
          <p className="text-xs text-gray-500">AI同声传译助手 v1.0.0</p>
        </div>
      </div>
    </div>
  );
};

export default Options;
