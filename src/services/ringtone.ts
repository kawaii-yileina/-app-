import { Capacitor, registerPlugin } from '@capacitor/core';

export type RingKind = 'incoming' | 'outgoing';

interface CallRingtonePlugin {
  /** 开始播放铃声：incoming=来电铃声（并振动），outgoing=去电回铃 */
  start(options: { kind: RingKind }): Promise<void>;
  /** 停止铃声与振动 */
  stop(): Promise<void>;
}

const CallRingtone = registerPlugin<CallRingtonePlugin>('CallRingtone');

/**
 * 播放振铃：Android 原生使用系统默认铃声（尊重用户手机的系统铃声与静音/振动设置）。
 * 非原生平台（Web）暂不处理。
 */
export const startRingtone = async (kind: RingKind): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  try {
    await CallRingtone.start({ kind });
  } catch (e) {
    console.error('startRingtone failed:', e);
  }
};

export const stopRingtone = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  try {
    await CallRingtone.stop();
  } catch (e) {
    console.error('stopRingtone failed:', e);
  }
};
