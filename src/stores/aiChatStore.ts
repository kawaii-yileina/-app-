/**
 * AI 聊天状态管理（Zustand store）
 *
 * 管理 AI 会话列表、当前消息、流式状态。
 * 与 UI 解耦，通过 hook 提供 React 集成。
 */

import { create } from 'zustand';
import { useAuthStore } from '../store/useAuthStore';
import type { Message } from '../types';
import * as aiChat from '../services/aiChat';
import * as hermes from '../api/hermes';
import type { MessageContent } from '../api/hermes';

// ─── 类型定义 ───

export interface ToolCallState {
  name: string;
  status: 'running' | 'completed' | 'failed';
  preview?: string;
}

export interface AiChatState {
  // 会话列表
  sessions: string[];
  currentSessionId: string | null;

  // 消息
  messages: Record<string, Message[]>;

  // 流式状态
  isStreaming: boolean;
  streamingText: string;
  toolCalls: ToolCallState[];

  // 操作
  loadSessions: () => Promise<void>;
  setCurrentSession: (sessionId: string | null) => void;
  loadMessages: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, content: MessageContent, userId: string) => Promise<void>;
  sendImageMessage: (sessionId: string, file: File, userId: string) => Promise<void>;
  sendFileMessage: (sessionId: string, file: File, userId: string) => Promise<void>;
  editMessage: (sessionId: string, messageId: string, newContent: string, userId: string) => Promise<void>;
  regenerateMessage: (sessionId: string, messageId: string, userId: string) => Promise<void>;
  resendMessage: (sessionId: string, messageId: string, userId: string) => Promise<void>;
  stopStreaming: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  addLocalMessage: (sessionId: string, message: Message) => void;
}

// ─── Store ───

let currentAbortController: AbortController | null = null;

