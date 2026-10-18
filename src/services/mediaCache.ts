import { resolveFileUrl } from '../utils/fileUrl';

/**
 * 媒体本地缓存（IndexedDB）：图片 / 语音 / 视频 / 文件下载后缓存到本地，
 * 再次展示直接使用本地 blob（object URL），避免重复请求、降低服务器带宽压力。
 * 仅缓存本站文件接口（/api/files/）地址；带 LRU 上限自动淘汰；不支持时降级直连网络。
 */

const DB_NAME = 'im-media-cache';
const STORE = 'blobs';
/** 本地媒体缓存上限（字节）：超出后按最近使用时间淘汰最旧的 */
const MAX_BYTES = 200 * 1024 * 1024;

interface CacheRecord {
  key: string;
  blob: Blob;
  size: number;
  lastAccess: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('lastAccess', 'lastAccess');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 仅本站文件接口的地址可缓存，返回稳定的缓存 key（去掉域名与 token），否则返回 null。
 * 例：/api/files/local/2026/10/xxx.png → local/2026/10/xxx.png
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

async function fetchBlob(rawUrl: string): Promise<Blob> {
  const res = await fetch(resolveFileUrl(rawUrl));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.blob();
}

async function getRecord(db: IDBDatabase, key: string): Promise<CacheRecord | undefined> {
  return reqToPromise(store(db, 'readonly').get(key) as IDBRequest<CacheRecord | undefined>);
}

async function putRecord(db: IDBDatabase, record: CacheRecord): Promise<void> {
  await reqToPromise(store(db, 'readwrite').put(record));
}

async function deleteRecord(db: IDBDatabase, key: string): Promise<void> {
  await reqToPromise(store(db, 'readwrite').delete(key));
}

async function touchRecord(db: IDBDatabase, key: string): Promise<void> {
  const rec = await getRecord(db, key);
  if (rec) {
    rec.lastAccess = Date.now();
    await putRecord(db, rec);
  }
}

async function getAllRecords(db: IDBDatabase): Promise<CacheRecord[]> {
  return reqToPromise(store(db, 'readonly').getAll() as IDBRequest<CacheRecord[]>);
}

/** 超出上限时按 lastAccess 从旧到新淘汰 */
async function enforceLimit(db: IDBDatabase): Promise<void> {
  const all = await getAllRecords(db);
  let total = all.reduce((sum, r) => sum + r.size, 0);
  if (total <= MAX_BYTES) {
    return;
  }
  all.sort((a, b) => a.lastAccess - b.lastAccess);
  for (const rec of all) {
    if (total <= MAX_BYTES) {
      break;
    }
    await deleteRecord(db, rec.key);
    const obj = objectUrls.get(rec.key);
    if (obj) {
      URL.revokeObjectURL(obj);
      objectUrls.delete(rec.key);
    }
    total -= rec.size;
  }
}

/** 读取缓存中的 blob；未命中时下载并写入缓存。 */
async function loadBlobFromCache(rawUrl: string, key: string): Promise<Blob> {
  const db = await openDb();
  const rec = await getRecord(db, key);
  if (rec) {
    void touchRecord(db, key);
    return rec.blob;
  }
  const blob = await fetchBlob(rawUrl);
  await putRecord(db, { key, blob, size: blob.size, lastAccess: Date.now() });
  void enforceLimit(db);
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
    // 命中内存缓存视为最近使用，续期避免被 LRU 误淘汰（展示中）
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

/** 取媒体 blob（供下载/保存）：命中缓存直接返回，否则下载后缓存 */
export async function getCachedBlob(rawUrl: string): Promise<Blob> {
  const key = mediaCacheKey(rawUrl);
  if (!key) {
    return fetchBlob(rawUrl);
  }
  return loadBlobSingleFlight(rawUrl, key);
}
