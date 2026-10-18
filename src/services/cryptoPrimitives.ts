/**
 * Web Crypto 共享原语：Base64/Hex/UTF-8 编解码、SHA-256、HKDF/AES-GCM 所需的
 * nonce 构造与字节拼接。WS 会话与 REST 响应加密共用，避免协议实现分叉。
 */

/** Web Crypto 只在安全上下文可用（Capacitor https scheme / localhost） */
export const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;

export function requireSubtle(): SubtleCrypto {
  if (!subtle) {
    throw new Error('CRYPTO_UNAVAILABLE');
  }
  return subtle;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const utf8 = (s: string) => textEncoder.encode(s);
export const utf8Decode = (bytes: Uint8Array) => textDecoder.decode(bytes);

export const b64 = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

export const unb64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await requireSubtle().digest('SHA-256', bytes));
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** nonce = 4 字节前缀 || 8 字节大端计数器 */
export function nonceFor(prefix: Uint8Array, seq: number): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(prefix, 0);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(4, BigInt(seq));
  return nonce;
}
