/**
 * 统一聊天会话 hook
 *
 * 抽象普通聊天（WebSocket）和 AI 聊天（流式）的差异，
 * 提供统一的发送、接收、历史加载接口。
 * ChatWindow 只依赖此 hook，不关心底层实现。
 */

import { useCallback } from 'react';
import { useChatStore } from '../store/useChatStore';
import { useAiChatStore } from '../stores/aiChatStore';
import { useAuthStore } from '../store/useAuthStore';
import type { Message } from '../types';

export interface ChatSessionActions {
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  sendImage: (file: File) => Promise<void>;
  sendFile: (file: File) => Promise<void>;
  isStreaming: boolean;
  streamingText: string;
  toolCalls: { name: string; status: string; preview?: string }[];
  stopStreaming: () => void;
  loadHistory: () => Promise<void>;
  addLocalMessage: (msg: Message) => void;
}

export function useChatSession(
  targetId: string,
  chatType: number,
  isAi: boolean,
  sessionId?: string
): ChatSessionActions {
  const user = useAuthStore((s) => s.user);
  const userId = user?.userId || '';

  // 普通聊天 store
  const convKey = isAi ? (sessionId || `ai_${userId}`) : `${targetId}_${chatType}`;
  const regularMessages = useChatStore((s) => s.messages[convKey] || []);
  const addRegularMessage = useChatStore((s) => s.addMessage);

  // AI 聊天 store
  const aiMessages = useAiChatStore((s) => s.messages[sessionId || ''] || []);
  const isStreaming = useAiChatStore((s) => s.isStreaming);
  const streamingText = useAiChatStore((s) => s.streamingText);
  const toolCalls = useAiChatStore((s) => s.toolCalls);
  const aiSendMessage = useAiChatStore((s) => s.sendMessage);
  const aiSendImage = useAiChatStore((s) => s.sendImageMessage);
  const aiSendFile = useAiChatStore((s) => s.sendFileMessage);
  const aiStopStreaming = useAiChatStore((s) => s.stopStreaming);
  const aiLoadMessages = useAiChatStore((s) => s.loadMessages);
  const aiAddLocalMessage = useAiChatStore((s) => s.addLocalMessage);

  // 加载历史
  const loadHistory = useCallback(async () => {
    if (isAi && sessionId) {
      await aiLoadMessages(sessionId);
    }
    // 普通聊天的历史由 ChatWindow 的 useEffect 处理
  }, [isAi, sessionId, aiLoadMessages]);

  // 发送消息
  const sendMessage = useCallback(async (content: string) => {
    if (!user) return;

    if (isAi && sessionId) {
      await aiSendMessage(sessionId, content, userId);
    } else {
      // 普通聊天由 ChatWindow 的 sendTextMessage 处理（WebSocket）
      // 这里不处理，ChatWindow 会直接调用
    }
  }, [isAi, sessionId, user, userId, aiSendMessage]);

  // 发送图片
  const sendImage = useCallback(async (file: File) => {
    if (!user) return;

    if (isAi && sessionId) {
      await aiSendImage(sessionId, file, userId);
    } else {
      // 普通聊天图片由 ChatWindow 处理
    }
  }, [isAi, sessionId, user, userId, aiSendImage]);

  // 发送文件
  const sendFile = useCallback(async (file: File) => {
    if (!user) return;

    if (isAi && sessionId) {
      await aiSendFile(sessionId, file, userId);
    } else {
      // 普通聊天文件由 ChatWindow 处理
    }
  }, [isAi, sessionId, user, userId, aiSendFile]);

  // 停止流式
  const stopStreaming = useCallback(() => {
    aiStopStreaming();
  }, [aiStopStreaming]);

  // 添加本地消息
  const addLocalMessage = useCallback((msg: Message) => {
    if (isAi && sessionId) {
      aiAddLocalMessage(sessionId, msg);
    } else {
      addRegularMessage(convKey, msg);
    }
  }, [isAi, sessionId, convKey, aiAddLocalMessage, addRegularMessage]);

  return {
    messages: isAi ? aiMessages : regularMessages,
    sendMessage,
    sendImage,
    sendFile,
    isStreaming: isAi ? isStreaming : false,
    streamingText: isAi ? streamingText : '',
    toolCalls: isAi ? toolCalls : [],
    stopStreaming,
    loadHistory,
    addLocalMessage,
  };
}
