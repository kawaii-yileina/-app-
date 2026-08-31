/**
 * Hermes API 客户端（独立模块）
 *
 * 低耦合设计：所有 Hermes 相关的 API 调用集中在此。
 * 当前后端提供 /api/ai/* 代理接口，本模块封装这些接口。
 * 后续如果后端扩展或切换到直接调用 Hermes，只改这里。
 */

// ─── 类型定义 ───

export interface HermesMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletion {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

export interface ChatResponse {
  code: number;
  message: string;
  data: string | null;
}

export interface Session {
  id: string;
  source?: string;
  model?: string;
  title?: string;
  started_at?: number;
  ended_at?: number;
  end_reason?: string;
  message_count?: number;
  tool_call_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  last_active?: number;
  pinned?: boolean;
  archived?: boolean;
  hidden?: boolean;
  has_system_prompt?: boolean;
  has_model_config?: boolean;
}

export interface SessionMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  timestamp?: number;
  token_count?: number;
  finish_reason?: string;
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface MultimodalContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export type MessageContent = string | MultimodalContent[];

// ─── 后端代理客户端 ───

const AI_API = `${import.meta.env.VITE_API_BASE_URL || '/api'}/ai`;

function getHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ─── 同步对话（通过后端代理）───

export async function chat(sessionId: string, message: MessageContent): Promise<ChatResponse> {
  const response = await fetch(`${AI_API}/chat`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ message: typeof message === 'string' ? message : JSON.stringify(message), sessionId }),
  });
  return response.json();
}

// ─── 流式对话（SSE 事件流）───

/**
 * 解析后端转发的 Hermes SSE 事件流。
 * 每行 data: 后是合并 JSON：{"event":"assistant.delta","data":{...}}
 */
export function chatStream(
  sessionId: string,
  message: MessageContent,
  options: {
    onEvent: (event: SSEEvent) => void;
    onDone?: () => void;
    onError?: (error: Error) => void;
  }
): AbortController {
  const controller = new AbortController();

  fetch(`${AI_API}/chat/stream`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      message: typeof message === 'string' ? message : JSON.stringify(message),
      sessionId,
    }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: '请求失败' }));
        options.onError?.(new Error(err.message || `HTTP ${response.status}`));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        options.onError?.(new Error('无法读取响应'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.substring(5).trimStart();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed && parsed.event) {
              options.onEvent({ event: parsed.event, data: parsed.data || {} });
            }
          } catch {
            // skip invalid JSON line
          }
        }
      }

      options.onDone?.();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        options.onError?.(err);
      }
    });

  return controller;
}

// ─── 会话管理（通过后端代理）───

export async function createSession(
  sessionId: string,
  options?: { title?: string; systemPrompt?: string; model?: string }
): Promise<void> {
  await fetch(`${AI_API}/sessions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ sessionId, ...options }),
  });
}

export async function getSessions(): Promise<string[]> {
  const res = await fetch(`${AI_API}/sessions`, { headers: getHeaders() });
  const data = await res.json();
  return data.data || [];
}

export async function getSessionHistory(sessionId: string): Promise<SessionMessage[]> {
  const res = await fetch(`${AI_API}/sessions/${sessionId}/history`, { headers: getHeaders() });
  const data = await res.json();
  return data.data || [];
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${AI_API}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
}

/** 截断会话消息：保留前 keepCount 条（覆盖语义） */
export async function truncateMessages(sessionId: string, keepCount: number): Promise<void> {
  await fetch(`${AI_API}/sessions/${sessionId}/messages?keep=${keepCount}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
}

export async function editMessage(
  sessionId: string,
  messageId: number,
  content: string
): Promise<void> {
  await fetch(`${AI_API}/sessions/${sessionId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ content }),
  });
}

// ─── 配置 ───

export async function getConfig(): Promise<Record<string, unknown>> {
  const res = await fetch(`${AI_API}/config`, { headers: getHeaders() });
  const data = await res.json();
  return data.data || {};
}

export async function saveConfig(config: Record<string, unknown>): Promise<void> {
  await fetch(`${AI_API}/config`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(config),
  });
}

// ─── 模型管理 ───

export interface HermesModel {
  id: string;
  name: string;
}

export async function getModels(): Promise<HermesModel[]> {
  const res = await fetch(`${AI_API}/models`, { headers: getHeaders() });
  const data = await res.json();
  return data.data || [];
}

export async function lockModel(sessionId: string, model: string, provider?: string): Promise<void> {
  await fetch(`${AI_API}/sessions/${sessionId}/model`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ model, provider }),
  });
}
