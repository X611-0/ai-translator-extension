import React, { useState, useEffect } from 'react';
import { AppSettings, XFYunConfig, AliyunConfig } from '@/types';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validateXFYunConfig, validateAliyunConfig } from '@/config';

const Options: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    const xfValidation = validateXFYunConfig(settings.xfyun);
    const aliValidation = validateAliyunConfig(settings.aliyun);
    const allErrors = [...xfValidation.errors, ...aliValidation.errors];

    if (allErrors.length > 0) {
      setErrors(allErrors);
      return;
    }

    try {
      await saveSettings(settings);
      setErrors([]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setErrors(['保存失败']);
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
          <p className="text-gray-400 text-sm mt-1">配置讯飞语音识别和阿里云翻译服务</p>
        </div>

        {/* 错误提示 */}
        {errors.length > 0 && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-4">
            <h3 className="font-medium text-red-200">配置错误：</h3>
            <ul className="list-disc list-inside text-sm text-red-300 mt-2">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 保存成功提示 */}
        {saved && (
          <div className="bg-green-900/50 border border-green-700 rounded-lg p-4 text-green-200">
            保存成功！
          </div>
        )}

        {/* 讯飞配置 */}
        <section className="bg-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">
              讯
            </div>
            <div>
              <h2 className="font-semibold">讯飞语音识别</h2>
              <a
                href="https://www.xfyun.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline"
              >
                前往讯飞开放平台 →
              </a>
            </div>
          </div>

          <div className="grid gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">AppID</label>
              <input
                type="text"
                value={settings.xfyun.appId}
                onChange={(e) => updateXFYun('appId', e.target.value)}
                placeholder="请输入 AppID"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">APIKey</label>
              <input
                type="password"
                value={settings.xfyun.apiKey}
                onChange={(e) => updateXFYun('apiKey', e.target.value)}
                placeholder="请输入 APIKey"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">APISecret</label>
              <input
                type="password"
                value={settings.xfyun.apiSecret}
                onChange={(e) => updateXFYun('apiSecret', e.target.value)}
                placeholder="请输入 APISecret"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <p className="text-xs text-gray-500">
            新用户有 5万次/年免费额度，足够个人使用
          </p>
        </section>

        {/* 阿里云配置 */}
        <section className="bg-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center text-sm font-bold">
              云
            </div>
            <div>
              <h2 className="font-semibold">阿里云翻译</h2>
              <a
                href="https://help.aliyun.com/product/301.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-orange-400 hover:underline"
              >
                前往阿里云机器翻译 →
              </a>
            </div>
          </div>

          <div className="grid gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">AccessKeyId</label>
              <input
                type="text"
                value={settings.aliyun.accessKeyId}
                onChange={(e) => updateAliyun('accessKeyId', e.target.value)}
                placeholder="请输入 AccessKeyId"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">AccessKeySecret</label>
              <input
                type="password"
                value={settings.aliyun.accessKeySecret}
                onChange={(e) => updateAliyun('accessKeySecret', e.target.value)}
                placeholder="请输入 AccessKeySecret"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <p className="text-xs text-gray-500">
            需要开通机器翻译服务，新用户有免费额度
          </p>
        </section>

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
            AI同声传译助手 v1.0.0
          </p>
        </div>
      </div>
    </div>
  );
};

export default Options;
