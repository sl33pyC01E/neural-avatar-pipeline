package ai.cleo.ardyavatarvalidation;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.IBinder;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
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
import java.util.ArrayList;
import org.json.JSONObject;
import ai.cleo.ardymobile.ResidentService;

/** Offline Cleopatra renderer and local engines; keeps the established app's package/data intact. */
public final class MainActivity extends Activity implements ResidentService.Listener {
    private WebView view;
    private volatile ResidentService engines;
    private boolean resumed,bound;
    private final ServiceConnection connection=new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name,IBinder binder) {
            engines=((ResidentService.LocalBinder)binder).service();engines.attach(MainActivity.this);engines.visible(resumed);engines.state();
        }
        @Override public void onServiceDisconnected(ComponentName name){engines=null;}
    };
    private static final String HOST = "appassets.androidplatform.net";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        view = new WebView(this);
        view.setBackgroundColor(0xff101416);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.getSettings().setMediaPlaybackRequiresUserGesture(true);
        view.addJavascriptInterface(new Bridge(),"Cleo");
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
        Intent runtime=new Intent(this,ResidentService.class);startForegroundService(runtime);
        bound=bindService(runtime,connection,BIND_AUTO_CREATE);
        view.loadUrl("https://" + HOST + "/assets/index.html");
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    @Override public void event(JSONObject event) {
        if("stopped".equals(event.optString("type"))){finish();return;}
        if(view!=null)view.evaluateJavascript("window.cleoEvent?.("+event.toString()+")",null);
    }
    public final class Bridge {
        @JavascriptInterface public void state(){if(engines!=null)engines.state();}
        @JavascriptInterface public void start(String profile,String embedding){if(engines!=null)engines.configureMotion(profile,embedding);}
        @JavascriptInterface public boolean next(){return engines!=null&&engines.nextMotion();}
        @JavascriptInterface public void stop(){if(engines!=null)engines.stopMotion();}
        @JavascriptInterface public void pause(){if(engines!=null)engines.pauseMotion();}
        @JavascriptInterface public void embed(String text){if(engines!=null)engines.createEmbedding(text);}
        @JavascriptInterface public void speak(String text){if(engines!=null)engines.speak(text);}
        @JavascriptInterface public void quiet(){if(engines!=null)engines.stopSpeech();}
        @JavascriptInterface public double playbackSeconds(){return engines==null?-1:engines.playbackSeconds();}
        @JavascriptInterface public void memoryBudget(int mib){if(engines!=null)engines.memoryBudget(mib);}
        @JavascriptInterface public void importModels(){runOnUiThread(()->{
            Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
            startActivityForResult(choose,71);
        });}
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request!=71||result!=RESULT_OK||data==null||engines==null)return;
        ArrayList<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null)uris.add(data.getData());
        engines.importModels(uris.toArray(new Uri[0]));
    }
    @Override protected void onPause() { resumed=false;if(engines!=null)engines.visible(false);view.evaluateJavascript("window.cleoVisible?.(false)",null);view.onPause();super.onPause(); }
    @Override protected void onResume() { super.onResume();resumed=true;if(engines!=null)engines.visible(true);if(view!=null){view.onResume();view.evaluateJavascript("window.cleoVisible?.(true)",null);} }
    @Override protected void onDestroy() { if(engines!=null)engines.detach(this);if(bound)unbindService(connection);view.removeJavascriptInterface("Cleo");view.destroy();view=null;super.onDestroy(); }
}
