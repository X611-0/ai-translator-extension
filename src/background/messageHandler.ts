import { XFYunRecognition } from '@/services/xfyun/recognition';
import { AliyunTranslation } from '@/services/aliyun/translation';
import { Corrector } from '@/services/corrector';
import { AppSettings, SubtitleEntry, RecognitionResult } from '@/types';
import { generateId } from '@/utils/storage';

/**
 * 消息处理器
 * 协调语音识别、翻译、修正和UI更新
 */
export class MessageHandler {
  private xfyunRecognition: XFYunRecognition | null = null;
  private aliyunTranslation: AliyunTranslation | null = null;
  private corrector: Corrector;
  private tabId: number | null = null; // 目标标签页ID
  private segmentCount = 0;
  private pendingSegments: Map<number, { text: string; id: string }> = new Map(); // 待翻译的句子

  constructor(tabId?: number) {
    this.corrector = new Corrector();
    this.tabId = tabId;
  }

  /**
   * 将源语言转换为讯飞语言代码
   */
  private convertToXfyunLanguage(sourceLanguage: string): string {
    // 讯飞支持的语言代码映射
    const languageMap: Record<string, string> = {
      'en': 'en_us',      // 英语
      'en-US': 'en_us',
      'zh': 'zh_cn',      // 中文
      'zh-CN': 'zh_cn',
      'ja': 'ja_jp',      // 日语
      'ja-JP': 'ja_jp',
      'ko': 'ko_kr',      // 韩语
      'ko-KR': 'ko_kr',
      'ru': 'ru_ru',      // 俄语
      'ru-RU': 'ru_ru',
      'es': 'es_es',      // 西班牙语
      'es-ES': 'es_es',
      'fr': 'fr_fr',      // 法语
      'fr-FR': 'fr_fr',
      'de': 'de_de',      // 德语
      'de-DE': 'de_de',
      'ar': 'ar_ar',      // 阿拉伯语
      'ar-SA': 'ar_ar',
      'pt': 'pt_pt',      // 葡萄牙语
      'pt-PT': 'pt_pt',
      'vi': 'vi_vn',      // 越南语
      'vi-VN': 'vi_vn',
      'th': 'th_th',      // 泰语
      'th-TH': 'th_th',
    };
    return languageMap[sourceLanguage] || 'en_us'; // 默认英文
  }

  /**
   * 设置目标标签页
   */
  setTabId(tabId: number): void {
    this.tabId = tabId;
  }

  /**
   * 处理音频数据
   */
  async onAudioData(audioData: ArrayBuffer, settings: AppSettings): Promise<void> {
    console.log('[MessageHandler] 收到音频数据, xfyunRecognition:', !!this.xfyunRecognition);

    if (!this.xfyunRecognition) {
      console.log('[MessageHandler] 初始化讯飞识别...');
      // 将源语言转换为讯飞语言代码
      const xfyunLanguage = this.convertToXfyunLanguage(settings.languages.sourceLanguage);
      const xfyunConfig = {
        ...settings.xfyun,
        language: xfyunLanguage,
      };
      console.log('[MessageHandler] 讯飞语言设置:', xfyunLanguage, '源语言:', settings.languages.sourceLanguage);

      this.xfyunRecognition = new XFYunRecognition(xfyunConfig);
      this.aliyunTranslation = new AliyunTranslation(settings.aliyun);

      // 设置识别回调
      this.xfyunRecognition.onResult((result) => {
        console.log('[MessageHandler] 收到识别结果:', result);
        this.handleRecognitionResult(result, settings);
      });
    }

    // 发送音频数据到讯飞
    try {
      console.log('[MessageHandler] 发送音频数据到讯飞, byteLength:', audioData.byteLength);
      await this.xfyunRecognition.sendAudio(audioData);
    } catch (err) {
      console.error('[MessageHandler] 发送音频数据失败:', err);
    }
  }

