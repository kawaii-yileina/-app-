import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Toast } from 'antd-mobile';
import i18n from '../i18n';
import { resolveFileUrl } from './fileUrl';
import { getCachedBlob } from '../services/mediaCache';

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const getFilenameFromUrl = (url: string): string => {
  const parts = url.split('/');
  const last = parts[parts.length - 1] || 'file';
  return last.split('?')[0] || 'file';
};

export const downloadFile = async (url: string, filename?: string): Promise<boolean> => {
  const resolvedUrl = resolveFileUrl(url);
  // 文件名来自消息 headers（发送方可控），净化路径分隔符避免穿越
  const name = (filename || getFilenameFromUrl(resolvedUrl)).replace(/[/\\]/g, '_');
  const t = i18n.t.bind(i18n);

  try {
    // 优先走本地缓存（命中直接取 blob，避免重复下载）
    const blob = await getCachedBlob(url);

    if (Capacitor.isNativePlatform()) {
      // 原生：写入应用外部存储 Download/IM
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: `Download/IM/${name}`,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      Toast.show({ content: t('chat.downloadSaved') });
    } else {
      // Web：用 blob 触发浏览器下载（保留正确文件名）
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      Toast.show({ content: t('chat.downloadStarted') });
    }
    return true;
  } catch (e) {
    console.error('Download failed:', e);
    // 兜底：交给浏览器新窗口下载；被拦截（返回 null）时明确失败，不能静默当作成功
    try {
      const opened = window.open(resolvedUrl, '_blank');
      if (!opened) {
        Toast.show({ content: t('chat.downloadFailed') });
        return false;
      }
      try {
        opened.opener = null;
      } catch {
        /* 跨域窗口无法修改 opener，忽略 */
      }
      return true;
    } catch {
      Toast.show({ content: t('chat.downloadFailed') });
      return false;
    }
  }
};
