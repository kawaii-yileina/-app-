import { Capacitor, registerPlugin } from '@capacitor/core';

interface CallAudioPlugin {
  setSpeakerphone(options: { on: boolean }): Promise<void>;
  release(): Promise<void>;
}

const CallAudio = registerPlugin<CallAudioPlugin>('CallAudio');

/** 原生平台切换扬声器（免提）；非原生或失败返回 false */
export const setNativeSpeakerphone = async (on: boolean): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }
  try {
    await CallAudio.setSpeakerphone({ on });
    return true;
  } catch (e) {
    console.error('setNativeSpeakerphone failed:', e);
    return false;
  }
};

/** 通话结束后释放音频路由（恢复默认模式） */
export const releaseNativeAudio = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  try {
    await CallAudio.release();
  } catch (e) {
    console.error('releaseNativeAudio failed:', e);
  }
};