  /**
   * 处理识别结果
   */
  private async handleRecognitionResult(
    result: RecognitionResult,
    settings: AppSettings
  ): Promise<void> {
    const { text, isEnd, segmentId, isCorrection, sn, pgs } = result;

    console.log('[MessageHandler] handleRecognitionResult:', { 
      text: text.substring(0, 50), 
      isEnd, 
      segmentId, 
      isCorrection, 
      sn, 
      pgs,
      tabId: this.tabId 
    });

    if (!text.trim()) {
      console.log('[MessageHandler] 文本为空，跳过');
      return;
    }

    // 处理修正结果
    if (isCorrection && sn !== undefined) {
      console.log('[MessageHandler] 处理修正结果, sn:', sn);
      
      // 查找原始句子
      const originalSegment = this.pendingSegments.get(sn);
      if (originalSegment) {
        // 发送修正后的原文（带动画标记）
        this.sendSubtitleToContent({
          id: originalSegment.id,
          original: text,
          translated: '', // 修正时先清空翻译，等待新翻译
          isEnd: false,
          timestamp: Date.now(),
          isCorrection: true, // 标记为修正
        });

        // 重新翻译修正后的文本
        if (this.aliyunTranslation) {
          try {
            const translated = await this.aliyunTranslation.translate(text, settings);
            this.sendSubtitleToContent({
              id: originalSegment.id,
              original: text,
              translated,
              isEnd: true,
              timestamp: Date.now(),
              isCorrection: true,
            });
            
            // 更新 pendingSegments
            this.pendingSegments.set(sn, { text, id: originalSegment.id });
            
            // 更新历史记录
            this.corrector.updateTranslation(originalSegment.id, translated);
          } catch (err) {
            console.error('[MessageHandler] 修正翻译失败:', err);
          }
        }
      }
      return;
    }

    // 检查是否为相似修正（通过相似度检测）
    const correction = this.corrector.checkCorrection(text, segmentId);

    if (correction) {
      console.log('[MessageHandler] 检测到相似修正');
      this.sendSubtitleToContent({
        id: correction.id,
        original: text,
        translated: correction.translated || '',
        isEnd,
        timestamp: Date.now(),
        isCorrection: true,
      });
      return;
    }

    // 如果是最终结果，进行翻译
    if (isEnd && this.aliyunTranslation) {
      console.log('[MessageHandler] 最终结果，开始翻译');
      try {
        const translated = await this.aliyunTranslation.translate(text, settings);
        this.segmentCount++;

        const id = generateId();
        const entry: SubtitleEntry = {
          id,
          original: text,
          translated,
          isEnd: true,
          timestamp: Date.now(),
        };

        // 记录 sn 到 pendingSegments（用于修正）
        if (sn !== undefined) {
          this.pendingSegments.set(sn, { text, id });
        }

        this.corrector.addToHistory(entry);
        this.sendSubtitleToContent(entry);
      } catch (err) {
        console.error('[MessageHandler] 翻译失败:', err);
      }
    } else if (!isEnd) {
      // 中间结果，先显示原文
      console.log('[MessageHandler] 中间结果，发送原文');
      this.sendSubtitleToContent({
        id: `partial_${segmentId}`,
        original: text,
        translated: '',
        isEnd: false,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 发送字幕到content script
   */
  private sendSubtitleToContent(entry: SubtitleEntry): void {
    if (!this.tabId) {
      console.error('[MessageHandler] 没有目标标签页ID');
      return;
    }

    console.log('[MessageHandler] sendSubtitleToContent:', { tabId: this.tabId, entry });

    chrome.tabs.sendMessage(this.tabId, {
      type: 'TRANSLATION_RESULT',
      payload: entry,
    }).then((response) => {
      console.log('[MessageHandler] 字幕发送成功, response:', JSON.stringify(response));
    }).catch((err) => {
      console.error('[MessageHandler] 发送字幕失败:', err.message, '— content script 可能未注入或页面不可访问');
    });
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.xfyunRecognition) {
      this.xfyunRecognition.close();
      this.xfyunRecognition = null;
    }
    this.aliyunTranslation = null;
    this.corrector.clear();
    this.segmentCount = 0;
  }
}