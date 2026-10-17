import { useEffect } from 'react';
import { useCallStore } from '../store/useCallStore';
import { startRingtone, stopRingtone } from '../services/ringtone';

/**
 * 跟随通话状态播放/停止振铃：来电播放系统铃声并振动、去电播放回铃；
 * 进入接通/结束/空闲等其它阶段立即停止。仅原生平台生效。
 */
export function useCallRingtone() {
  useEffect(() => {
    const unsubscribe = useCallStore.subscribe((state, prev) => {
      if (state.phase === prev.phase) {
        return;
      }
      if (state.phase === 'incoming') {
        void startRingtone('incoming');
      } else if (state.phase === 'outgoing') {
        void startRingtone('outgoing');
      } else {
        void stopRingtone();
      }
    });
    return () => {
      unsubscribe();
      void stopRingtone();
    };
  }, []);
}
