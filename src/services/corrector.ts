/**
 * 错误修正模块
 * 维护上下文窗口，检测识别/翻译的修正信号并更新已有字幕
 */

import { SubtitleEntry } from '@/types';

interface CorrectionEntry {
  id: string;
  original: string;
  translated: string;
  segmentId: number;
  timestamp: number;
}

export class Corrector {
  private history: SubtitleEntry[] = [];
  private correctionMap: Map<number, CorrectionEntry> = new Map();
  private maxHistory = 20;
  private similarityThreshold = 0.7; // 相似度阈值，超过此值视为修正

  /**
   * 添加到历史记录
   */
  addToHistory(entry: SubtitleEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * 检查是否为修正结果
   * 讯飞会返回修正后的文本，我们需要检测并更新
   */
  checkCorrection(
    text: string,
    segmentId: number
  ): { id: string; translated: string } | null {
    if (this.history.length === 0) return null;

    // 查找最近的、相似度高的条目
    const recent = this.history.slice(-5);

    for (const entry of recent.reverse()) {
      const similarity = this.calculateSimilarity(text, entry.original);

      if (similarity > this.similarityThreshold && similarity < 1.0) {
        // 发现修正：新文本与旧文本相似但不完全相同
        console.log('[Corrector] 检测到修正:', {
          old: entry.original,
          new: text,
          similarity,
        });

        return {
          id: entry.id,
          translated: entry.translated, // 保留旧翻译，等待新翻译
        };
      }
    }

    return null;
  }

  /**
   * 更新翻译结果
   */
  updateTranslation(entryId: string, newTranslated: string): void {
    const index = this.history.findIndex((e) => e.id === entryId);
    if (index >= 0) {
      this.history[index] = {
        ...this.history[index],
        translated: newTranslated,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 计算两个文本的相似度（简单的Jaccard相似度）
   */
  private calculateSimilarity(text1: string, text2: string): number {
    if (text1 === text2) return 1.0;
    if (!text1 || !text2) return 0;

    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * 清除历史记录
   */
  clear(): void {
    this.history = [];
    this.correctionMap.clear();
  }

  /**
   * 获取上下文（用于翻译优化）
   */
  getContext(limit: number = 5): string[] {
    return this.history.slice(-limit).map((e) => e.original);
  }
}