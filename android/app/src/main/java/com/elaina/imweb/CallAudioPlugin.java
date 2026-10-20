package com.elaina.imweb;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 通话音频路由：控制扬声器（免提）开关。
 * Android WebView 无 Web 标准的听筒/扬声器切换 API，故用原生 AudioManager 实现；
 * 通话期间置为 MODE_IN_COMMUNICATION 以获得正确的通话音频路由。
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    @PluginMethod
    public void setSpeakerphone(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        am.setSpeakerphoneOn(on);
        call.resolve();
    }

    /** 通话结束后恢复默认音频模式 */
    @PluginMethod
    public void release(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setSpeakerphoneOn(false);
            am.setMode(AudioManager.MODE_NORMAL);
        }
        call.resolve();
    }
}
