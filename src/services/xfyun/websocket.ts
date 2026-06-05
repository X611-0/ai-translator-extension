/**
 * 讯飞语音识别WebSocket签名工具
 * 基于 HMAC-SHA256 签名算法
 */

import CryptoJS from 'crypto-js';

export interface SignatureResult {
  signature: string;
  authorization: string;
  date: string;
}

/**
 * 生成讯飞API签名
 */
export function generateSignature(
  apiKey: string,
  apiSecret: string
): SignatureResult {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const date = new Date().toUTCString();

  // 签名原文
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

  // HMAC-SHA256 签名
  const signature = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(signatureOrigin, apiSecret)
  );

  // Authorization header
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = CryptoJS.enc.Base64.stringify(
    CryptoJS.enc.Utf8.parse(authorizationOrigin)
  );

  return {
    signature,
    authorization,
    date,
  };
}

/**
 * 构建WebSocket连接URL
 */
export function buildWebSocketUrl(
  appId: string,
  apiKey: string,
  apiSecret: string
): string {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const { authorization, date } = generateSignature(apiKey, apiSecret);

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
