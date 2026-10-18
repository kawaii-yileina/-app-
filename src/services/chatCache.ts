import { Capacitor } from '@capacitor/core';
import type { Conversation, Friend, Group, Message } from '../types';
import { useChatStore } from '../store/useChatStore';
import { useContactStore } from '../store/useContactStore';
import { b64, requireSubtle, unb64, utf8, utf8Decode } from './cryptoPrimitives';

const DB_NAME = 'im-chat-cache';
const DB_VERSION = 1;
const STORE = 'records';
const MAX_MESSAGES = 500;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 500;
const KEY_PREFIX = 'im.chat.cache.key.';
const isNative = Capacitor.isNativePlatform();

interface CacheRecord {
  key: string;
  iv: string;
  data: string;
  updatedAt: number;
}

interface CachedData {
  conversations: Conversation[];
  cursors: Record<string, number>;
  messages: Record<string, Message[]>;
  friends: Friend[];
  groups: Group[];
}

let dbPromise: Promise<IDBDatabase> | null = null;
const keyPromises = new Map<string, Promise<CryptoKey>>();
let activeUserId: string | null = null;
let unsubscribe: (() => void) | null = null;
let contactUnsubscribe: (() => void) | null = null;
let hydrateUserId: string | null = null;
let hydratePromise: Promise<void> | null = null;
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function userPrefix(userId: string): string {
  return `u:${userId}:`;
}

function conversationKey(userId: string): string {
  return `${userPrefix(userId)}conversations`;
}

function cursorsKey(userId: string): string {
  return `${userPrefix(userId)}cursors`;
}

function messagesKey(userId: string, key: string): string {
  return `${userPrefix(userId)}messages:${key}`;
}

function friendsKey(userId: string): string {
  return `${userPrefix(userId)}friends`;
}

function groupsKey(userId: string): string {
  return `${userPrefix(userId)}groups`;
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('CHAT_CACHE_DB_BLOCKED'));
      };
    });
  }
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllRecords(): Promise<CacheRecord[]> {
  const db = await openDb();
  return requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
}

async function putRecord(record: CacheRecord): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
}

async function deleteRecord(key: string): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
}

