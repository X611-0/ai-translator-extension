/**
 * 音频注入器
 * 用于在content script中检测和注入音频捕获代码
 */

export class AudioInjector {
  private isActive = false;

  /**
   * 检测页面中的音频元素
   */
  detectAudioElements(): HTMLMediaElement[] {
    const elements: HTMLMediaElement[] = [];
    const audioTags = document.querySelectorAll('audio');
    const videoTags = document.querySelectorAll('video');

    audioTags.forEach((el) => {
      if (el instanceof HTMLAudioElement) {
        elements.push(el);
      }
    });

    videoTags.forEach((el) => {
      if (el instanceof HTMLVideoElement) {
        elements.push(el);
      }
    });

    return elements;
  }

  /**
   * 检查页面是否有可捕获的音频
   */
  hasAudio(): boolean {
    const elements = this.detectAudioElements();
    if (elements.length === 0) return false;

    // 检查是否有正在播放的媒体
    return elements.some((el) => !el.paused && !el.muted);
  }

  /**
   * 获取媒体播放状态
   */
  getMediaStatus(): { total: number; playing: number; muted: number } {
    const elements = this.detectAudioElements();
    return {
      total: elements.length,
      playing: elements.filter((el) => !el.paused).length,
      muted: elements.filter((el) => el.muted).length,
    };
  }

  /**
   * 注入音频捕获辅助代码
   * 帮助检测页面中的音频流
   */
  inject(): void {
    if (this.isActive) return;
    this.isActive = true;

    console.log('[AudioInjector] 音频检测已激活');
    console.log('[AudioInjector] 媒体状态:', this.getMediaStatus());
  }

  /**
   * 清理
   */
  cleanup(): void {
    this.isActive = false;
  }
}