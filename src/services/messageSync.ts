import { messageApi } from '../api';
import { useChatStore } from '../store/useChatStore';
import { normalizeServerMessage } from '../utils/messagePreview';

/** 单会话单次补拉最多翻页数（防失控）；每页请求上限与后端一致（≤200） */
const MAX_PAGES = 50;
const PAGE_SIZE = 200;

/** 同一会话进行中的补拉（避免 App 重连与打开会话并发重复请求） */
const inflight = new Map<string, Promise<void>>();

/**
 * 补拉单个会话的增量消息（seq > 本地游标），循环拉取直至 hasMore=false。
 * 消息按 msgId 去重、乐观消息按 clientMsgId 对齐合并进 store，并推进会话同步游标。
 * 用于：断线重连、多端补拉、打开会话时补齐离线期间的消息。
 */
export function syncConversation(targetId: string, chatType: number): Promise<void> {
  if (!targetId || targetId === '0') {
    return Promise.resolve(); // 跳过 AI 会话（不走 t_message）
  }
  const key = `${targetId}_${chatType}`;
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const task = doSync(key, targetId, chatType).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

async function doSync(key: string, targetId: string, chatType: number): Promise<void> {
  let cursor = useChatStore.getState().syncCursors[key] || 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let res;
    try {
      res = await messageApi.syncMessages(targetId, chatType, cursor, PAGE_SIZE);
    } catch (e) {
      console.warn('sync request failed:', targetId, e);
      break;
    }
    if (res.code !== 200 || !res.data) {
      console.warn('sync failed:', targetId, res?.code, res?.message);
      break;
    }
    const { messages, lastSeq, hasMore } = res.data;
    const nextSeq = Number(lastSeq) || 0;
    const normalized = (messages || []).map(normalizeServerMessage);
    if (normalized.length > 0) {
      useChatStore.getState().mergeSyncedMessages(key, normalized, nextSeq);
    } else {
      useChatStore.getState().setSyncCursor(key, nextSeq);
    }
    cursor = nextSeq;
    if (!hasMore) {
      break;
    }
  }
}

/** 批量补拉多个会话（单个失败不阻断其余） */
export async function syncConversations(
  conversations: { targetId: string; chatType: number }[]
): Promise<void> {
  for (const conv of conversations) {
    try {
      await syncConversation(conv.targetId, conv.chatType);
    } catch (e) {
      console.warn('sync conversation failed:', conv.targetId, e);
    }
  }
}
