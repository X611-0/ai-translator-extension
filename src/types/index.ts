// ========== 配置类型 ==========

export interface XFYunConfig {
  appId: string;
  apiKey: string;
  apiSecret: string;
  language?: string; // 识别语言：en_us=英文, zh_cn=中文, ja_jp=日语等
}

export interface AliyunConfig {
  accessKeyId: string;
  accessKeySecret: string;
  ttsAppKey?: string;   // 智能语音交互 NLS 项目的 AppKey（需在 nls.console.aliyun.com 创建项目获取）
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
  isPartial: boolean;       // 是否中间结果
  segmentId: number;
  timestamp: number;
  confidence?: number;       // 置信度 0-1
  language?: string;         // 识别语种
  latency?: number;          // 延迟(ms)
  sn?: number;               // 序号
  pgs?: 'apd' | 'rpl';       // 修正类型：apd=追加, rpl=替换
  rg?: [number, number];     // 替换范围
  isCorrection?: boolean;    // 是否是修正结果
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
  isCorrection?: boolean;  // 是否是修正结果
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
  | 'FORCE_CLEANUP'
  | 'RECOGNITION_RESULT'
  | 'TRANSLATION_RESULT'
  | 'STATUS_UPDATE'
  | 'UPDATE_SETTINGS'
  | 'GET_SETTINGS'
  | 'CONTENT_SCRIPT_READY'
  | 'TEST_ALIYUN_API'
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
      sn: number;           // 句子序号
      ls: boolean;          // 是否是最后一句话
      bg: number;           // 开始时间
      ed: number;           // 结束时间
      pgs?: 'apd' | 'rpl';  // 修正类型：apd=追加, rpl=替换（动态修正信号）
      rg?: [number, number]; // 替换范围 [开始词序号, 结束词序号]
      ws: Array<{
        bg: number;
        cw: Array<{
          w: string;        // 词
          wp?: string;      // 词性
          sc: number;       // 置信度
        }>;
      }>;
    };
    status: 0 | 1 | 2; // 0=开始, 1=继续, 2=结束
  };
}