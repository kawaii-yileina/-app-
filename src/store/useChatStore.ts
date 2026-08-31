import { create } from 'zustand';
import type { Conversation, Message } from '../types';

interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Record<string, Message[]>;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conversation: Conversation | null) => void;
  addMessage: (key: string, message: Message) => void;
  setMessages: (key: string, messages: Message[]) => void;
  updateMessage: (key: string, msgId: string, patch: Partial<Message>) => void;
  updateConversation: (key: string, lastMsg: string, time: string, increaseUnread: boolean) => void;
  clearUnread: (key: string) => void;
  removeConversation: (key: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversation: null,
  messages: {},
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conversation) => set({ activeConversation: conversation }),
  addMessage: (key, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [key]: [...(state.messages[key] || []), message],
      },
    })),
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
          ? { ...c, unreadCount: 0 }
          : c
      ),
    })),
  removeConversation: (key) =>
    set((state) => ({
      conversations: state.conversations.filter(
        (c) => `${c.targetId}_${c.chatType}` !== key
      ),
    })),
}));
