import { useEffect, useState } from 'react';
import {
  getCachedObjectUrl,
  peekCachedObjectUrl,
  revalidateMediaUrl,
} from '../services/mediaCache';

/**
 * 头像/图片：优先本地缓存立即展示，联网后后台刷新。
 * 返回的 failed 用于图片加载失败时降级为文字头像。
 */
export function useCachedMediaUrl(src?: string, revalidate = false) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    setFailed(false);
    if (!src) return;

    void (async () => {
      const cached = await peekCachedObjectUrl(src);
      if (cancelled) return;
      if (cached) {
        setUrl(cached);
        if (revalidate) {
          const fresh = await revalidateMediaUrl(src);
          if (!cancelled && fresh) setUrl(fresh);
        }
        return;
      }
      const resolved = await getCachedObjectUrl(src);
      if (!cancelled) setUrl(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [src, revalidate]);

  return {
    url,
    failed,
    onError: () => setFailed(true),
  };
}
