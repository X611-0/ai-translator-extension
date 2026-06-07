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

  // 签名原文（注意：\n 是换行符）
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  console.log('[WebSocket] 签名原文:', signatureOrigin.replace(/\n/g, '\\n'));

  // HMAC-SHA256 签名（使用 Web Crypto API）
  const signature = await hmacSha256(signatureOrigin, apiSecret);
  console.log('[WebSocket] 签名结果:', signature);

  // Authorization header
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = btoa(authorizationOrigin);
  console.log('[WebSocket] authorization:', authorization.substring(0, 100) + '...');

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

  // 正确 URL 编码参数
  const encodedAuth = encodeURIComponent(authorization);
  const encodedDate = encodeURIComponent(date);
  const encodedHost = encodeURIComponent(host);

  const url = `wss://${host}${path}?authorization=${encodedAuth}&date=${encodedDate}&host=${encodedHost}`;
  console.log('[WebSocket] 构建的URL:', url.substring(0, 150) + '...');

  return url;
}

/**
 * ArrayBuffer 或普通数组 转 Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | number[]): string {
  // 如果是普通数组，先转换为 Uint8Array
  const bytes = Array.isArray(buffer) ? new Uint8Array(buffer) : new Uint8Array(buffer);
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
