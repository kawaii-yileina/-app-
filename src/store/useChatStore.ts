import { create } from 'zustand';
import type { Conversation, Message } from '../types';

interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Record<string, Message[]>;
  /** ACK 超时定时器：clientMsgId → timerId，App.tsx 收到 ACK 时清除 */
  pendingTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** 对方输入中状态：conversationKey → 最后一次收到 TYPING 的时间戳 */
  typing: Record<string, number>;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conversation: Conversation | null) => void;
  addMessage: (key: string, message: Message) => void;
  setMessages: (key: string, messages: Message[]) => void;
  updateMessage: (key: string, msgId: string, patch: Partial<Message>) => void;
  updateConversation: (key: string, lastMsg: string, time: string, increaseUnread: boolean) => void;
  clearUnread: (key: string) => void;
  removeConversation: (key: string) => void;
  /** 注册 ACK 超时定时器，返回 timerId 供 clearPending 使用 */
  registerPending: (clientMsgId: string, timer: ReturnType<typeof setTimeout>) => void;
  /** 清除 ACK 超时定时器（收到 ACK 时调用） */
  clearPending: (clientMsgId: string) => void;
  /** 标记对方正在输入（收到 TYPING 时调用） */
  setTyping: (key: string) => void;
  /** 清除对方输入中状态（发送消息/切换会话时调用） */
  clearTyping: (key: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messages: {},
  pendingTimers: new Map(),
  typing: {},
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conversation) => set({ activeConversation: conversation }),
  addMessage: (key, message) =>
    set((state) => {
      const list = state.messages[key] || [];
      // 服务端为至少一次投递：同一条消息（同 msgId）可能重复到达，按 msgId 去重，避免重复气泡
      if (message.msgId && list.some((m) => m.msgId === message.msgId)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [key]: [...list, message],
        },
      };
    }),
  setMessages: (key, messages) =>
    set((state) => ({
      messages: { ...state.messages, [key]: messages },
    })),
  updateMessage: (key, msgId, patch) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [key]: (state.messages[key] || []).map((m) =>
          m.msgId === msgId ? { ...m, ...patch } : m
        ),
      },
    })),
  updateConversation: (key, lastMsg, time, increaseUnread) =>
    set((state) => {
      const idx = state.conversations.findIndex(
        (c) => `${c.targetId}_${c.chatType}` === key
      );
      if (idx < 0) {
        const [targetId, chatTypeStr] = key.split('_');
        const conv: Conversation = {
          id: '',
          userId: '',
          targetId,
          chatType: Number(chatTypeStr),
          lastMsgContent: lastMsg,
          lastMsgTime: time,
          unreadCount: increaseUnread ? 1 : 0,
        };
        return { conversations: [conv, ...state.conversations] };
      }
      const updated = {
        ...state.conversations[idx],
        lastMsgContent: lastMsg,
        lastMsgTime: time,
        unreadCount: increaseUnread ? state.conversations[idx].unreadCount + 1 : state.conversations[idx].unreadCount,
      };
      const conversations = state.conversations.filter((_, i) => i !== idx);
      conversations.unshift(updated);
      return { conversations };
    }),
  clearUnread: (key) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        `${c.targetId}_${c.chatType}` === key
          ? { ...c, unreadCount: 0, mentioned: 0 }
          : c
      ),
    })),
  removeConversation: (key) =>
    set((state) => ({
      conversations: state.conversations.filter(
        (c) => `${c.targetId}_${c.chatType}` !== key
      ),
    })),
  registerPending: (clientMsgId, timer) => {
    const map = new Map(get().pendingTimers);
    map.set(clientMsgId, timer);
    set({ pendingTimers: map });
  },
  clearPending: (clientMsgId) => {
    const map = new Map(get().pendingTimers);
    const timer = map.get(clientMsgId);
    if (timer) {
      clearTimeout(timer);
      map.delete(clientMsgId);
      set({ pendingTimers: map });
    }
  },
  setTyping: (key) => set((state) => ({ typing: { ...state.typing, [key]: Date.now() } })),
  clearTyping: (key) =>
    set((state) => {
      if (!state.typing[key]) return state;
      const typing = { ...state.typing };
      delete typing[key];
      return { typing };
    }),
}));
