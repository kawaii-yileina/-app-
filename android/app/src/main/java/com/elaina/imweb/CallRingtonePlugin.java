package com.elaina.imweb;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 通话振铃：来电/去电播放用户手机的系统默认铃声，来电时按系统设置决定是否振动。
 * 不使用自带的音频资源，避免版权与电音音质问题；Web 端暂不处理。
 */
@CapacitorPlugin(name = "CallRingtone")
public class CallRingtonePlugin extends Plugin {

    private MediaPlayer player;
    private Vibrator vibrator;

    @PluginMethod
    public void start(PluginCall call) {
        String kind = call.getString("kind", "incoming");
        stopInternal();
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (uri == null) {
            call.reject("no default ringtone");
            return;
        }
        // 响铃不属于通话态：复位音频模式，确保音量键调节的是铃声流而非通话音量
        // （WebView 的 WebRTC 可能在上次通话后残留 MODE_IN_COMMUNICATION）
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setMode(AudioManager.MODE_NORMAL);
        }
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setDataSource(getContext(), uri);
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            mp.setLooping(true);
            mp.prepare();
            mp.start();
            player = mp;
        } catch (Exception e) {
            // 部分初始化失败时释放，避免 MediaPlayer 泄漏
            try {
                mp.release();
            } catch (Exception ignored) {
                // ignore
            }
            call.reject("ringtone play failed: " + e.getMessage());
            return;
        }
        // 仅来电振动；尊重用户系统设置，静音或关闭振动则不振动
        if ("incoming".equals(kind) && canVibrate()) {
            startVibration();
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve();
    }

    @Override
    public void handleOnDestroy() {
        // 页面/桥销毁（如通话中退出 App）时兜底停止，避免后台无限振动
        stopInternal();
        super.handleOnDestroy();
    }

    private void stopInternal() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
                // 未处于播放态直接 stop 会抛异常，忽略
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
        }
    }

    private Vibrator getVibrator() {
        if (vibrator != null) {
            return vibrator;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager =
                    (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager != null ? manager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        }
        return vibrator;
    }

    /** 系统静音、或用户关闭了"来电时振动"时返回 false，避免覆盖用户的手机设置 */
    private boolean canVibrate() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            return false;
        }
        int mode = am.getRingerMode();
        if (mode == AudioManager.RINGER_MODE_SILENT) {
            return false;
        }
        if (mode == AudioManager.RINGER_MODE_VIBRATE) {
            return true;
        }
        // 普通模式：取决于用户的"来电时振动"设置
        try {
            int whenRinging = Settings.System.getInt(
                    getContext().getContentResolver(),
                    Settings.System.VIBRATE_WHEN_RINGING, 1);
            return whenRinging == 1;
        } catch (Exception e) {
            return true;
        }
    }

    private void startVibration() {
        Vibrator v = getVibrator();
        if (v == null || !v.hasVibrator()) {
            return;
        }
        long[] pattern = {0, 800, 800};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            v.vibrate(pattern, 0);
        }
    }
}
