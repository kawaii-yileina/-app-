import { Filesystem, Directory } from '@capacitor/filesystem';
import { Toast } from 'antd-mobile';
import { resolveFileUrl } from './fileUrl';

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
  const name = filename || getFilenameFromUrl(resolvedUrl);

  try {
    const response = await fetch(resolvedUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);

    await Filesystem.writeFile({
      path: `Download/IM/${name}`,
      data: base64,
      directory: Directory.ExternalStorage,
      recursive: true,
    });

    Toast.show({ content: `已保存到 Download/IM` });
    return true;
  } catch (e) {
    console.error('Download failed:', e);
    try {
      window.open(resolvedUrl, '_system');
      return true;
    } catch {
      Toast.show({ content: '下载失败' });
      return false;
    }
  }
};
