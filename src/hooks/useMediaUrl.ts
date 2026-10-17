import { useCallback, useEffect, useState } from 'react';
import { resolveFileUrl } from '../utils/fileUrl';
import { getCachedObjectUrl } from '../services/mediaCache';

interface MediaUrlState {
  /** 可用的媒体 URL（本地缓存优先）；undefined 表示尚未就绪 */
  url: string | undefined;
  /** 强制重新解析（用于加载失败重试） */
  reload: () => void;
}

/**
 * 解析媒体地址为可用的（本地缓存优先）URL：
 * 命中本地缓存返回 object URL，否则下载并缓存后再返回；不可用时降级为网络地址。
 */
export function useMediaUrl(rawUrl: string, enabled = true): MediaUrlState {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !rawUrl) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    getCachedObjectUrl(rawUrl)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(resolveFileUrl(rawUrl));
      });
    return () => {
      cancelled = true;
    };
  }, [rawUrl, enabled, nonce]);

  const reload = useCallback(() => {
    // 先清空旧 URL，避免重试期间仍渲染已被淘汰的失效 URL
    setUrl(undefined);
    setNonce((n) => n + 1);
  }, []);

  return { url, reload };
}
