# AI 同声传译助手

> 赛题二：AI 同声传译助手 — 浏览器扩展

实时将外语视频/音频流翻译为中文，以**字幕 + 语音**双模式呈现，帮助用户跨越语言障碍，高效获取信息。
讲解视频链接：https://b23.tv/tN9sqlw


---

## 功能演示

| 功能 | 说明 |
|------|------|
| 🎤 实时语音识别 | 捕获浏览器标签页音频，通过讯飞 AST API 流式转写 |
| 🌐 智能翻译 | 阿里云机器翻译，支持英/日/韩/德/法等 12 种语言 |
| 📝 双语字幕 | Shadow DOM 隔离的浮层，支持拖拽、缩放、样式切换、位置调整 |
| 🔧 动态修正 | 自动检测并修正讯飞返回的识别修正信号，平滑更新字幕 |
| 🔊 语音播报 | 阿里云语音合成 (WebSocket + Token)，翻译完成后自动朗读 |
| 🎨 多种样式 | 默认/Netflix/YouTube/玻璃/极简/深蓝 6 种字幕预设 |

---

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                    Chrome 扩展                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │  Popup   │  │ Options  │  │ Content Script │ │
│  │ (控制面板) │  │ (API配置) │  │  (字幕浮层注入)  │ │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘ │
│       │             │               │          │
│  ┌────┴─────────────┴───────────────┴────────┐ │
│  │           Background Service Worker        │ │
│  │  ┌──────────────────────────────────────┐  │ │
│  │  │         MessageHandler               │  │ │
│  │  │  ┌──────────┐  ┌──────────┐         │  │ │
│  │  │  │ 识别协调  │  │ 翻译协调  │  TTS    │  │ │
│  │  │  └────┬─────┘  └────┬─────┘         │  │ │
│  │  └───────┼─────────────┼───────────────┘  │ │
│  └──────────┼─────────────┼──────────────────┘ │
│             │             │                    │
│  ┌──────────┴──┐  ┌──────┴───────┐            │
│  │ Offscreen   │  │  Content     │            │
│  │ Document    │  │  Script      │            │
│  │ (音频捕获)   │  │  (字幕渲染)   │            │
│  └─────────────┘  └──────────────┘            │
└─────────────────────────────────────────────────┘
         │                 │
    ┌────┴────┐      ┌────┴────┐
    │ 讯飞 AST │      │ 阿里云 MT │
    │ (识别)   │      │ (翻译)   │
    └─────────┘      └─────────┘
```

### 数据流

```
浏览器标签页音频
      │
      ▼
Offscreen Document (tabCapture → AudioContext → PCM 16kHz)
      │
      ▼
Background SW ──► MessageHandler ──► XFYun AST WebSocket (实时转写)
      │                                      │
      │                                      ▼
      │                              识别结果 (JSON)
      │                                      │
      │                              ┌─── isEnd? ───┐
      │                              │              │
      │                           中间结果         最终结果
      │                              │              │
      │                              │         Aliyun MT (翻译)
      │                              │              │
      │                              ▼              ▼
      │                         发送原文字幕    发送译文字幕
      │                              │              │
      │                              ▼              ▼
      │                         Content Script (Shadow DOM 浮层)
      │                                      │
      ▼                                      ▼
