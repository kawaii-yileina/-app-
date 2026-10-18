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
  /** 各会话增量同步游标：conversationKey → 已拉取的最大 seq */
  syncCursors: Record<string, number>;
  /** 本地缓存是否已恢复 */
  hydrated: boolean;
  /** 首次会话列表请求是否仍在进行 */
  initialLoading: boolean;
  setHydrated: (hydrated: boolean) => void;
  setInitialLoading: (loading: boolean) => void;
  setSyncCursors: (cursors: Record<string, number>) => void;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conversation: Conversation | null) => void;
  addMessage: (key: string, message: Message) => void;
  setMessages: (key: string, messages: Message[]) => void;
  updateMessage: (key: string, msgId: string, patch: Partial<Message>) => void;
  removeMessage: (key: string, msgId: string) => void;
  updateConversation: (key: string, lastMsg: string, time: string, increaseUnread: boolean) => void;
  clearUnread: (key: string) => void;
  removeConversation: (key: string) => void;
  /** 提升（取较大值）会话同步游标 */
  setSyncCursor: (key: string, seq: number) => void;
  /** 合并增量同步消息：按 msgId 去重、有 seq 者按 seq 升序，并提升游标 */
  mergeSyncedMessages: (key: string, messages: Message[], lastSeq: number) => void;
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
  syncCursors: {},
  hydrated: false,
  initialLoading: true,
  setHydrated: (hydrated) => set({ hydrated }),
  setInitialLoading: (initialLoading) => set({ initialLoading }),
  setSyncCursors: (syncCursors) => set({ syncCursors }),
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
  removeMessage: (key, msgId) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [key]: (state.messages[key] || []).filter((m) => m.msgId !== msgId),
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
    set((state) => {
      const messages = { ...state.messages };
      delete messages[key];
      const syncCursors = { ...state.syncCursors };
      delete syncCursors[key];
      const typing = { ...state.typing };
      delete typing[key];
      return {
        conversations: state.conversations.filter(
          (c) => `${c.targetId}_${c.chatType}` !== key
        ),
        messages,
        syncCursors,
        typing,
      };
    }),
  setSyncCursor: (key, seq) =>
    set((state) => {
      const current = state.syncCursors[key] || 0;
      if (seq <= current) return state;
      return { syncCursors: { ...state.syncCursors, [key]: seq } };
    }),
  mergeSyncedMessages: (key, messages, lastSeq) =>
    set((state) => {
      const result: Message[] = (state.messages[key] || []).map((m) => ({ ...m }));
      // msgId -> 列表下标；含乐观消息（其 msgId 暂为 clientMsgId）
      const indexOf = new Map<string, number>();
      result.forEach((m, i) => {
        if (m.msgId) indexOf.set(m.msgId, i);
      });

      for (const incoming of messages) {
        if (!incoming.msgId) continue;
        const existingIdx = indexOf.get(incoming.msgId);
        if (existingIdx != null) {
          // 同一服务端消息（如实时/离线已投递但无 seq）：回填 seq 以修正排序，并纠正状态
          const prev = result[existingIdx];
          result[existingIdx] = {
            ...prev,
            seq: incoming.seq ?? prev.seq,
            status: prev.status === 'sending' ? 'sent' : prev.status,
          };
          continue;
        }
        // 乐观消息对齐：本地乐观消息以 clientMsgId 为 msgId，匹配则替换为服务端副本
        const clientMsgId = incoming.headers?.clientMsgId;
        if (clientMsgId && indexOf.has(clientMsgId)) {
          const cidx = indexOf.get(clientMsgId)!;
          indexOf.delete(clientMsgId);
          result[cidx] = { ...incoming, status: 'sent' };
          indexOf.set(incoming.msgId, cidx);
          continue;
        }
        result.push(incoming);
        indexOf.set(incoming.msgId, result.length - 1);
      }

      // 有 seq 的按 seq 升序；无 seq 的（实时消息，通常是最新）稳定排在末尾
      result.sort(
        (a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER)
      );
      const cursor = Math.max(state.syncCursors[key] || 0, lastSeq);
      return {
        messages: { ...state.messages, [key]: result },
        syncCursors: { ...state.syncCursors, [key]: cursor },
      };
    }),
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
