import { Capacitor } from '@capacitor/core';

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let startTime = 0;
let currentMimeType = '';

/** 移动端（Capacitor）优先 mp4：时长元数据完整，WebView 播放更稳；Web 端优先 webm */
const PREFERRED_TYPES = Capacitor.isNativePlatform()
  ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

const pickMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

/** 音频编码 → 展示格式（webm/ogg/mp4） */
const formatFromMime = (mime: string): string => {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
};

/**
 * 音频编码 → 文件扩展名。使用纯音频扩展名，确保后端按 audio/* 返回 Content-Type
 * （.webm 会被识别为 video/webm，部分 WebView 的 <audio> 会拒绝播放）。
 */
const extFromMime = (mime: string): string => {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'oga';
  return 'weba';
};

/**
 * 录音是否可用：
 * 需要 MediaRecorder 与 navigator.mediaDevices（http + 局域网 IP 等非安全上下文下不可用）
 */
export const isRecordingSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined'
  && typeof navigator !== 'undefined'
  && !!navigator.mediaDevices
  && typeof navigator.mediaDevices.getUserMedia === 'function';

/** 是否已有录音进行中 */
export const isRecordingActive = (): boolean => mediaRecorder !== null;

export const startRecording = async (): Promise<void> => {
  if (!isRecordingSupported()) {
    throw new Error('Recording not supported in this environment');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  currentMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
  audioChunks = [];
  startTime = Date.now();

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.start();
};

export const stopRecording = (): Promise<{
  blob: Blob;
  duration: number;
  mimeType: string;
  format: string;
  ext: string;
}> => {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No recording in progress'));
      return;
    }

    mediaRecorder.onstop = () => {
      const duration = (Date.now() - startTime) / 1000;
      const mimeType = currentMimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: mimeType });
      audioChunks = [];

      mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
      mediaRecorder = null;

      resolve({ blob, duration, mimeType, format: formatFromMime(mimeType), ext: extFromMime(mimeType) });
    };

    mediaRecorder.stop();
  });
};

export const cancelRecording = (): void => {
  if (mediaRecorder) {
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
    audioChunks = [];
  }
};
