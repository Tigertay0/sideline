package app.sideline.tv;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Keeps Sideline running: the local server for the phone remote, and (once "Display over other apps" is on) a
 * transparent, untouchable, unfocusable full-screen WebView over whatever is playing. The WebView runs the same box
 * as the Chrome extension (tv/overlay.html). Remote input never goes to it: the TV remote keeps driving YouTube TV.
 */
public final class OverlayService extends Service implements RemoteServer.Host {
    static final String ACTION_REFRESH = "app.sideline.tv.REFRESH";
    static final String ACTION_REPAIR = "app.sideline.tv.REPAIR";
    private static final String TAG = "SidelineOverlay";
    private static final String CHANNEL = "sideline";
    private static final long REPLY_TIMEOUT_MS = 2500;

    private final Map<String, CompletableFuture<String>> replies = new ConcurrentHashMap<>();
    private Store store;
    private RemoteServer server;
    private WindowManager windows;
    private Handler main;
    private WebView web;

    @Override
    public void onCreate() {
        super.onCreate();
        store = new Store(this);
        main = new Handler(Looper.getMainLooper());
        windows = getSystemService(WindowManager.class);
        goForeground();
        server = new RemoteServer(this, this);
        server.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_REPAIR.equals(intent.getAction())) main.post(() -> { if (web != null) web.loadUrl(overlayUrl()); });
        main.post(this::showOverlay);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        server.stop();
        if (web != null) {
            windows.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void goForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Sideline", NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("Sideline is on")
                .setContentText("Your fantasy box sits over the game.")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    /** Adds the overlay once the permission is on. Called again whenever the TV screen comes back from Settings. */
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void showOverlay() {
        if (web != null || !Settings.canDrawOverlays(this) || !store.enabled()) return;
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);                         // honour width=1920 so sizes match on every TV
        s.setLoadWithOverviewMode(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setWebViewClient(new LocalOnly());
        web.addJavascriptInterface(new Bridge(), "SidelineAndroid");
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        windows.addView(web, p);
        web.loadUrl(overlayUrl());
    }

    private String overlayUrl() {
        return "http://127.0.0.1:" + RemoteServer.PORT + "/tv/overlay.html?k=" + Uri.encode(store.token());
    }

    /* ---------- RemoteServer.Host ---------- */

    @Override
    public String settings() {
        return store.settings();
    }

    @Override
    public String saveSettings(String patchJson) throws JSONException {
        String merged = store.merge(patchJson);
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__slHost&&__slHost.settingsChanged(" + merged + ")", null);
            else showOverlay();                             // "Sideline on" may have just been switched back on
        });
        return merged;
    }

    @Override
    public String command(String json) {
        if (web == null) {
            return error(Settings.canDrawOverlays(this) ? "The box is off: turn \"Sideline on\" back on."
                    : "The box is not running: on the TV, open Sideline and turn on Display over other apps.");
        }
        String id = UUID.randomUUID().toString();
        CompletableFuture<String> reply = new CompletableFuture<>();
        replies.put(id, reply);
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__slHost&&__slHost.command(" + JSONObject.quote(id) + "," + json + ")", null);
        });
        try {
            return reply.get(REPLY_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            return error("The box did not answer. Is the TV asleep?");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return error("The box did not answer.");
        } catch (ExecutionException e) {
            Log.w(TAG, "command failed", e);
            return error("The box did not answer.");
        } finally {
            replies.remove(id);
        }
    }

    @Override
    public String configured() {
        return store.configured();
    }

    @Override
    public String token() {
        return store.token();
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("ok", false).put("error", message).toString();
        } catch (JSONException e) {
            return "{\"ok\":false}";
        }
    }

    /** The only thing the page can call into: answers to commands from the phone. */
    private final class Bridge {
        @JavascriptInterface
        public void reply(String id, String json) {
            CompletableFuture<String> f = replies.get(id);
            if (f != null) f.complete(json);
        }
    }

    /** The overlay only ever shows our own page: anything else is refused, so the bridge is never reachable from the web. */
    static class LocalOnly extends WebViewClient {                    // not final: the TV screen adds a retry on top
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            boolean local = "http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost()) && u.getPort() == RemoteServer.PORT;
            if (!local) Log.w(TAG, "blocked navigation away from the overlay");
            return !local;
        }
    }
}
