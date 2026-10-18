import type { ChatMessage } from '../types';
import { b64, concat, hex, nonceFor, requireSubtle, sha256, unb64, utf8, utf8Decode } from './cryptoPrimitives';

/**
 * 应用层消息加密客户端会话（Web Crypto）：P-256 ECDH + HKDF-SHA256 + AES-256-GCM。
 * 协议见 docs/消息体加密设计.md。仅当 VITE_CRYPTO_ENABLED=true 时启用。
 */

const VERSION = 1;
const DIR_C2S = 'c2s';
const DIR_S2C = 's2c';

export interface CryptoConfig {
  enabled: boolean;
  keyId: string;
  serverSpkiB64: string;
  /** 内置的可信公钥集合（keyId → SPKI），支持双 key 轮换；为空时退回 serverSpkiB64 */
  keys: Record<string, string>;
}

function parseKeyMap(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    Object.entries(parsed).forEach(([id, value]) => {
      if (typeof value === 'string' && value.trim()) {
        out[id] = value.trim();
      }
    });
    return out;
  } catch {
    console.error('VITE_CRYPTO_KEYS 不是合法 JSON，已忽略');
    return {};
  }
}

export function loadCryptoConfig(): CryptoConfig {
  const keys = parseKeyMap(import.meta.env.VITE_CRYPTO_KEYS);
  const keyId = import.meta.env.VITE_CRYPTO_KEY_ID || Object.keys(keys)[0] || 'k1';
  const serverSpkiB64 = keys[keyId] || import.meta.env.VITE_CRYPTO_SERVER_SPKI || '';
  return {
    enabled: String(import.meta.env.VITE_CRYPTO_ENABLED || '') === 'true',
    keyId,
    serverSpkiB64,
    keys,
  };
}

/** 密文信封（线上 ChatMessage JSON 的形态） */
export interface WireMessage {
  id?: string;
  type: string;
  from: string;
  to: string;
  group: boolean;
  timestamp: number;
  content: string;
  headers: Record<string, string>;
}

function aadStr(v: number, keyId: string, dir: string, seq: number, type: string,
                id: string | undefined, from: string, to: string, group: boolean, ts: number): string {
  return `im-msg-v1|v=${v}|keyId=${keyId}|dir=${dir}|seq=${seq}|type=${type ?? ''}|id=${id ?? ''}`
    + `|from=${from ?? ''}|to=${to ?? ''}|group=${group}|ts=${ts}`;
}

export class CryptoSession {
  private readonly config: CryptoConfig;
  private clientEphemeral?: CryptoKeyPair;
  private clientPubSpki?: Uint8Array;
  private cNonce?: Uint8Array;
  private sNonce?: Uint8Array;
  private transcript?: Uint8Array;
  private c2sKey?: CryptoKey;
  private s2cKey?: CryptoKey;
  /** 握手确认后的实际 keyId（轮换期可能与首选 key 不同） */
  private establishedKeyId?: string;
  private sendSeq = 0;
  private recvSeq = 0;
  private ready = false;

  constructor(config: CryptoConfig) {
    this.config = config;
  }

  isReady(): boolean {
    return this.ready;
  }

  markReady(): void {
    this.ready = true;
    // CONFIRM 已占用 seq=0，业务帧从 1 开始（与协议一致）
    this.sendSeq = 1;
    this.recvSeq = 1;
  }