export const useAiChatStore = create<AiChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: {},
  isStreaming: false,
  streamingText: '',
  toolCalls: [],

  loadSessions: async () => {
    try {
      const sessions = await aiChat.loadSessions();
      set({ sessions });
    } catch (e) {
      console.error('Failed to load AI sessions:', e);
    }
  },

  setCurrentSession: (sessionId) => {
    set({ currentSessionId: sessionId });
  },

  loadMessages: async (sessionId) => {
    try {
      const userId = useAuthStore.getState().user?.userId || '';
      const history = await aiChat.loadSessionHistory(sessionId);
      const messages: Message[] = history.map((msg) => {
        // MySQL 中多模态消息存储为 JSON 数组字符串，先尝试解析
        let raw: unknown = msg.content;
        if (typeof raw === 'string' && raw.trimStart().startsWith('[')) {
          try {
            raw = JSON.parse(raw);
          } catch {
            // 普通文本（如 "[图片]" 开头的文字），保持字符串
          }
        }

        let msgType = 'TEXT';
        let content = msg.content as string;
        let headers: Record<string, string> | undefined;

        if (Array.isArray(raw)) {
          const parts = raw as { type: string; text?: string; image_url?: { url: string } }[];
          const imagePart = parts.find(p => p.type === 'image_url');
          const textPart = parts.find(p => p.type === 'text');

          if (imagePart?.image_url?.url) {
            msgType = 'IMAGE';
            content = imagePart.image_url.url;
            if (textPart?.text) {
              headers = { textContent: textPart.text };
            }
          } else if (textPart?.text) {
            content = textPart.text;
          }
        }

        return {
          id: String(msg.id),
          msgId: String(msg.id),
          senderId: msg.role === 'user' ? userId : '0',
          receiverId: msg.role === 'user' ? '0' : userId,
          chatType: 0,
          msgType,
          content,
          createdAt: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
          headers,
        };
      });
      set((state) => ({
        messages: { ...state.messages, [sessionId]: messages },
      }));
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  },

  sendMessage: async (sessionId, content, userId) => {
    const isMultimodal = Array.isArray(content);
    const textPart = isMultimodal 
      ? (content as {type: string; text?: string}[]).find(c => c.type === 'text')?.text || ''
      : content as string;
    const imagePart = isMultimodal
      ? (content as {type: string; image_url?: {url: string}}[]).find(c => c.type === 'image_url')
      : null;
    
    const userMsg: Message = {
      id: Date.now().toString(),
      msgId: Date.now().toString(),
      senderId: userId,
      receiverId: '0',
      chatType: 0,
      msgType: imagePart ? 'IMAGE' : 'TEXT',
      content: imagePart ? imagePart.image_url?.url || textPart : textPart,
      createdAt: new Date().toISOString(),
      status: 'sent',
      headers: imagePart && textPart ? { textContent: textPart } : undefined,
    };

    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] || []), userMsg],
      },
      isStreaming: true,
      streamingText: '',
      toolCalls: [],
    }));

    let fullText = '';

    currentAbortController = aiChat.startStreamChat(sessionId, content, {
      onDelta: (delta) => {
        fullText += delta;
        set({ streamingText: fullText });
      },
      onToolStarted: (name) => {
        set((state) => ({
          toolCalls: [...state.toolCalls, { name, status: 'running' }],
        }));
      },
      onToolCompleted: (name, preview) => {
        set((state) => ({
          toolCalls: state.toolCalls.map((tc) =>
            tc.name === name ? { ...tc, status: 'completed', preview } : tc
          ),
        }));
      },
      onCompleted: (text) => {
        fullText = text;
      },
      onDone: () => {
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          msgId: (Date.now() + 1).toString(),
          senderId: '0',
          receiverId: userId,
          chatType: 0,
          msgType: 'TEXT',
          content: fullText,
          createdAt: new Date().toISOString(),
          status: 'sent',
        };
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: [...(state.messages[sessionId] || []), aiMsg],
          },
          isStreaming: false,
          streamingText: '',
          toolCalls: [],
        }));
        currentAbortController = null;
      },
      onError: (error) => {
        console.error('AI stream error:', error);
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          msgId: (Date.now() + 1).toString(),
          senderId: '0',
          receiverId: userId,
          chatType: 0,
          msgType: 'TEXT',
          content: `请求失败: ${error.message}`,
          createdAt: new Date().toISOString(),
          status: 'failed',
        };
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: [...(state.messages[sessionId] || []), errorMsg],
          },
          isStreaming: false,
          streamingText: '',
          toolCalls: [],
        }));
        currentAbortController = null;
      },
    });
  },

  sendImageMessage: async (sessionId, file, userId) => {
    try {
      const base64 = await aiChat.fileToBase64(file);
      const userMsg: Message = {
        id: Date.now().toString(),
        msgId: Date.now().toString(),
        senderId: userId,
        receiverId: '0',
        chatType: 0,
        msgType: 'IMAGE',
        content: URL.createObjectURL(file),
        createdAt: new Date().toISOString(),
        status: 'sent',
      };

      set((state) => ({
        messages: {
          ...state.messages,
          [sessionId]: [...(state.messages[sessionId] || []), userMsg],
        },
        isStreaming: true,
        streamingText: '',
        toolCalls: [],
      }));

      const message = aiChat.formatImageMessage(base64, file.type);
      let fullText = '';

      currentAbortController = aiChat.startStreamChat(sessionId, message, {
        onDelta: (delta) => {
          fullText += delta;
          set({ streamingText: fullText });
        },
        onToolStarted: (name) => {
          set((state) => ({
            toolCalls: [...state.toolCalls, { name, status: 'running' }],
          }));
        },
        onToolCompleted: (name, preview) => {
          set((state) => ({
            toolCalls: state.toolCalls.map((tc) =>
              tc.name === name ? { ...tc, status: 'completed', preview } : tc
            ),
          }));
        },
        onCompleted: (text) => {
          fullText = text;
        },
        onDone: () => {
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            msgId: (Date.now() + 1).toString(),
            senderId: '0',
            receiverId: userId,
            chatType: 0,
            msgType: 'TEXT',
            content: fullText,
            createdAt: new Date().toISOString(),
            status: 'sent',
          };
          set((state) => ({
            messages: {
              ...state.messages,
              [sessionId]: [...(state.messages[sessionId] || []), aiMsg],
            },
            isStreaming: false,
            streamingText: '',
            toolCalls: [],
          }));
          currentAbortController = null;
        },
        onError: (error) => {
          console.error('AI stream error:', error);
          set({ isStreaming: false, streamingText: '', toolCalls: [] });
          currentAbortController = null;
        },
      });
    } catch (e) {
      console.error('Failed to send image:', e);
    }
  },

  sendFileMessage: async (sessionId, file, userId) => {
    try {
      let content: string;

      if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|js|ts|py|java|c|cpp|html|css|xml|yaml|yml|csv|log)$/i)) {
        const text = await file.text();
        content = aiChat.formatFileMessage(file.name, text);
      } else {
        content = `[文件: ${file.name}] (${file.type}, ${(file.size / 1024).toFixed(1)}KB)`;
      }

      const userMsg: Message = {
        id: Date.now().toString(),
        msgId: Date.now().toString(),
        senderId: userId,
        receiverId: '0',
        chatType: 0,
        msgType: 'FILE',
        content: file.name,
        createdAt: new Date().toISOString(),
        status: 'sent',
        headers: { originalName: file.name, size: String(file.size) },
      };

      set((state) => ({
        messages: {
          ...state.messages,
          [sessionId]: [...(state.messages[sessionId] || []), userMsg],
        },
        isStreaming: true,
        streamingText: '',
        toolCalls: [],
      }));

      let fullText = '';

      currentAbortController = aiChat.startStreamChat(sessionId, content, {
        onDelta: (delta) => {
          fullText += delta;
          set({ streamingText: fullText });
        },
        onToolStarted: (name) => {
          set((state) => ({
            toolCalls: [...state.toolCalls, { name, status: 'running' }],
          }));
        },
        onToolCompleted: (name, preview) => {
          set((state) => ({
            toolCalls: state.toolCalls.map((tc) =>
              tc.name === name ? { ...tc, status: 'completed', preview } : tc
            ),
          }));
        },
        onCompleted: (text) => {
          fullText = text;
        },
        onDone: () => {
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            msgId: (Date.now() + 1).toString(),
            senderId: '0',
            receiverId: userId,
            chatType: 0,
            msgType: 'TEXT',
            content: fullText,
            createdAt: new Date().toISOString(),
            status: 'sent',
          };
          set((state) => ({
            messages: {
              ...state.messages,
              [sessionId]: [...(state.messages[sessionId] || []), aiMsg],
            },
            isStreaming: false,
            streamingText: '',
            toolCalls: [],
          }));
          currentAbortController = null;
        },
        onError: (error) => {
          console.error('AI stream error:', error);
          set({ isStreaming: false, streamingText: '', toolCalls: [] })
          currentAbortController = null;
        },
      });
    } catch (e) {
      console.error('Failed to send file:', e);
    }
  },

  editMessage: async (sessionId, messageId, newContent, userId) => {
    const sessionMessages = get().messages[sessionId] || [];
    const msg = sessionMessages.find(m => m.msgId === messageId);
    if (!msg) return;

    const isAiMessage = msg.senderId === '0';

    if (isAiMessage) {
      // AI 消息：调用 Hermes API 编辑内容（不改变上下文顺序）
      try {
        await hermes.editMessage(sessionId, Number(messageId), newContent);
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: state.messages[sessionId].map(m =>
              m.msgId === messageId ? { ...m, content: newContent } : m
            ),
          },
        }));
      } catch (e) {
        console.error('Failed to edit AI message:', e);
        throw e;
      }
    } else {
      // 用户消息：覆盖语义——截断该消息及之后的所有内容（本地 + MySQL），重新发送
      const msgIndex = sessionMessages.findIndex(m => m.msgId === messageId);
      try {
        await hermes.truncateMessages(sessionId, msgIndex);
      } catch (e) {
        console.error('Failed to truncate messages:', e);
      }
      set((state) => ({
        messages: {
          ...state.messages,
          [sessionId]: sessionMessages.slice(0, msgIndex),
        },
      }));
      await get().sendMessage(sessionId, newContent, userId);
    }
  },

  regenerateMessage: async (sessionId, messageId, userId) => {
    const sessionMessages = get().messages[sessionId] || [];
    const aiMsgIndex = sessionMessages.findIndex(m => m.msgId === messageId);
    if (aiMsgIndex < 0) return;

    // 找到 AI 消息之前的用户消息
    let userMessage: Message | null = null;
    for (let i = aiMsgIndex - 1; i >= 0; i--) {
      if (sessionMessages[i].senderId !== '0') {
        userMessage = sessionMessages[i];
        break;
      }
    }
    if (!userMessage) return;

    // 覆盖语义：截断 AI 消息及其后的所有内容（本地 + MySQL），重新发送
    try {
      await hermes.truncateMessages(sessionId, aiMsgIndex);
    } catch (e) {
      console.error('Failed to truncate messages:', e);
    }
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: sessionMessages.slice(0, aiMsgIndex),
      },
    }));

    await get().sendMessage(sessionId, userMessage.content, userId);
  },

  /**
   * 重新发送用户消息（覆盖语义）：
   * 删除该消息及其后的所有内容（本地 + MySQL），再原样重发给 Hermes。
   * 图片消息还原为多模态格式（含附带文本），文本消息原样。
   */
  resendMessage: async (sessionId, messageId, userId) => {
    const sessionMessages = get().messages[sessionId] || [];
    const idx = sessionMessages.findIndex(m => m.msgId === messageId);
    if (idx < 0) return;
    const msg = sessionMessages[idx];

    try {
      await hermes.truncateMessages(sessionId, idx);
    } catch (e) {
      console.error('Failed to truncate messages:', e);
    }
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: sessionMessages.slice(0, idx),
      },
    }));

    if (msg.msgType === 'IMAGE') {
      const textPart = msg.headers?.textContent || '';
      await get().sendMessage(sessionId, [
        { type: 'text', text: textPart || '请分析这张图片' },
        { type: 'image_url', image_url: { url: msg.content } },
      ], userId);
    } else {
      await get().sendMessage(sessionId, msg.content, userId);
    }
  },

  stopStreaming: () => {
    currentAbortController?.abort();
    currentAbortController = null;
    set({ isStreaming: false, streamingText: '', toolCalls: [] });
  },

  deleteSession: async (sessionId) => {
    try {
      await aiChat.removeSession(sessionId);
      set((state) => ({
        sessions: state.sessions.filter((s) => s !== sessionId),
        messages: (() => {
          const { [sessionId]: _, ...rest } = state.messages;
          return rest;
        })(),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      }));
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  },

  addLocalMessage: (sessionId, message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] || []), message],
      },
    }));
  },
}));
