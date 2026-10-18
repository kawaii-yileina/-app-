import { Capacitor } from '@capacitor/core';
import { resolveFileUrl } from '../utils/fileUrl';

/**
 * 媒体本地缓存（IndexedDB）：图片 / 语音 / 视频 / 文件。
 * App 端缓存上限 2GB，超过 60 天未访问的记录自动清理；Web 端保持 200MB 且不做时间清理。
 * 按最近访问时间淘汰。
 */

const DB_NAME = 'im-media-cache';
const DB_VERSION = 2;
const BLOBS = 'blobs';
const META = 'meta';
const isNative = Capacitor.isNativePlatform();
const MAX_BYTES = (isNative ? 2 : 0.2) * 1024 * 1024 * 1024;
const MAX_AGE_MS = isNative ? 60 * 24 * 60 * 60 * 1000 : 0;

interface BlobRecord {
  key: string;
  blob: Blob;
}

interface MetaRecord {
  key: string;
  size: number;
  lastAccess: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let cleanupPromise: Promise<void> | null = null;
let cleanupDone = false;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;
        if (!tx) return;
        let blobs: IDBObjectStore;
        if (!db.objectStoreNames.contains(BLOBS)) {
          blobs = db.createObjectStore(BLOBS, { keyPath: 'key' });
        } else {
          blobs = tx.objectStore(BLOBS);
        }
        let meta: IDBObjectStore;
        if (!db.objectStoreNames.contains(META)) {
          meta = db.createObjectStore(META, { keyPath: 'key' });
          meta.createIndex('lastAccess', 'lastAccess');
        } else {
          meta = tx.objectStore(META);
        }
        // v1 只有 blob：升级时为已有记录补元数据，避免全量读取 blob
        if (event.oldVersion < 2) {
          const cursorReq = blobs.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const record = cursor.value as BlobRecord;
            if (record?.key && record.blob) {
              meta.put({ key: record.key, size: record.blob.size, lastAccess: Date.now() });
            } else {
              cursor.delete();
            }
            cursor.continue();
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('MEDIA_CACHE_DB_BLOCKED'));
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

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name);
}

async function getAllMeta(db: IDBDatabase): Promise<MetaRecord[]> {
  return requestToPromise(store(db, META, 'readonly').getAll() as IDBRequest<MetaRecord[]>);
}

async function getMeta(db: IDBDatabase, key: string): Promise<MetaRecord | undefined> {
  return requestToPromise(store(db, META, 'readonly').get(key) as IDBRequest<MetaRecord | undefined>);
}

async function getBlobRecord(db: IDBDatabase, key: string): Promise<BlobRecord | undefined> {
  return requestToPromise(store(db, BLOBS, 'readonly').get(key) as IDBRequest<BlobRecord | undefined>);
}

function revokeObjectUrl(key: string): void {
  const obj = objectUrls.get(key);
  if (obj) {
    URL.revokeObjectURL(obj);
    objectUrls.delete(key);
  }
}

async function deleteRecord(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction([BLOBS, META], 'readwrite');
  tx.objectStore(BLOBS).delete(key);
  tx.objectStore(META).delete(key);
  await transactionDone(tx);
  revokeObjectUrl(key);
}

async function putRecord(db: IDBDatabase, key: string, blob: Blob): Promise<void> {
  const attempt = async () => {
    const tx = db.transaction([BLOBS, META], 'readwrite');
    tx.objectStore(BLOBS).put({ key, blob } satisfies BlobRecord);
    tx.objectStore(META).put({ key, size: blob.size, lastAccess: Date.now() } satisfies MetaRecord);
    await transactionDone(tx);
  };
  try {
    await attempt();
  } catch (e) {
    if (!isQuotaExceeded(e)) throw e;
    // 配额不足：先按 90% 上限淘汰，再重试一次
    await enforceLimit(db, Math.floor(MAX_BYTES * 0.9));
    await attempt();
  }
}