  /** 生成 HELLO（返回 content JSON 字符串） */
  async start(): Promise<string> {
    const subtleApi = requireSubtle();
    if (!this.config.serverSpkiB64) {
      throw new Error('缺少服务端公钥 VITE_CRYPTO_SERVER_SPKI');
    }
    // 私钥不可导出（公钥按规范始终可导出）
    this.clientEphemeral = (await subtleApi.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
    this.clientPubSpki = new Uint8Array(await subtleApi.exportKey('spki', this.clientEphemeral.publicKey));
    this.cNonce = globalThis.crypto.getRandomValues(new Uint8Array(4));
    return JSON.stringify({
      v: VERSION,
      keyId: this.config.keyId,
      cNonce: b64(this.cNonce),
      pub: b64(this.clientPubSpki),
    });
  }

  /** 处理服务端 ACK：校验回显并派生会话密钥 */
  async onAck(ackJson: string): Promise<void> {
    const subtleApi = requireSubtle();
    const ack = JSON.parse(ackJson) as { v: number; keyId: string; cNonce: string; sNonce: string; pub: string };
    if (ack.v !== VERSION) {
      throw new Error('ACK 版本不符');
    }
    if (!this.cNonce || ack.cNonce !== b64(this.cNonce)) {
      throw new Error('ACK cNonce 不符');
    }
    const keyId = ack.keyId;
    const spkiB64 = this.config.keys[keyId]
      || (keyId === this.config.keyId ? this.config.serverSpkiB64 : '');
    if (!spkiB64) {
      throw new Error('ACK keyId 不在内置公钥集合');
    }

    const serverStaticKey = await subtleApi.importKey(
      'spki', unb64(spkiB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const serverEphKey = await subtleApi.importKey(
      'spki', unb64(ack.pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);

    const dhEs = new Uint8Array(await subtleApi.deriveBits(
      { name: 'ECDH', public: serverStaticKey }, this.clientEphemeral!.privateKey, 256));
    const dhEe = new Uint8Array(await subtleApi.deriveBits(
      { name: 'ECDH', public: serverEphKey }, this.clientEphemeral!.privateKey, 256));
    const ikm = concat(dhEs, dhEe);

    this.sNonce = unb64(ack.sNonce);
    const transcriptInput = `im-msg-v1|v=${VERSION}|keyId=${keyId}|cnonce=${ack.cNonce}`
      + `|snonce=${ack.sNonce}|cpub=${b64(this.clientPubSpki!)}|spub=${ack.pub}`;
    this.transcript = await sha256(utf8(transcriptInput));

    const hkdfKey = await subtleApi.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    const derive = (label: string) => subtleApi.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: this.sNonce!, info: utf8(`im-msg-v1|${keyId}|${label}|${hex(this.transcript!)}`) },
      hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    this.c2sKey = await derive(DIR_C2S);
    this.s2cKey = await derive(DIR_S2C);
    this.establishedKeyId = keyId;

    // 会话密钥已派生，释放临时私钥引用
    this.clientEphemeral = undefined;
  }

  /** 校验服务端 CONFIRM（s2c seq=0，AAD=transcript） */
  async verifyServerConfirm(ctB64: string): Promise<boolean> {
    if (!this.s2cKey || !this.sNonce || !this.transcript) return false;
    try {
      const plaintext = await requireSubtle().decrypt(
        { name: 'AES-GCM', iv: nonceFor(this.sNonce, 0), additionalData: this.transcript }, this.s2cKey, unb64(ctB64));
      return plaintext.byteLength === 0;
    } catch {
      return false;
    }
  }

  /** 生成客户端 CONFIRM（c2s seq=0，AAD=transcript） */
  async buildClientConfirm(): Promise<string> {
    if (!this.c2sKey || !this.cNonce || !this.transcript) throw new Error('会话密钥未就绪');
    const ct = await requireSubtle().encrypt(
      { name: 'AES-GCM', iv: nonceFor(this.cNonce, 0), additionalData: this.transcript }, this.c2sKey, new Uint8Array(0));
    return b64(new Uint8Array(ct));
  }

  /** 加密上行消息（c2s） */
  async encrypt(message: ChatMessage & { timestamp?: number }): Promise<WireMessage> {
    if (!this.c2sKey || !this.cNonce) throw new Error('会话密钥未就绪');
    const seq = this.sendSeq;
    const iv = nonceFor(this.cNonce, seq);
    const ts = message.timestamp ?? Date.now();
    const keyId = this.establishedKeyId ?? this.config.keyId;
    const aad = utf8(aadStr(VERSION, keyId, DIR_C2S, seq, message.type,
      message.id, message.from, message.to, message.group, ts));
    const plaintext = utf8(JSON.stringify({ content: message.content, headers: message.headers ?? {} }));
    const ct = new Uint8Array(await requireSubtle().encrypt(
      { name: 'AES-GCM', iv, additionalData: aad }, this.c2sKey, plaintext));
    this.sendSeq++;
    return {
      id: message.id,
      type: message.type,
      from: message.from,
      to: message.to,
      group: message.group,
      timestamp: ts,
      content: b64(ct),
      headers: {
        enc: '1',
        cv: String(VERSION),
        ckid: keyId,
        civ: b64(iv),
        cseq: String(seq),
      },
    };
  }

  /** 解密下行消息（s2c），校验版本/keyId 与 seq 严格递增 */
  async decrypt(wire: WireMessage): Promise<ChatMessage> {
    if (!this.s2cKey) throw new Error('会话密钥未就绪');
    if (!wire.headers || wire.headers.enc !== '1') throw new Error('未加密帧');
    const keyId = this.establishedKeyId ?? this.config.keyId;
    if (Number(wire.headers.cv) !== VERSION || wire.headers.ckid !== keyId) {
      throw new Error('版本或密钥标识不符');
    }
    const seq = Number(wire.headers.cseq);
    if (!Number.isInteger(seq) || seq !== this.recvSeq) throw new Error('cseq 不连续');
    const aad = utf8(aadStr(VERSION, keyId, DIR_S2C, seq, wire.type,
      wire.id, wire.from, wire.to, wire.group, wire.timestamp ?? 0));
    const plaintext = new Uint8Array(await requireSubtle().decrypt(
      { name: 'AES-GCM', iv: unb64(wire.headers.civ), additionalData: aad }, this.s2cKey, unb64(wire.content)));
    this.recvSeq++;
    const decoded = JSON.parse(utf8Decode(plaintext)) as { content: string; headers?: Record<string, string> };
    return {
      id: wire.id,
      type: wire.type,
      from: wire.from,
      to: wire.to,
      group: wire.group,
      timestamp: wire.timestamp,
      content: decoded.content,
      headers: decoded.headers ?? {},
    };
  }
}
