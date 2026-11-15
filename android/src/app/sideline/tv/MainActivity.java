package app.sideline.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

/** The TV's own screen (tv/home.html): turn on the overlay permission, pair a phone, send a test. */
public final class MainActivity extends Activity {
    private static final int RETRY_MS = 400;
    private static final int MAX_RETRIES = 15;

    private WebView web;
    private int retries;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startForegroundService(new Intent(this, OverlayService.class));
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setUseWideViewPort(true);
        web.getSettings().setLoadWithOverviewMode(true);
        web.getSettings().setAllowFileAccess(false);
        web.addJavascriptInterface(new Home(), "SidelineHome");
        web.setWebViewClient(new OverlayService.LocalOnly() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // The server starts with the service, a moment after this screen: try again until it answers.
                if (request.isForMainFrame() && retries++ < MAX_RETRIES) view.postDelayed(MainActivity.this::load, RETRY_MS);
            }
        });
        setContentView(web);
        web.requestFocus();                                  // so the first D-pad press lands in the page
        web.postDelayed(this::load, RETRY_MS);
    }

    private void load() {
        web.loadUrl("http://127.0.0.1:" + RemoteServer.PORT + "/tv/home.html?k=" + Uri.encode(new Store(this).token()));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from the overlay switch: start the box if it is now allowed, and repaint step 1.
        startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_REFRESH));
        if (web != null) web.evaluateJavascript("window.__home&&__home.refresh()", null);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private final class Home {
        @JavascriptInterface
        public boolean canDrawOverlays() {
            return Settings.canDrawOverlays(MainActivity.this);
        }

        @JavascriptInterface
        public void newCode() {
            runOnUiThread(() -> {
                new Store(MainActivity.this).rotateToken();
                startService(new Intent(MainActivity.this, OverlayService.class).setAction(OverlayService.ACTION_REPAIR));
                load();
            });
        }

        @JavascriptInterface
        public void openOverlaySettings() {
            runOnUiThread(() -> {
                Intent exact = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                try {
                    startActivity(exact);
                } catch (ActivityNotFoundException e) {
                    // Some TVs hide that screen: the app's own settings page is one step away from it.
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                }
            });
        }
    }
}
