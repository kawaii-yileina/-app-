import { Toast } from 'antd-mobile';
import i18n from '../i18n';
import { authApi } from '../api';
import type { ChatMessage } from '../types';
import { CryptoSession, loadCryptoConfig, type WireMessage } from './cryptoSession';

type MessageHandler = (message: ChatMessage) => void;
type OpenHandler = () => void;
type CryptoState = 'disabled' | 'handshaking' | 'ready';

/** 本端设备标识：持久化于 localStorage，同一浏览器/安装稳定；作为多端在线与离线补投的设备维度 */
function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem('im_device_id');
    if (!id) {
      const rand =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      id = `web-${rand}`;
      localStorage.setItem('im_device_id', id);
    }
    return id;
  } catch {
    // 隐私模式 / 存储被禁用：退化为内存级（每次会话新设备标识，无害）
    return `web-${Math.random().toString(36).slice(2)}`;
  }
}

/** 标签页维度：避免同一浏览器多标签共用 deviceId 被后端"同设备顶号"来回踢 */
function getTabId(): string {
  try {
    let t = sessionStorage.getItem('im_tab_id');
    if (!t) {
      t = Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('im_tab_id', t);
    }
    return t;
  } catch {
    return 'x';
  }
}

/** 握手前出向上限，超限丢弃（依赖 /sync 补拉） */
const PRE_HANDSHAKE_QUEUE_LIMIT = 100;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manualClose = false;
  private userId: string | null = null;
  private lastToken: string | null = null;
  private connectAttempt = 0;
  private networkBound = false;

  // 应用层加密
  private crypto: CryptoSession | null = null;
  private cryptoState: CryptoState = 'disabled';
  private sendQueue: ChatMessage[] = [];
  /** 出向串行链：保证加密（含计数器自增）与发送按调用顺序执行 */
  private outboundChain: Promise<void> = Promise.resolve();
  /** 入向串行链：保证异步解密后按到达顺序交给业务 */
  private decryptChain: Promise<void> = Promise.resolve();
  /** 握手帧串行链：ACK 派生密钥必须先于 CONFIRM 校验完成 */
  private handshakeChain: Promise<void> = Promise.resolve();
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private cryptoFailShown = false;
  private handshakeFailures = 0;

  private clearHandshakeTimer() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private cryptoFail(key: string) {
    if (!this.cryptoFailShown) {
      this.cryptoFailShown = true;
      Toast.show({ content: i18n.t(key) });
    }
    this.ws?.close();
  }

  connect(token: string) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const existing = this.ws;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      // 已有连接：token 未变则直接复用，避免重复建连；token 变化（续期）才重建
      if (this.lastToken === token) return;
      this.manualClose = true;
      existing.onclose = null;
      existing.onerror = null;
      existing.close();
    }
    this.manualClose = false;
    this.lastToken = token;
    const attempt = ++this.connectAttempt;
    this.ensureNetworkListeners();
    const rawBase = import.meta.env.VITE_WS_URL || 'ws://localhost:9100/ws/api/';
    const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
    const deviceId = encodeURIComponent(`${getOrCreateDeviceId()}-${getTabId()}`);

    const cryptoConfig = loadCryptoConfig();
    if (cryptoConfig.enabled && !cryptoConfig.serverSpkiB64) {
      console.error('crypto enabled but VITE_CRYPTO_SERVER_SPKI missing; refuse to connect');
      if (!this.cryptoFailShown) {
        this.cryptoFailShown = true;
        Toast.show({ content: i18n.t('chat.cryptoHandshakeFailed') });
      }
      return;
    }
    this.cryptoFailShown = false;
    this.crypto = cryptoConfig.enabled ? new CryptoSession(cryptoConfig) : null;
    this.cryptoState = cryptoConfig.enabled ? 'handshaking' : 'disabled';
    this.sendQueue = [];
    this.outboundChain = Promise.resolve();
    this.decryptChain = Promise.resolve();
    this.handshakeChain = Promise.resolve();
    this.clearHandshakeTimer();

    console.log('WebSocket connecting:', base);
    void this.openSocket(token, base, deviceId, attempt);
  }

  /** 先向 REST 换取一次性 ticket，再建立 WS；URL 中不再出现 access token */
  private async openSocket(token: string, base: string, deviceId: string, attempt: number) {
    try {
      const res = await authApi.createWsTicket();
      if (attempt !== this.connectAttempt || this.lastToken !== token) return;
      if (res.code !== 200 || !res.data?.ticket) {
        throw new Error(res.message || 'WS_TICKET_FAILED');
      }
      const wsUrl = `${base}?ticket=${encodeURIComponent(res.data.ticket)}&deviceId=${deviceId}&deviceType=web`;
      const previous = this.ws;
      const socket = new WebSocket(wsUrl);
      if (previous && previous !== socket) {
        previous.onclose = null;
        previous.onerror = null;
        previous.close();
      }
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        if (this.cryptoState === 'handshaking' && this.crypto) {
          this.startHandshake();
          this.handshakeTimer = setTimeout(() => {
            console.error('crypto handshake timeout');
            this.cryptoFail('chat.cryptoHandshakeFailed');
          }, 10000);
        } else {
          this.onReady();
        }
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        this.handleMessage(event.data);
      };

      socket.onclose = (event) => {
        if (this.ws !== socket) return;
        console.log(
          `WebSocket disconnected code=${event.code} reason=${event.reason || '-'} clean=${event.wasClean}`
        );
        this.stopHeartbeat();
        this.clearHandshakeTimer();
        if (this.manualClose) return;
        if (this.cryptoState === 'handshaking') {
          // 握手阶段连续断开（如服务端未开加密/配置错配）：给出提示并停止无意义重连
          this.handshakeFailures++;
          if (this.handshakeFailures >= 3) {
            this.cryptoFailShown = false;
            this.cryptoFail('chat.cryptoHandshakeFailed');
            return;
          }
        }
        this.tryReconnect(token);
      };

      socket.onerror = (error) => {
        if (this.ws !== socket) return;
        console.error('WebSocket error:', error);
      };
    } catch (e) {
      if (attempt !== this.connectAttempt || this.lastToken !== token) return;
      console.error('Failed to obtain WS ticket:', e);
      this.tryReconnect(token);
    }
  }

  private async startHandshake() {
    try {
      const hello = await this.crypto!.start();
      this.rawSend({ type: 'CRYPTO_HELLO', content: hello });
    } catch (e) {
      console.error('crypto handshake start failed:', e);
      this.cryptoFail((e as Error)?.message === 'CRYPTO_UNAVAILABLE'
        ? 'chat.cryptoUnavailable'
        : 'chat.cryptoHandshakeFailed');
    }
  }

  /** 连接可收发业务（握手完成或未启用加密） */
  private onReady() {
    this.clearHandshakeTimer();
    this.handshakeFailures = 0;
    this.startHeartbeat();
    this.openHandlers.forEach((handler) => {
      try {
        handler();
      } catch (e) {
        console.error('WebSocket open handler error:', e);
      }
    });
    const queued = this.sendQueue;
    this.sendQueue = [];
    queued.forEach((m) => this.enqueueOutbound(m));
  }

  setUserId(userId: string) {
    this.userId = userId;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.userId) {
        this.send({
          type: 'HEARTBEAT',
          from: this.userId,
          to: '',
          group: false,
          content: '',
        });
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rawSend(message: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: unknown) {
    if (data instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => this.parseMessage(String(reader.result || ''));
      reader.onerror = () => console.error('Failed to read WebSocket message');
      reader.readAsText(data);
    } else if (typeof data === 'string') {
      this.parseMessage(data);
    } else {
      console.error('Unexpected WebSocket message type:', typeof data);
    }
  }

  private parseMessage(text: string) {
    let message: ChatMessage & { content: string; headers?: Record<string, string>; timestamp?: number };
    try {
      message = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
      return;
    }

    if (this.cryptoState === 'handshaking') {
      // 串行化：ACK 必须先完成密钥派生，CONFIRM 才能校验（两帧可能同一批次到达）
      const session = this.crypto;
      const ws = this.ws;
      if (message.type === 'CRYPTO_HELLO_ACK') {
        this.handshakeChain = this.handshakeChain.then(() => {
          if (session !== this.crypto || ws !== this.ws) return;
          return this.onAck(message.content);
        });
      } else if (message.type === 'CRYPTO_CONFIRM') {
        this.handshakeChain = this.handshakeChain.then(() => {
          if (session !== this.crypto || ws !== this.ws) return;
          return this.onServerConfirm(message.content);
        });
      } else {
        // 握手期收到非握手帧：fail-closed
        console.error('unexpected frame during crypto handshake:', message.type);
        this.cryptoFail('chat.cryptoHandshakeFailed');
      }
      return;
    }

    if (this.cryptoState === 'ready' && this.crypto) {
      // 串行解密，保证按到达顺序交给业务
      const session = this.crypto;
      const ws = this.ws;
      this.decryptChain = this.decryptChain.then(async () => {
        if (session !== this.crypto || ws !== this.ws) return; // 旧连接残留任务
        try {
          const decrypted = await session.decrypt(message as unknown as WireMessage);
          this.dispatch(decrypted);
        } catch (e) {
          console.error('crypto decrypt failed:', e);
          this.cryptoFail('chat.cryptoFailed');
        }
      });
      return;
    }

    this.dispatch(message);
  }

  private async onAck(ackContent: string) {
    try {
      await this.crypto!.onAck(ackContent);
    } catch (e) {
      console.error('crypto ACK handling failed:', e);
      this.cryptoFail((e as Error)?.message === 'CRYPTO_UNAVAILABLE' ? 'chat.cryptoUnavailable' : 'chat.cryptoHandshakeFailed');
    }
  }

  private async onServerConfirm(confirmContent: string) {
    try {
      const ok = await this.crypto!.verifyServerConfirm(confirmContent);
      if (!ok) {
        console.error('server CONFIRM verification failed');
        this.cryptoFail('chat.cryptoHandshakeFailed');
        return;
      }
      const clientConfirm = await this.crypto!.buildClientConfirm();
      this.rawSend({ type: 'CRYPTO_CONFIRM', content: clientConfirm });
      this.crypto!.markReady();
      this.cryptoState = 'ready';
      console.log('crypto handshake established');
      this.onReady();
    } catch (e) {
      console.error('crypto CONFIRM handling failed:', e);
      this.cryptoFail('chat.cryptoHandshakeFailed');
    }
  }

  private dispatch(message: ChatMessage) {
    this.handlers.forEach((handler) => handler(message));
  }

  private ensureNetworkListeners() {
    if (this.networkBound) return;
    this.networkBound = true;
    const retry = () => {
      const state = this.ws?.readyState;
      if (
        !this.manualClose &&
        this.lastToken &&
        state !== WebSocket.OPEN &&
        state !== WebSocket.CONNECTING
      ) {
        // 网络恢复/回到前台：重置退避，立即重连（否则退避耗尽后永久不再连接）
        this.reconnectAttempts = 0;
        this.connect(this.lastToken);
      }
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retry();
    });
  }

  private tryReconnect(token: string) {
    if (this.reconnectTimer) return;
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
        // 优先使用最新的 access token（可能已被静默续期替换）
        let latest = token;
        try {
          latest = localStorage.getItem('token') || token;
        } catch {
          latest = this.lastToken || token;
        }
        this.connect(latest);
      }, Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000));
    }
  }

  /** 出向：串行加密后发送 */
  private enqueueOutbound(message: ChatMessage) {
    const session = this.crypto;
    const ws = this.ws;
    this.outboundChain = this.outboundChain.then(async () => {
      if (session !== this.crypto || ws !== this.ws) return; // 旧连接残留任务
      try {
        const wire = await session!.encrypt(message);
        this.rawSend(wire);
      } catch (e) {
        console.error('crypto encrypt/send failed:', e);
        this.cryptoFail('chat.cryptoFailed');
      }
    });
  }

  /** 发送消息；连接未就绪时返回 false（调用方据此提示失败，避免静默丢包） */
  send(message: ChatMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (this.cryptoState === 'disabled') {
      this.rawSend(message);
      return true;
    }
    if (message.type === 'CRYPTO_HELLO' || message.type === 'CRYPTO_CONFIRM') {
      this.rawSend(message);
      return true;
    }
    if (this.cryptoState !== 'ready') {
      // 握手完成前缓冲，完成后再加密发送
      if (this.sendQueue.length < PRE_HANDSHAKE_QUEUE_LIMIT) {
        this.sendQueue.push(message);
      }
      return true;
    }
    this.enqueueOutbound(message);
    return true;
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** 订阅连接建立（含重连）事件；用于触发增量补拉 */
  onOpen(handler: OpenHandler) {
    this.openHandlers.push(handler);
    return () => {
      this.openHandlers = this.openHandlers.filter((h) => h !== handler);
    };
  }

  disconnect() {
    this.manualClose = true;
    this.stopHeartbeat();
    this.clearHandshakeTimer();
    this.handshakeFailures = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.crypto = null;
    this.cryptoState = 'disabled';
    this.sendQueue = [];
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsService = new WebSocketService();
export default wsService;
