import { Capacitor, registerPlugin } from '@capacitor/core';

interface AppSettingsPlugin {
  open(): Promise<void>;
}

const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

/** 是否运行在原生 App（Android/iOS）内 */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

/**
 * 打开系统「应用详情 / 权限」设置页（仅原生平台可用）。
 * 返回是否成功打开；Web 端返回 false，调用方应改为文案引导。
 */
export const openAppSettings = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }
  try {
    await AppSettings.open();
    return true;
  } catch (e) {
    console.error('openAppSettings failed:', e);
    return false;
  }
};
