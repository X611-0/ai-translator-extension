/**
 * 讯飞语音识别WebSocket签名工具
 * 基于 HMAC-SHA256 签名算法（使用 Web Crypto API，兼容 Service Worker）
 */

export interface SignatureResult {
  signature: string;
  authorization: string;
  date: string;
}

/**
 * 使用 Web Crypto API 进行 HMAC-SHA256 签名
 */
async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为 Base64
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * 生成讯飞API签名
 */
export async function generateSignature(
  apiKey: string,
  apiSecret: string
): Promise<SignatureResult> {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const date = new Date().toUTCString();

  // 签名原文
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

  // HMAC-SHA256 签名（使用 Web Crypto API）
  const signature = await hmacSha256(signatureOrigin, apiSecret);

  // Authorization header
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = btoa(authorizationOrigin);

  return {
    signature,
    authorization,
    date,
  };
}

/**
 * 构建WebSocket连接URL
 */
export async function buildWebSocketUrl(
  appId: string,
  apiKey: string,
  apiSecret: string
): Promise<string> {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const { authorization, date } = await generateSignature(apiKey, apiSecret);

  const params = new URLSearchParams({
    host,
    date,
    authorization,
    appid: appId,
  });

  return `wss://${host}${path}?${params.toString()}`;
}

/**
 * ArrayBuffer 转 Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 转 ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
