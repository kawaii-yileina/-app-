import type { ChatMessage } from '../types';

type MessageHandler = (message: ChatMessage) => void;
type OpenHandler = () => void;

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
    return `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
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
  private networkBound = false;

  connect(token: string) {
    this.manualClose = false;
    this.lastToken = token;
    this.ensureNetworkListeners();
    const base = import.meta.env.VITE_WS_URL || 'ws://localhost:9100';
    const deviceId = encodeURIComponent(`${getOrCreateDeviceId()}-${getTabId()}`);
    const wsUrl = `${base}?token=${token}&deviceId=${deviceId}&deviceType=web`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      // 连接（含重连）建立后通知订阅方（用于触发增量补拉）
      this.openHandlers.forEach((handler) => {
        try {
          handler();
        } catch (e) {
          console.error('WebSocket open handler error:', e);
        }
      });
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.stopHeartbeat();
      if (!this.manualClose) {
        this.tryReconnect(token);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  setUserId(userId: string) {
    this.userId = userId;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.userId) {
        this.ws.send(JSON.stringify({
          type: 'HEARTBEAT',
          from: this.userId,
          to: '',
          group: false,
          content: '',
        }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
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
    try {
      const message: ChatMessage = JSON.parse(text);
      this.handlers.forEach((handler) => handler(message));
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
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

  /** 发送消息；连接未就绪时返回 false（调用方据此提示失败，避免静默丢包） */
  send(message: ChatMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsService = new WebSocketService();
export default wsService;
