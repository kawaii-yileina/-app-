import i18n from '../i18n';

const GENERIC_UPLOAD_ERRORS = new Set(['UPLOAD_FAILED', 'PART_FAILED', 'Network Error', 'ERR_NETWORK']);

/**
 * 上传失败文案：优先透出服务端/业务的具体原因（如文件过大、类型不支持），
 * 网络错误、超时与内部错误码统一回落到调用方指定的兜底文案。
 */
export function uploadErrorMessage(err: unknown, fallbackKey: string): string {
  const e = err as { message?: string; response?: { status?: number; data?: { message?: string } } };
  if (e?.response?.status === 413) {
    return i18n.t('chat.fileTooLarge');
  }
  const serverMessage = e?.response?.data?.message;
  if (serverMessage && serverMessage.trim()) {
    return serverMessage;
  }
  const code = e?.message || '';
  if (code === 'FILE_TOO_LARGE') {
    return i18n.t('chat.fileTooLarge');
  }
  if (code && !GENERIC_UPLOAD_ERRORS.has(code) && !/timeout|status code|Failed to fetch|NetworkError/i.test(code)) {
    return code;
  }
  return i18n.t(fallbackKey);
}