页面字幕显示                              Aliyun TTS (语音播报)
```

---

## 技术亮点

### 1. 流式实时处理
- **音频分段**: AudioWorklet 每 40ms 输出一段 PCM16 音频，直接发送至讯飞 WebSocket
- **流式转写**: AST API 返回中间结果 (`type=1`) 和最终结果 (`type=0`)，中间结果立即显示，保证低延迟
- **批量翻译优化**: 200ms 窗口内聚合多句文本批量翻译，减少 API 调用次数

### 2. 动态修正能力
- **讯飞原生修正**: 识别 API 返回 `pgs=apd|rpl` 信号，标记追加/替换修正，系统自动定位并更新已有字幕
- **相似度修正检测**: Corrector 模块维护识别历史，通过 Jaccard 相似度检测后续结果是否修正了之前的识别错误
- **无感知更新**: 修正后的字幕平滑替换，不影响用户阅读节奏

### 3. 字幕浮层设计
- **Shadow DOM 隔离**: 字幕样式完全不受页面 CSS 污染
- **网站兼容**: 针对 YouTube、Netflix、Bilibili、Vimeo 等视频站自动调整 z-index 和位置
- **可交互**: 支持拖拽移动、宽度缩放、双语切换、6 种样式预设、键盘快捷键

### 4. 健壮性
- **WebSocket 断线重连**: 讯飞连接异常时自动重试（最多 3 次，递增延迟）
- **翻译降级**: 批量翻译失败时自动降级为逐句翻译；翻译失败时显示原文
- **状态恢复**: Content Script 因页面刷新消失后，background 自动重新注入

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Chrome Extension Manifest V3, React 18, TypeScript |
| 构建 | Vite + @crxjs/vite-plugin |
| 识别 | 讯飞实时语音转写 AST API (WebSocket) |
| 翻译 | 阿里云机器翻译 API (REST, HMAC-SHA1 签名) |
| 语音 | 阿里云智能语音交互 NLS (Token + WebSocket) |
| 音频 | Web Audio API (AudioContext, AudioWorklet) |
| 字幕 | Shadow DOM + 原生 DOM 操作 |

---

## 项目结构

```
src/
├── background/           # Service Worker 后台
│   ├── index.ts          # 主入口，消息路由，翻译启停
│   ├── messageHandler.ts # 核心协调器：识别→翻译→修正→字幕→TTS
│   ├── offscreenManager.ts # 离屏文档生命周期管理
│   ├── offscreen.ts      # 离屏文档：音频捕获与处理
│   └── audioCapture.ts   # tabCapture 音频流获取
├── content/              # Content Script 页面注入
│   ├── index.ts          # 入口，消息监听
│   ├── SubtitleOverlay.tsx # 字幕浮层 (Shadow DOM, 拖拽, 样式)
│   └── audioInjector.ts  # 页面音频元素检测
├── services/             # 外部 API 封装
│   ├── xfyun/
│   │   ├── recognition.ts # 讯飞 AST WebSocket 识别
│   │   └── websocket.ts   # URL 构建与签名
│   └── aliyun/
│       ├── translation.ts # 阿里云机器翻译 (批量+缓存+上下文)
│       └── tts.ts         # 阿里云语音合成 (Token+WebSocket)
├── options/              # 选项页面 (API 密钥配置)
│   └── Options.tsx
├── popup/                # 弹出面板 (控制面板)
│   └── Popup.tsx
├── types/                # TypeScript 类型定义
│   └── index.ts
├── store/                # 状态管理
│   └── useStore.ts
├── utils/                # 工具函数
│   └── storage.ts
└── config.ts             # 默认配置与设置管理
```

---



---

## 本地开发

```bash
# 安装依赖
npm install

# 开发模式 (热更新)
npm run dev

# 生产构建
npm run build

# 加载扩展
# Chrome → chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序 → 选择 dist/ 目录
```

---

## 赛题要求对照

| 赛题要求 | 实现情况 |
|---------|---------|
| 将单向音频流实时翻译成中文 | ✅ 通过 tabCapture + AudioWorklet 实时捕获，讯飞 AST 流式转写，阿里云 MT 翻译 |
| 以字幕形式呈现 | ✅ Shadow DOM 浮层，双语对照，可拖拽缩放，多种样式 |
| 以语音形式呈现 | ✅ 阿里云 NLS 语音合成，自动朗读翻译结果 |
| 具备修正能力 | ✅ 讯飞原生修正信号 + Corrector 相似度检测双重修正 |
| 帮助用户跟上内容节奏 | ✅ 中间结果即时显示，批量翻译优化，修正平滑更新 |

---

## 许可证

MIT License
