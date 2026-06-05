import { XFYunRecognition } from '@/services/xfyun/recognition';
import { AliyunTranslation } from '@/services/aliyun/translation';
import { Corrector } from '@/services/corrector';
import { AppSettings, SubtitleEntry } from '@/types';
import { generateId } from '@/utils/storage';

/**
 * 消息处理器
 * 协调语音识别、翻译、修正和UI更新
 */
export class MessageHandler {
  private xfyunRecognition: XFYunRecognition | null = null;
  private aliyunTranslation: AliyunTranslation | null = null;
  private corrector: Corrector;
  private currentTabId: number | null = null;
  private segmentCount = 0;

  constructor() {
    this.corrector = new Corrector();
  }

  /**
   * 处理音频数据
   */
  async onAudioData(audioData: ArrayBuffer, settings: AppSettings): Promise<void> {
    if (!this.xfyunRecognition) {
      this.xfyunRecognition = new XFYunRecognition(settings.xfyun);
      this.aliyunTranslation = new AliyunTranslation(settings.aliyun);

      // 设置识别回调
      this.xfyunRecognition.onResult((result) => {
        this.handleRecognitionResult(result, settings);
      });
    }

    // 发送音频数据到讯飞
    try {
      await this.xfyunRecognition.sendAudio(audioData);
    } catch (err) {
      console.error('[MessageHandler] 发送音频数据失败:', err);
    }
  }

  /**
   * 处理识别结果
   */
  private async handleRecognitionResult(
    result: { text: string; isEnd: boolean; segmentId: number },
    settings: AppSettings
  ): Promise<void> {
    const { text, isEnd, segmentId } = result;

    if (!text.trim()) return;

    // 检查是否为修正
    const correction = this.corrector.checkCorrection(text, segmentId);

    if (correction) {
      // 发送修正后的字幕到content script
      this.sendSubtitleToContent({
        id: correction.id,
        original: text,
        translated: correction.translated || '',
        isEnd,
        timestamp: Date.now(),
      });
      return;
    }

    // 如果是最终结果，进行翻译
    if (isEnd && this.aliyunTranslation) {
      try {
        const translated = await this.aliyunTranslation.translate(text, settings);
        this.segmentCount++;

        const entry: SubtitleEntry = {
          id: generateId(),
          original: text,
          translated,
          isEnd: true,
          timestamp: Date.now(),
        };

        this.corrector.addToHistory(entry);
        this.sendSubtitleToContent(entry);
      } catch (err) {
        console.error('[MessageHandler] 翻译失败:', err);
      }
    } else if (!isEnd) {
      // 中间结果，先显示原文
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
    // 获取当前活动标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRANSLATION_RESULT',
          payload: entry,
        }).catch(() => {
          // content script可能未加载
        });
      }
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