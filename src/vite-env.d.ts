/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XFYUN_APP_ID: string
  readonly VITE_XFYUN_API_KEY: string
  readonly VITE_XFYUN_API_SECRET: string
  readonly VITE_ALIYUN_ACCESS_KEY_ID: string
  readonly VITE_ALIYUN_ACCESS_KEY_SECRET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}