async function getCacheKey(userId: string): Promise<CryptoKey> {
  let pending = keyPromises.get(userId);
  if (pending) return pending;
  pending = (async () => {
    const storageKey = `${KEY_PREFIX}${userId}`;
    let raw = localStorage.getItem(storageKey);
    if (!raw) {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      raw = b64(bytes);
      localStorage.setItem(storageKey, raw);
    }
    return requireSubtle().importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  keyPromises.set(userId, pending);
  return pending;
}

async function seal(userId: string, value: unknown): Promise<Omit<CacheRecord, 'key'>> {
  const key = await getCacheKey(userId);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await requireSubtle().encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8(JSON.stringify(value))
  );
  return {
    iv: b64(iv),
    data: b64(new Uint8Array(encrypted)),
    updatedAt: Date.now(),
  };
}

async function unseal<T>(userId: string, record: CacheRecord): Promise<T | null> {
  try {
    const key = await getCacheKey(userId);
    const decrypted = await requireSubtle().decrypt(
      { name: 'AES-GCM', iv: unb64(record.iv) },
      key,
      unb64(record.data)
    );
    return JSON.parse(utf8Decode(new Uint8Array(decrypted))) as T;
  } catch (e) {
    console.warn('Failed to read chat cache:', e);
    return null;
  }
}

function scheduleWrite(userId: string, key: string, value: unknown): void {
  const timer = writeTimers.get(key);
  if (timer) clearTimeout(timer);
  writeTimers.set(key, setTimeout(() => {
    writeTimers.delete(key);
    if (activeUserId !== userId) return;
    void seal(userId, value)
      .then((sealed) => putRecord({ key, ...sealed }))
      .catch((e) => console.warn('Failed to write chat cache:', e));
  }, WRITE_DEBOUNCE_MS));
}

function trimMessages(messages: Message[]): Message[] {
  return messages
    .filter((message) => message.status !== 'sending' && !message.content?.startsWith('blob:'))
    .slice(-MAX_MESSAGES);
}

function stopPersistence(): void {
  unsubscribe?.();
  unsubscribe = null;
  contactUnsubscribe?.();
  contactUnsubscribe = null;
  for (const timer of writeTimers.values()) clearTimeout(timer);
  writeTimers.clear();
}

function subscribePersistence(userId: string): void {
  unsubscribe = useChatStore.subscribe((state, previous) => {
    if (state.conversations !== previous.conversations) {
      scheduleWrite(userId, conversationKey(userId), state.conversations);
    }
    if (state.syncCursors !== previous.syncCursors) {
      scheduleWrite(userId, cursorsKey(userId), state.syncCursors);
    }
    if (state.messages !== previous.messages) {
      const removed = Object.keys(previous.messages).filter((key) => !state.messages[key]);
      for (const key of removed) {
        clearTimeout(writeTimers.get(messagesKey(userId, key)));
        writeTimers.delete(messagesKey(userId, key));
        void deleteRecord(messagesKey(userId, key));
      }
      for (const key of Object.keys(state.messages)) {
        if (state.messages[key] !== previous.messages[key]) {
          scheduleWrite(userId, messagesKey(userId, key), trimMessages(state.messages[key]));
        }
      }
    }
  });
  contactUnsubscribe = useContactStore.subscribe((state, previous) => {
    if (state.friends !== previous.friends) {
      scheduleWrite(userId, friendsKey(userId), state.friends);
    }
    if (state.groups !== previous.groups) {
      scheduleWrite(userId, groupsKey(userId), state.groups);
    }
  });
}

/** App 启动时先恢复本地会话/消息，再连接服务端补增量 */
export function startChatCache(userId: string): Promise<void> {
  if (!isNative) {
    useChatStore.getState().setHydrated(true);
    return Promise.resolve();
  }
  if (activeUserId === userId && unsubscribe) return Promise.resolve();
  if (hydratePromise && hydrateUserId === userId) return hydratePromise;
  const task = doStartChatCache(userId);
  hydrateUserId = userId;
  hydratePromise = task;
  return task.finally(() => {
    if (hydratePromise === task) {
      hydratePromise = null;
      hydrateUserId = null;
    }
  });
}

async function doStartChatCache(userId: string): Promise<void> {
  stopPersistence();
  activeUserId = userId;
  try {
    const records = await getAllRecords();
    const prefix = userPrefix(userId);
    const cached: CachedData = { conversations: [], cursors: {}, messages: {}, friends: [], groups: [] };
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const record of records) {
      if (record.updatedAt < cutoff) {
        await deleteRecord(record.key);
        continue;
      }
      if (!record.key.startsWith(prefix)) continue;
      const value = await unseal<unknown>(userId, record);
      if (value == null) {
        await deleteRecord(record.key);
        continue;
      }
      if (record.key === conversationKey(userId)) {
        cached.conversations = value as Conversation[];
      } else if (record.key === cursorsKey(userId)) {
        cached.cursors = value as Record<string, number>;
      } else if (record.key === friendsKey(userId)) {
        cached.friends = value as Friend[];
      } else if (record.key === groupsKey(userId)) {
        cached.groups = value as Group[];
      } else if (record.key.startsWith(`${prefix}messages:`)) {
        cached.messages[record.key.slice(`${prefix}messages:`.length)] = value as Message[];
      }
    }

    const state = useChatStore.getState();
    if (cached.conversations.length > 0 && state.conversations.length === 0) {
      state.setConversations(cached.conversations);
    }
    const mergedCursors = { ...state.syncCursors };
    for (const [key, seq] of Object.entries(cached.cursors)) {
      mergedCursors[key] = Math.max(mergedCursors[key] || 0, seq);
    }
    state.setSyncCursors(mergedCursors);
    const contacts = useContactStore.getState();
    if (cached.friends.length > 0 && contacts.friends.length === 0) {
      contacts.setFriends(cached.friends);
    }
    if (cached.groups.length > 0 && contacts.groups.length === 0) {
      contacts.setGroups(cached.groups);
    }
    for (const [key, messages] of Object.entries(cached.messages)) {
      if ((state.messages[key] || []).length === 0 && messages.length > 0) {
        state.setMessages(key, messages);
      }
    }
  } catch (e) {
    console.warn('Failed to hydrate chat cache:', e);
  } finally {
    if (activeUserId === userId) {
      useChatStore.getState().setHydrated(true);
      subscribePersistence(userId);
    }
  }
}

/** 退出登录时停止写入并清理当前账号缓存 */
export async function clearChatCache(userId: string): Promise<void> {
  stopPersistence();
  if (activeUserId === userId) activeUserId = null;
  if (hydrateUserId === userId) {
    hydrateUserId = null;
    hydratePromise = null;
  }
  keyPromises.delete(userId);
  localStorage.removeItem(`${KEY_PREFIX}${userId}`);
  if (!isNative) return;
  try {
    const clearedAt = Date.now();
    const records = await getAllRecords();
    const prefix = userPrefix(userId);
    await Promise.all(records
      .filter((record) => record.key.startsWith(prefix) && record.updatedAt <= clearedAt)
      .map((record) => deleteRecord(record.key)));
  } catch (e) {
    console.warn('Failed to clear chat cache:', e);
  }
}

export function disposeChatCache(): void {
  stopPersistence();
  activeUserId = null;
}
