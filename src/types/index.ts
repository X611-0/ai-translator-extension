// ========== 配置类型 ==========

export interface XFYunConfig {
  appId: string;
  apiKey: string;
  apiSecret: string;
}

export interface AliyunConfig {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface AppSettings {
  xfyun: XFYunConfig;
  aliyun: AliyunConfig;
  display: DisplaySettings;
  features: FeatureSettings;
  languages: LanguageSettings;
}

export interface DisplaySettings {
  subtitlePosition: 'top' | 'middle' | 'bottom';
  subtitleFontSize: number;
  subtitleBackgroundOpacity: number;
  subtitleColor: string;
  maxLines: number;
  bilingual: boolean;
}

export interface FeatureSettings {
  outputMode: 'subtitle' | 'speech' | 'both';
  autoCorrect: boolean;
  ttsSpeed: number;
  ttsVolume: number;
  mixAudio: boolean;
}

export interface LanguageSettings {
  sourceLanguage: string;
  targetLanguage: string;
}

// ========== 识别结果 ==========

export interface RecognitionResult {
  text: string;
  isEnd: boolean;
  segmentId: number;
  timestamp: number;
}

// ========== 翻译结果 ==========

export interface TranslationResult {
  original: string;
  translated: string;
  segmentId: number;
  timestamp: number;
}

// ========== 字幕条目 ==========

export interface SubtitleEntry {
  id: string;
  original: string;
  translated: string;
  isEnd: boolean;
  timestamp: number;
}

// ========== 应用状态 ==========

export interface AppState {
  isRunning: boolean;
  status: 'idle' | 'capturing' | 'recognizing' | 'translating' | 'error';
  errorMessage: string | null;
  outputMode: 'subtitle' | 'speech' | 'both';
  currentSubtitle: SubtitleEntry | null;
  subtitleHistory: SubtitleEntry[];
  stats: TranslationStats;
}

export interface TranslationStats {
  totalSegments: number;
  totalCharacters: number;
  averageLatency: number;
}

// ========== 消息类型 ==========

export type MessageType =
  | 'START_TRANSLATION'
  | 'STOP_TRANSLATION'
  | 'RECOGNITION_RESULT'
  | 'TRANSLATION_RESULT'
  | 'STATUS_UPDATE'
  | 'UPDATE_SETTINGS'
  | 'GET_SETTINGS'
  | 'ERROR';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}

// ========== 讯飞API ==========

export interface XFYunResponse {
  code: number;
  message: string;
  sid: string;
  data: {
    result: {
      sn: number;
      ls: boolean;
      bg: number;
      ed: number;
      ws: Array<{
        bg: number;
        cw: Array<{
          w: string;
          sc: number;
        }>;
      }>;
    };
    status: 0 | 1 | 2; // 0=开始, 1=继续, 2=结束
  };
}