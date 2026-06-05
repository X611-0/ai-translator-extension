/**
 * 阿里云机器翻译服务
 * 调用阿里云翻译API进行实时翻译
 */

import { AliyunConfig, AppSettings } from '@/types';
import axios from 'axios';

export class AliyunTranslation {
  private config: AliyunConfig;
  private cache: Map<string, string> = new Map();
  private contextWindow: string[] = [];
  private maxContextSize = 5;

  // 阿里云翻译API端点
  private readonly ENDPOINT = 'https://mt.cn-hangzhou.aliyuncs.com/api/translate/web/general';

  constructor(config: AliyunConfig) {
    this.config = config;
  }

  /**
   * 翻译文本
   */
  async translate(text: string, settings: AppSettings): Promise<string> {
    if (!text.trim()) return '';

    // 检查缓存
    const cached = this.cache.get(text);
    if (cached) return cached;

    try {
      const translated = await this.callTranslationAPI(text, settings);

      // 缓存翻译结果
      this.cache.set(text, translated);

      // 更新上下文窗口
      this.contextWindow.push(text);
      if (this.contextWindow.length > this.maxContextSize) {
        this.contextWindow.shift();
      }

      return translated;
    } catch (err) {
      console.error('[AliyunTranslation] 翻译失败:', err);
      // 返回原文作为fallback
      return `[翻译失败] ${text}`;
    }
  }

  /**
   * 批量翻译（用于优化性能）
   */
  async translateBatch(texts: string[], settings: AppSettings): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const uncached: string[] = [];

    // 分离已缓存和未缓存的
    for (const text of texts) {
      const cached = this.cache.get(text);
      if (cached) {
        results.set(text, cached);
      } else {
        uncached.push(text);
      }
    }

    // 并行翻译未缓存的
    if (uncached.length > 0) {
      const translations = await Promise.allSettled(
        uncached.map((text) => this.callTranslationAPI(text, settings))
      );

      translations.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.set(uncached[index], result.value);
          this.cache.set(uncached[index], result.value);
        } else {
          results.set(uncached[index], `[翻译失败] ${uncached[index]}`);
        }
      });
    }

    return results;
  }

  /**
   * 调用阿里云翻译API
   * 注意：实际生产环境需要正确签名，这里使用简化的API调用
   */
  private async callTranslationAPI(text: string, settings: AppSettings): Promise<string> {
    const sourceLanguage = settings.languages?.sourceLanguage || 'en';
    const targetLanguage = settings.languages?.targetLanguage || 'zh';

    try {
      // 阿里云翻译API调用
      // 实际生产环境需要使用阿里云SDK进行签名
      const response = await axios.post(
        this.ENDPOINT,
        {
          SourceLanguage: sourceLanguage,
          TargetLanguage: targetLanguage,
          SourceText: text,
          FormatType: 'text',
          Scene: 'general',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.accessKeyId}:${this.config.accessKeySecret}`,
          },
          timeout: 10000,
        }
      );

      if (response.data?.Code === '200' && response.data?.Data?.Translated) {
        return response.data.Data.Translated;
      }

      // 如果API调用失败，使用模拟翻译作为开发阶段fallback
      console.warn('[AliyunTranslation] API返回异常，使用模拟翻译');
      return this.mockTranslate(text, sourceLanguage, targetLanguage);
    } catch (err) {
      // 开发阶段：API未配置时使用模拟翻译
      console.warn('[AliyunTranslation] API调用失败，使用模拟翻译:', (err as Error).message);
      return this.mockTranslate(text, sourceLanguage, targetLanguage);
    }
  }

  /**
   * 模拟翻译（开发阶段使用）
   * 实际部署时应该移除
   */
  private mockTranslate(text: string, source: string, target: string): string {
    // 简单的模拟翻译，用于开发测试
    if (source === 'en' && target === 'zh') {
      const mockTranslations: Record<string, string> = {
        'hello': '你好',
        'thank you': '谢谢',
        'good morning': '早上好',
        'how are you': '你好吗',
        'welcome': '欢迎',
        'goodbye': '再见',
        'please': '请',
        'sorry': '对不起',
        'yes': '是的',
        'no': '不是',
      };

      const lower = text.toLowerCase().trim();
      if (mockTranslations[lower]) {
        return mockTranslations[lower];
      }

      // 对于未知文本，添加标记
      return `[译] ${text}`;
    }

    return text;
  }

  /**
   * 获取上下文信息
   */
  getContext(): string[] {
    return [...this.contextWindow];
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.contextWindow = [];
  }
}