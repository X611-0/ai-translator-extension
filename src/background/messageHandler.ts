import { XFYunRecognition } from '@/services/xfyun/recognition';
import { AliyunTranslation } from '@/services/aliyun/translation';
import { AliyunTTS } from '@/services/aliyun/tts';
import { Corrector } from '@/services/corrector';
import { AppSettings, SubtitleEntry, RecognitionResult } from '@/types';
import { generateId } from '@/utils/storage';

/**
 * 消息处理器
 * 协调语音识别、翻译、修正、TTS播报和UI更新
 */
export class MessageHandler {
  private xfyunRecognition: XFYunRecognition | null = null;
  private aliyunTranslation: AliyunTranslation | null = null;
  private aliyunTTS: AliyunTTS | null = null;
  private corrector: Corrector;
  private tabId: number | null = null; // 目标标签页ID
  private segmentCount = 0;
  private pendingSegments: Map<number, { text: string; id: string }> = new Map(); // 待翻译的句子
  private lastSpokenText: string = ''; // 上次播报的文本，避免重复播报

  constructor(tabId?: number) {
    this.corrector = new Corrector();
    this.tabId = tabId;
  }

  /**
   * 将源语言转换为讯飞 AST API 语言代码
   * AST API 的 lang 参数仅支持: autodialect (中英+方言), autominor (37语种)
   */
  private convertToXfyunLanguage(sourceLanguage: string): string {
    // 中英文使用 autodialect（免费，支持中英+202种方言）
    if (sourceLanguage === 'zh' || sourceLanguage === 'zh-CN' ||
        sourceLanguage === 'en' || sourceLanguage === 'en-US') {
      return 'autodialect';
    }
    // 其他语种使用 autominor（付费功能，支持37语种免切识别）
    return 'autominor';
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
    console.log('[MessageHandler] 阿里云配置:', {
      accessKeyId: settings.aliyun?.accessKeyId ? '已配置' : '未配置',
      accessKeySecret: settings.aliyun?.accessKeySecret ? '已配置' : '未配置',
    });

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
      
      // 初始化 TTS（如果启用语音播报）
      if (settings.features?.outputMode === 'voice' || settings.features?.outputMode === 'both') {
        this.aliyunTTS = new AliyunTTS(settings.aliyun);
        // 设置 TTS 参数
        if (settings.features?.ttsSpeed) {
          this.aliyunTTS.setSpeed(settings.features.ttsSpeed);
        }
        if (settings.features?.ttsVolume) {
          this.aliyunTTS.setVolume(settings.features.ttsVolume);
        }
        console.log('[MessageHandler] TTS 初始化完成, 模式:', settings.features?.outputMode);
      }
      
      console.log('[MessageHandler] 阿里云翻译初始化完成');

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

    // 如果是最终结果或中间结果较长，进行翻译
    const shouldTranslate = isEnd || (text.length > 10 && !isCorrection);

    if (shouldTranslate && this.aliyunTranslation) {
      console.log('[MessageHandler] 开始翻译, isEnd:', isEnd, 'textLength:', text.length);
      try {
        const translated = await this.aliyunTranslation.translate(text, settings);

        if (isEnd) {
          this.segmentCount++;
        }

        const id = isEnd ? generateId() : `partial_${segmentId}`;
        const entry: SubtitleEntry = {
          id,
          original: text,
          translated,
          isEnd,
          timestamp: Date.now(),
        };

        // 记录 sn 到 pendingSegments（用于修正）
        if (isEnd && sn !== undefined) {
          this.pendingSegments.set(sn, { text, id });
        }

        if (isEnd) {
          this.corrector.addToHistory(entry);
        }
        this.sendSubtitleToContent(entry);

        // TTS 语音播报（仅在最终结果时播报，避免重复）
        if (isEnd && translated && this.aliyunTTS && translated !== this.lastSpokenText) {
          this.lastSpokenText = translated;
          console.log('[MessageHandler] 开始 TTS 播报:', translated.substring(0, 30));
          try {
            await this.aliyunTTS.speak(translated);
            console.log('[MessageHandler] TTS 播报完成');
          } catch (ttsErr) {
            console.error('[MessageHandler] TTS 播报失败:', ttsErr);
          }
        }
      } catch (err) {
        console.error('[MessageHandler] 翻译失败:', err);
        // 翻译失败时也显示原文
        this.sendSubtitleToContent({
          id: `partial_${segmentId}`,
          original: text,
          translated: '',
          isEnd: false,
          timestamp: Date.now(),
        });
      }
    } else if (!isEnd && text.length <= 10) {
      // 短文本中间结果，先显示原文
      console.log('[MessageHandler] 短文本中间结果，发送原文');
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
    if (this.aliyunTTS) {
      this.aliyunTTS.stop();
      this.aliyunTTS.clear();
      this.aliyunTTS = null;
    }
    this.aliyunTranslation = null;
    this.corrector.clear();
    this.segmentCount = 0;
    this.lastSpokenText = '';
  }
}