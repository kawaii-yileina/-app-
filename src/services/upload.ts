import { fileApi, MAX_UPLOAD_BYTES } from '../api';

/**
 * 大文件分片上传（断点续传）：超过阈值走分片，分片并发上传 + 单分片重试；
 * 会话与已传分片持久化到 IndexedDB，网络抖动/刷新后按文件签名续传；
 * 小文件仍走单次上传。分片上传完成后返回与单次上传一致的 { url, key }。
 */

/** 分片大小（与后端一致，S3 分片除最后一片外需 >= 5MB） */
const CHUNK_SIZE = 5 * 1024 * 1024;
/** 触发分片上传的文件大小阈值 */
const CHUNK_THRESHOLD = 5 * 1024 * 1024;
const MAX_CONCURRENCY = 3;
const MAX_PART_RETRY = 3;

interface UploadSession {
  uploadId: string;
  partSize: number;
  uploadedParts: number[];
}

const DB_NAME = 'im-upload';
const STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getSession(key: string): Promise<UploadSession | undefined> {
  try {
    const db = await openDb();
    return await reqToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(key) as IDBRequest<UploadSession | undefined>);
  } catch {
    return undefined;
  }
}

async function putSession(key: string, session: UploadSession): Promise<void> {
  try {
    const db = await openDb();
    await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(session, key));
  } catch {
    /* 持久化失败不影响本次上传 */
  }
}

async function deleteSession(key: string): Promise<void> {
  try {
    const db = await openDb();
    await reqToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  } catch {
    /* ignore */
  }
}

/** 文件签名：同一文件（名/大小/修改时间/类型）视为同一上传任务 */
function fileSignature(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}

function partSizeOf(partNumber: number, totalParts: number, fileSize: number, partSize: number): number {
  return partNumber === totalParts ? fileSize - (partNumber - 1) * partSize : partSize;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(workers);
}

async function uploadPartWithRetry(
  uploadId: string,
  partNumber: number,
  blob: Blob,
  onPartProgress: (loaded: number) => void
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PART_RETRY; attempt++) {
    try {
      const res = await fileApi.multipartPart(uploadId, partNumber, blob, (loaded) => onPartProgress(loaded));
      if (res.code !== 200) {
        throw new Error(res.message || 'PART_FAILED');
      }
      return;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_PART_RETRY) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('PART_FAILED');
}

/**
 * 上传文件：小文件单次、大文件分片续传。返回 { url, key }。
 * onProgress 为整体进度百分比（0-100）。
 */
export async function uploadResumable(file: File, onProgress?: (percent: number) => void): Promise<{ url: string; key: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }
  if (file.size <= CHUNK_THRESHOLD) {
    return fileApi.upload(file, onProgress);
  }

  const signature = fileSignature(file);
  const totalParts = Math.ceil(file.size / CHUNK_SIZE);

  let session = await getSession(signature);
  let serverParts: number[] = [];
  if (session) {
    // 复用本地会话前先向服务端确认已接收分片（服务端会话可能已过期）
    let sessionValid = true;
    try {
      const status = await fileApi.multipartStatus(session.uploadId);
      if (status && status.code === 200 && Array.isArray(status.data)) {
        serverParts = status.data.map(Number);
      } else {
        sessionValid = false;
      }
    } catch {
      // 网络异常：保留会话，用本地记录的分片续传（重复上传分片幂等）
      serverParts = session.uploadedParts.slice();
    }
    if (!sessionValid) {
      await deleteSession(signature);
      session = undefined;
    }
  }
  if (!session) {
    const res = await fileApi.multipartInit({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      totalParts,
    });
    if (res.code !== 200 || !res.data) {
      throw new Error(res.message || 'UPLOAD_FAILED');
    }
    session = { uploadId: res.data.uploadId, partSize: res.data.partSize, uploadedParts: [] };
    await putSession(signature, session);
    serverParts = [];
  }

  const partSize = session.partSize;
  const done = new Set(serverParts);
  let completedBytes = serverParts.reduce(
    (sum, n) => sum + partSizeOf(n, totalParts, file.size, partSize),
    0
  );
  const loadedByPart = new Map<number, number>();
  const report = () => {
    if (!onProgress) return;
    const inFlight = Array.from(loadedByPart.values()).reduce((a, b) => a + b, 0);
    onProgress(Math.min(99, Math.round(((completedBytes + inFlight) / file.size) * 100)));
  };
  report();

  const pending: number[] = [];
  for (let i = 1; i <= totalParts; i++) {
    if (!done.has(i)) pending.push(i);
  }

  await runPool(pending, MAX_CONCURRENCY, async (partNumber) => {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(file.size, start + partSize);
    const blob = file.slice(start, end);
    await uploadPartWithRetry(session!.uploadId, partNumber, blob, (loaded) => {
      loadedByPart.set(partNumber, loaded);
      report();
    });
    loadedByPart.delete(partNumber);
    completedBytes += end - start;
    session!.uploadedParts.push(partNumber);
    await putSession(signature, session!);
    report();
  });

  const res = await fileApi.multipartComplete(session.uploadId);
  if (res.code !== 200 || !res.data) {
    throw new Error(res.message || 'UPLOAD_FAILED');
  }
  await deleteSession(signature);
  onProgress?.(100);
  return res.data;
}
