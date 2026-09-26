package ai.cleo.ardyavatarvalidation;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

/** Offline rendering validation only; the established Ardy app has its own package/data. */
public final class MainActivity extends Activity {
    private WebView view;
    private static final String HOST = "appassets.androidplatform.net";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        view = new WebView(this);
        view.setBackgroundColor(0xff101416);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.getSettings().setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(true);
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.i("CleoAvatar", message.message());
                return true;
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if (!"https".equals(request.getUrl().getScheme()) || !HOST.equals(request.getUrl().getHost())
                        || path == null || !path.startsWith("/assets/") || path.contains("..")) {
                    return missing();
                }
                String name = path.substring("/assets/".length());
                String mime = name.endsWith(".js") || name.endsWith(".mjs") ? "text/javascript"
                        : name.endsWith(".html") ? "text/html" : name.endsWith(".json") ? "application/json"
                        : name.endsWith(".css") ? "text/css" : "application/octet-stream";
                try {
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                            Collections.singletonMap("Cache-Control", "no-store"), getAssets().open(name));
                } catch (IOException error) {
                    Log.e("CleoAvatar", "Missing asset " + name, error);
                    return missing();
                }
            }
        });
        setContentView(view);
        view.loadUrl("https://" + HOST + "/assets/index.html");
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    @Override protected void onPause() { view.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (view != null) view.onResume(); }
    @Override protected void onDestroy() { view.destroy(); super.onDestroy(); }
}
