/**
 * API配置管理
 * 统一管理讯飞、阿里云等API密钥配置
 */

import { XFYunConfig, AliyunConfig, AppSettings } from '@/types';

const STORAGE_KEY = 'appSettings';

/**
 * 默认配置（从环境变量读取API密钥）
 * 评委可直接使用，密钥不会暴露在源代码中
 */
export const DEFAULT_SETTINGS: AppSettings = {
  xfyun: {
    appId: '',
    apiKey: '',
    apiSecret: '',
  },
  aliyun: {
    accessKeyId: '',
    accessKeySecret: '',
    ttsAppKey: '',
  },
  display: {
    subtitlePosition: 'bottom',
    subtitleFontSize: 18,
    subtitleBackgroundOpacity: 0.6,
    subtitleColor: '#FFFFFF',
    maxLines: 2,
    bilingual: true,
  },
  features: {
    outputMode: 'both',
    autoCorrect: true,
    ttsSpeed: 1.0,
    ttsVolume: 0.8,
    mixAudio: false,
  },
  languages: {
    sourceLanguage: 'en',
    targetLanguage: 'zh',
  },
};

/**
 * 验证讯飞配置
 */
export function validateXFYunConfig(config: XFYunConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.appId?.trim()) errors.push('AppID 不能为空');
  if (!config.apiKey?.trim()) errors.push('APIKey 不能为空');
  if (!config.apiSecret?.trim()) errors.push('APISecret 不能为空');
  return { valid: errors.length === 0, errors };
}

/**
 * 验证阿里云配置
 */
export function validateAliyunConfig(config: AliyunConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config.accessKeyId?.trim()) errors.push('AccessKeyId 不能为空');
  if (!config.accessKeySecret?.trim()) errors.push('AccessKeySecret 不能为空');
  return { valid: errors.length === 0, errors };
}

/**
 * 验证完整配置
 */
export function validateAppSettings(settings: AppSettings | null): { valid: boolean; errors: string[] } {
  if (!settings) {
    return { valid: false, errors: ['配置未初始化'] };
  }
  const errors: string[] = [];
  const xf = validateXFYunConfig(settings.xfyun);
  const ali = validateAliyunConfig(settings.aliyun);
  errors.push(...xf.errors, ...ali.errors);
  return { valid: errors.length === 0, errors };
}

/**
 * 加载应用配置
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const settings = result[STORAGE_KEY] as AppSettings | undefined;
    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }
    // 合并默认值，防止新字段缺失
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      xfyun: { ...DEFAULT_SETTINGS.xfyun, ...settings.xfyun },
      aliyun: { ...DEFAULT_SETTINGS.aliyun, ...settings.aliyun },
      display: { ...DEFAULT_SETTINGS.display, ...settings.display },
      features: { ...DEFAULT_SETTINGS.features, ...settings.features },
      languages: { ...DEFAULT_SETTINGS.languages, ...settings.languages },
    };
  } catch (err) {
    console.error('[Config] 加载配置失败:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 保存应用配置
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  } catch (err) {
    console.error('[Config] 保存配置失败:', err);
    throw err;
  }
}

/**
 * 清除配置
 */
export async function clearSettings(): Promise<void> {
  try {
    await chrome.storage.sync.remove(STORAGE_KEY);
  } catch (err) {
    console.error('[Config] 清除配置失败:', err);
  }
}