function isQuotaExceeded(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

async function touchRecord(db: IDBDatabase, key: string): Promise<void> {
  const meta = await getMeta(db, key);
  if (!meta) return;
  meta.lastAccess = Date.now();
  const tx = db.transaction(META, 'readwrite');
  tx.objectStore(META).put(meta);
  await transactionDone(tx);
}

async function enforceLimit(db: IDBDatabase, limit = MAX_BYTES): Promise<void> {
  const all = await getAllMeta(db);
  let total = all.reduce((sum, record) => sum + record.size, 0);
  if (total <= limit) return;
  all.sort((a, b) => a.lastAccess - b.lastAccess);
  for (const record of all) {
    if (total <= limit) break;
    await deleteRecord(db, record.key);
    total -= record.size;
  }
}

/** 清理 60 天未访问的记录并执行容量上限；每轮页面只执行一次 */
function ensureCleanup(): Promise<void> {
  if (cleanupDone) return Promise.resolve();
  if (!cleanupPromise) {
    let succeeded = false;
    cleanupPromise = (async () => {
      const db = await openDb();
      const all = await getAllMeta(db);
      const cutoff = Date.now() - MAX_AGE_MS;
      for (const record of all) {
        if (MAX_AGE_MS > 0 && record.lastAccess < cutoff) {
          await deleteRecord(db, record.key);
        }
      }
      await enforceLimit(db);
      succeeded = true;
    })().catch((e) => {
      console.warn('media cache cleanup failed:', e);
    }).finally(() => {
      cleanupPromise = null;
      cleanupDone = succeeded;
    });
  }
  return cleanupPromise;
}

async function fetchBlob(rawUrl: string): Promise<Blob> {
  const res = await fetch(resolveFileUrl(rawUrl), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.blob();
}

async function loadBlobFromCache(rawUrl: string, key: string): Promise<Blob> {
  const db = await openDb();
  await ensureCleanup();
  const record = await getBlobRecord(db, key);
  if (record) {
    void touchRecord(db, key).catch(() => {});
    return record.blob;
  }
  const blob = await fetchBlob(rawUrl);
  try {
    await putRecord(db, key, blob);
    void enforceLimit(db).catch(() => {});
  } catch (e) {
    console.warn('media cache write failed, keep network blob:', e);
  }
  return blob;
}

/** 同一 key 并发只发起一次下载（展示与下载共享） */
function loadBlobSingleFlight(rawUrl: string, key: string): Promise<Blob> {
  let pending = blobInflight.get(key);
  if (!pending) {
    pending = loadBlobFromCache(rawUrl, key).finally(() => {
      blobInflight.delete(key);
    });
    blobInflight.set(key, pending);
  }
  return pending;
}

/**
 * 取媒体 blob 的本地 object URL：命中缓存直接返回；否则下载后缓存再返回。
 * 非本站文件地址（含 data/blob/外链）直接返回解析后的网络地址。
 * 任何异常都降级为网络地址，不影响展示。
 */
export async function getCachedObjectUrl(rawUrl: string): Promise<string> {
  const key = mediaCacheKey(rawUrl);
  if (!key) {
    return resolveFileUrl(rawUrl);
  }
  const existing = objectUrls.get(key);
  if (existing) {
    void touchInDb(key);
    return existing;
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const blob = await loadBlobSingleFlight(rawUrl, key);
        const obj = URL.createObjectURL(blob);
        objectUrls.set(key, obj);
        return obj;
      } catch (e) {
        console.warn('media cache unavailable, fallback to network:', e);
        return resolveFileUrl(rawUrl);
      }
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  }
  return pending;
}

async function touchInDb(key: string): Promise<void> {
  try {
    const db = await openDb();
    await touchRecord(db, key);
  } catch {
    /* 忽略：续期失败不影响展示 */
  }
}

/** 只读取已缓存媒体，不发起网络请求（供视频封面等离线场景使用） */
export async function peekCachedObjectUrl(rawUrl: string): Promise<string | null> {
  const key = mediaCacheKey(rawUrl);
  if (!key) return null;
  const existing = objectUrls.get(key);
  if (existing) {
    void touchInDb(key);
    return existing;
  }
  try {
    const db = await openDb();
    const record = await getBlobRecord(db, key);
    if (!record) return null;
    const obj = URL.createObjectURL(record.blob);
    objectUrls.set(key, obj);
    void touchRecord(db, key).catch(() => {});
    return obj;
  } catch {
    return null;
  }
}

const revalidatedKeys = new Set<string>();

/** 联网后后台刷新头像等媒体；每个 key 每轮会话只刷新一次 */
export async function revalidateMediaUrl(rawUrl: string): Promise<string | null> {
  const key = mediaCacheKey(rawUrl);
  if (!key || revalidatedKeys.has(key)) return null;
  revalidatedKeys.add(key);
  try {
    const db = await openDb();
    const blob = await fetchBlob(rawUrl);
    try {
      await putRecord(db, key, blob);
      void enforceLimit(db).catch(() => {});
    } catch (e) {
      console.warn('media revalidate write failed:', e);
    }
    const obj = URL.createObjectURL(blob);
    objectUrls.set(key, obj);
    return obj;
  } catch {
    revalidatedKeys.delete(key);
    return null;
  }
}

/** 取媒体 blob（供下载/保存）：命中缓存直接返回，否则下载后缓存 */
export async function getCachedBlob(rawUrl: string): Promise<Blob> {
  const key = mediaCacheKey(rawUrl);
  if (!key) {
    return fetchBlob(rawUrl);
  }
  return loadBlobSingleFlight(rawUrl, key);
}

/**
 * 仅本站文件接口的地址可缓存，返回稳定的缓存 key（去掉域名与 token），否则返回 null。
 * 例：/api/files/local/2026/10/xxx.png -> local/2026/10/xxx.png
 */
export function mediaCacheKey(url: string): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    return null;
  }
  let path = url;
  if (!url.startsWith('/')) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  const marker = '/api/files/';
  const idx = path.indexOf(marker);
  if (idx < 0) {
    return null;
  }
  return path.slice(idx + marker.length).split('?')[0];
}

/** 已创建的 object URL 复用表（同一 key 只创建一个） */
const objectUrls = new Map<string, string>();
/** 进行中的 object URL 解析（single-flight）：同一 key 并发只创建一个 object URL */
const inflight = new Map<string, Promise<string>>();
/** 进行中的 blob 加载（single-flight）：展示与下载共用，避免同一文件重复拉取 */
const blobInflight = new Map<string, Promise<Blob>>();
