import type { ChatMessage } from '../types';

type MessageHandler = (message: ChatMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manualClose = false;
  private userId: string | null = null;

  connect(token: string) {
    this.manualClose = false;
    const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:9100'}?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
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

  private tryReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
        // 优先使用最新的 access token（可能已被静默续期替换）
        this.connect(localStorage.getItem('token') || token);
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
