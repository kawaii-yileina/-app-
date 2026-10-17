import { contactApi, messageApi } from '../api';
import { useChatStore } from '../store/useChatStore';
import { useContactStore } from '../store/useContactStore';
import { useOnlineStore } from '../store/useOnlineStore';

/**
 * 主动刷新：供页面「下拉刷新」及需要时手动触发调用。
 * 统一走各 store 的 setter 写回，避免各页面重复拉取逻辑（AGENTS §1.1）。
 * 失败时静默返回 false（页面据此提示），不抛出以免打断下拉刷新动画。
 */

export const refreshConversations = async (): Promise<boolean> => {
  try {
    const res = await messageApi.getConversations();
    if (res.code === 200) {
      useChatStore.getState().setConversations(res.data);
      return true;
    }
  } catch (e) {
    console.error('refreshConversations failed:', e);
  }
  return false;
};

export const refreshFriends = async (): Promise<boolean> => {
  try {
    const res = await contactApi.getFriends();
    if (res.code === 200) {
      useContactStore.getState().setFriends(res.data);
      return true;
    }
  } catch (e) {
    console.error('refreshFriends failed:', e);
  }
  return false;
};

export const refreshGroups = async (): Promise<boolean> => {
  try {
    const res = await contactApi.getGroups();
    if (res.code === 200) {
      useContactStore.getState().setGroups(res.data);
      return true;
    }
  } catch (e) {
    console.error('refreshGroups failed:', e);
  }
  return false;
};

export const refreshOnlineFriends = async (): Promise<boolean> => {
  try {
    const res = await messageApi.getOnlineFriends();
    if (res.code === 200 && Array.isArray(res.data)) {
      useOnlineStore.getState().setOnlineUsers(res.data);
      return true;
    }
  } catch (e) {
    console.error('refreshOnlineFriends failed:', e);
  }
  return false;
};

/** 会话 + 好友 + 群 + 在线状态（会话列表头像/昵称/在线点依赖后三者）。
 * 任一接口失败即视为整体失败：宁可在界面提示失败，也不静默展示可能过期的数据。 */
export const refreshAll = async (): Promise<boolean> => {
  const results = await Promise.all([
    refreshConversations(),
    refreshFriends(),
    refreshGroups(),
    refreshOnlineFriends(),
  ]);
  return results.every(Boolean);
};
