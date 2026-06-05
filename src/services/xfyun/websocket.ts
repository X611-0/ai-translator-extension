/**
 * 讯飞语音识别WebSocket签名工具
 */

import CryptoJS from 'crypto-js';

export function generateXFYunSignature(
  apiKey: string,
  apiSecret: string,
  host: string,
  path: string
): string {
  const date = new Date().toUTCString();
  const httpMethod = 'GET';
  const signatureOrigin = `host: ${host}\ndate: ${date}\n${httpMethod} ${path} HTTP/1.1`;

  // HMAC-SHA256签名
  const signature = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(signatureOrigin, apiSecret)
  );

  // 构建鉴权header
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = CryptoJS.enc.Base64.stringify(
    CryptoJS.enc.Utf8.parse(authorizationOrigin)
  );

  return `host=${encodeURIComponent(host)}&date=${encodeURIComponent(date)}&authorization=${encodeURIComponent(authorization)}`;
}

/**
 * 用于WebSocket连接时的URL参数构建
 */
export function buildWebSocketUrl(
  appId: string,
  apiKey: string,
  apiSecret: string
): string {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const signature = generateXFYunSignature(apiKey, apiSecret, host, path);

  return `wss://${host}${path}?authorization=${signature}&date=${new Date().toUTCString()}&host=${host}`;
}

/**
 * 数组转Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}