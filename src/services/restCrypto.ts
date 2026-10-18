import { b64, concat, hex, requireSubtle, sha256, unb64, utf8, utf8Decode } from './cryptoPrimitives';
import { loadCryptoConfig } from './cryptoSession';

/**
 * REST 响应加密（im-rest-v1）：每请求临时密钥 ECIES。
 * 请求携带临时公钥/随机数/上下文，服务端用静态私钥 + 临时密钥派生响应密钥。
 * 协议见 docs/消息体加密设计.md §16。
 */

const VERSION = 1;
const HEADER_EPH = 'X-Crypto-Eph';
const HEADER_NONCE = 'X-Crypto-Nonce';
const HEADER_KEY_ID = 'X-Crypto-Key-Id';
const HEADER_CTX = 'X-Crypto-Ctx';

export interface RestCryptoSession {
  keyId: string;
  cNonce: Uint8Array;
  clientPrivate: CryptoKey;
  clientPub: Uint8Array;
  ctxHex: string;
  serverSpkiB64: string;
}

export interface RestCryptoRequest {
  headers: Record<string, string>;
  session: RestCryptoSession;
}

export interface EncryptedPayload {
  v: number;
  keyId: string;
  sNonce: string;
  pub: string;
  iv: string;
  ct: string;
}

/** 服务端校验的上下文：method + path（不含 query，避免两端编码差异） */
export function resolveRequestPath(baseURL: string | undefined, url: string): string {
  const raw = /^https?:\/\//i.test(url) ? url : `${baseURL || ''}${url}`;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw.split('?')[0].split('#')[0];
  }
}

/** 生成一次请求的临时密钥与加密头；未启用加密时返回 null */
export async function createRestCryptoRequest(
  method: string,
  url: string,
  baseURL?: string,
): Promise<RestCryptoRequest | null> {
  const config = loadCryptoConfig();
  if (!config.enabled) return null;

  const keyId = config.keyId;
  const serverSpkiB64 = config.keys[keyId] || config.serverSpkiB64;
  if (!serverSpkiB64) {
    throw new Error('CRYPTO_KEY_MISSING');
  }

  const subtleApi = requireSubtle();
  const ephemeral = (await subtleApi.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const clientPub = new Uint8Array(await subtleApi.exportKey('spki', ephemeral.publicKey));
  const cNonce = globalThis.crypto.getRandomValues(new Uint8Array(4));
  const path = resolveRequestPath(baseURL, url);
  const ctxHex = hex(await sha256(utf8(`${method.toUpperCase()} ${path}`)));

  return {
    headers: {
      [HEADER_EPH]: b64(clientPub),
      [HEADER_NONCE]: b64(cNonce),
      [HEADER_KEY_ID]: keyId,
      [HEADER_CTX]: ctxHex,
    },
    session: {
      keyId,
      cNonce,
      clientPrivate: ephemeral.privateKey,
      clientPub,
      ctxHex,
      serverSpkiB64,
    },
  };
}

/** 解密响应 enc 信封并返回原始 data；任何校验失败都抛错，不回退明文 */
export async function decryptRestPayload(
  payload: EncryptedPayload,
  session: RestCryptoSession,
): Promise<unknown> {
  if (payload.v !== VERSION) {
    throw new Error('CRYPTO_RESPONSE_VERSION');
  }
  if (payload.keyId !== session.keyId) {
    throw new Error('CRYPTO_RESPONSE_KEY_ID');
  }

  const sNonce = unb64(payload.sNonce);
  const iv = unb64(payload.iv);
  if (sNonce.length !== 4 || iv.length !== 12) {
    throw new Error('CRYPTO_RESPONSE_FORMAT');
  }

  const subtleApi = requireSubtle();
  const serverStatic = await subtleApi.importKey(
    'spki', unb64(session.serverSpkiB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const serverEphemeral = await subtleApi.importKey(
    'spki', unb64(payload.pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  const dhEs = new Uint8Array(await subtleApi.deriveBits(
    { name: 'ECDH', public: serverStatic }, session.clientPrivate, 256));
  const dhEe = new Uint8Array(await subtleApi.deriveBits(
    { name: 'ECDH', public: serverEphemeral }, session.clientPrivate, 256));
  const ikm = concat(dhEs, dhEe);

  const transcript = await sha256(utf8(
    `im-rest-v1|v=${VERSION}|keyId=${session.keyId}|ctx=${session.ctxHex}`
    + `|cnonce=${b64(session.cNonce)}|snonce=${payload.sNonce}`
    + `|cpub=${b64(session.clientPub)}|spub=${payload.pub}`));

  const hkdfKey = await subtleApi.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  const responseKey = await subtleApi.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: sNonce,
      info: utf8(`im-rest-v1|${session.keyId}|s2c|${hex(transcript)}`),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const plaintext = new Uint8Array(await subtleApi.decrypt(
    { name: 'AES-GCM', iv, additionalData: transcript },
    responseKey,
    unb64(payload.ct),
  ));
  return JSON.parse(utf8Decode(plaintext));
}
