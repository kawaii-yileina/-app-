package com.elaina.imweb;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件需在 super.onCreate 之前注册
        registerPlugin(AppSettingsPlugin.class);
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(CallRingtonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
