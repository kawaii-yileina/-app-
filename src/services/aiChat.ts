/**
 * AI 聊天服务层（业务逻辑）
 *
 * 职责：流式对话管理、消息格式化、多模态处理。
 * 与 UI 完全解耦，可独立测试。
 */

import * as hermes from '../api/hermes';
import type { MessageContent } from '../api/hermes';

// ─── 消息格式化 ───

export function formatTextMessage(text: string): string {
  return text;
}

export function formatImageMessage(base64: string, mimeType: string): MessageContent {
  return [
    { type: 'text', text: '请分析这张图片' },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
  ];
}

export function formatFileMessage(fileName: string, content: string): string {
  return `[文件: ${fileName}]\n\n${content}`;
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── 流式对话管理 ───

export interface StreamCallbacks {
  onDelta?: (text: string) => void;
  onToolStarted?: (toolName: string, args?: string) => void;
  onToolCompleted?: (toolName: string, preview: string) => void;
  onCompleted?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
}

/**
 * 处理 Hermes 原生 SSE 事件流：
 *   assistant.delta     → 增量文本
 *   tool.started        → 工具调用开始
 *   tool.completed      → 工具调用完成
 *   assistant.completed → 完整回复
 *   error               → 错误
 */
export function startStreamChat(
  sessionId: string,
  message: MessageContent,
  callbacks: StreamCallbacks
): AbortController {
  let fullText = '';

  return hermes.chatStream(sessionId, message, {
    onEvent: (event) => {
      switch (event.event) {
        case 'assistant.delta': {
          const delta = String((event.data as Record<string, unknown>).delta || '');
          fullText += delta;
          callbacks.onDelta?.(delta);
          break;
        }
        case 'tool.started': {
          const data = event.data as Record<string, unknown>;
          callbacks.onToolStarted?.(String(data.tool_name || ''), data.args ? String(data.args) : undefined);
          break;
        }
        case 'tool.completed': {
          const data = event.data as Record<string, unknown>;
          callbacks.onToolCompleted?.(String(data.tool_name || ''), String(data.preview || ''));
          break;
        }
        case 'assistant.completed': {
          const content = String((event.data as Record<string, unknown>).content || '');
          if (content) fullText = content;
          callbacks.onCompleted?.(fullText);
          break;
        }
        case 'error': {
          const data = event.data as Record<string, unknown>;
          const msg = String(data.message || data.error || 'AI 处理出错');
          callbacks.onError?.(new Error(msg));
          break;
        }
      }
    },
    onDone: () => {
      callbacks.onCompleted?.(fullText);
      callbacks.onDone?.();
    },
    onError: callbacks.onError,
  });
}

// ─── 同步对话（降级方案） ───

export async function syncChat(sessionId: string, message: MessageContent): Promise<string> {
  const response = await hermes.chat(sessionId, message);
  if (response.code === 200 && response.data) {
    return response.data;
  }
  throw new Error(response.message || '请求失败');
}

// ─── 会话管理 ───

export async function loadSessions(): Promise<string[]> {
  return hermes.getSessions();
}

export async function loadSessionHistory(sessionId: string) {
  return hermes.getSessionHistory(sessionId);
}

export async function removeSession(sessionId: string): Promise<void> {
  return hermes.deleteSession(sessionId);
}
