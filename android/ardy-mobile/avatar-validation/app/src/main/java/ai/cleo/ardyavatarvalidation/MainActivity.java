package ai.cleo.ardyavatarvalidation;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.widget.FrameLayout;
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
    private volatile String selectedTab="launch";
    private boolean resumed,bound;
    private ModelChatClient chat;
    private ChatInputs chatInputs;
    private BrowserController browser;
    private String inputKind="image",inputScope="chat",recordScope="chat";
    private boolean recordWanted;
    private Uri cameraOutput;
    private final ServiceConnection connection=new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name,IBinder binder) {
            engines=((ResidentService.LocalBinder)binder).service();engines.attach(MainActivity.this);engines.tab(selectedTab);engines.visible(resumed);engines.state();
        }
        @Override public void onServiceDisconnected(ComponentName name){engines=null;}
    };
    private static final String HOST = "appassets.androidplatform.net";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if(state!=null){inputScope=state.getString("inputScope","main");inputKind=state.getString("inputKind","image");String uri=state.getString("cameraOutput");if(uri!=null)cameraOutput=Uri.parse(uri);}
        view = new WebView(this);
        view.setBackgroundColor(0xff101416);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
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
        FrameLayout host=new FrameLayout(this);host.addView(view,new FrameLayout.LayoutParams(-1,-1));setContentView(host);
        chat=new ModelChatClient(this,value->{if(browser!=null)browser.modelEvent(value);event(value);});
        chatInputs=new ChatInputs(this,this::event);
        browser=new BrowserController(this,host,chat,this::event);
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
    private void residencyState(){
        try{event(new JSONObject().put("type","residency")
            .put("enabled",getSharedPreferences("runtime",MODE_PRIVATE).getBoolean("resident",true))
            .put("notifications",getSystemService(android.app.NotificationManager.class).areNotificationsEnabled())
            .put("batteryExempt",getSystemService(android.os.PowerManager.class).isIgnoringBatteryOptimizations(getPackageName()))
            .put("backgroundRestricted",getSystemService(android.app.ActivityManager.class).isBackgroundRestricted()));}catch(Exception ignored){}
    }
    public final class Bridge {
        @JavascriptInterface public void state(){if(engines!=null)engines.state();runOnUiThread(()->residencyState());}
        @JavascriptInterface public void mainFrame(String frame){if(engines!=null)engines.mainFrame(frame);}
        @JavascriptInterface public void residency(boolean enabled){getSharedPreferences("runtime",MODE_PRIVATE).edit().putBoolean("resident",enabled).apply();if(chat!=null)chat.request("{\"action\":\"resident\"}");runOnUiThread(()->residencyState());}
        @JavascriptInterface public void residencyStatus(){runOnUiThread(()->residencyState());}
        @JavascriptInterface public void residentPermissions(String which){runOnUiThread(()->{
            try{
                if("notifications".equals(which)){
                    if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},74);
                    else startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()));
                }else if("battery".equals(which))startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));
                else if("app".equals(which))startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));
            }catch(android.content.ActivityNotFoundException unavailable){startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));}
        });}
        @JavascriptInterface public void tab(String tab){if(!selectedTab.equals(tab)&&chatInputs!=null)runOnUiThread(()->chatInputs.stopRecording());selectedTab=tab;if(engines!=null)engines.tab(tab);if(browser!=null)browser.show("browser".equals(tab)&&resumed);}
        @JavascriptInterface public void chat(String request){if(chat!=null)chat.request(request);}
        @JavascriptInterface public void browserBounds(String bounds){if(browser!=null)browser.bounds(bounds);}
        @JavascriptInterface public void browserCommand(String request){if(browser!=null)browser.command(request);}
        @JavascriptInterface public void chatAttach(String kind){inputAttach(kind,"chat");}
        @JavascriptInterface public void inputAttach(String kind,String scope){if(!java.util.Set.of("chat","browser","cleopatra","main").contains(scope)||(!kind.equals("image")&&!kind.equals("audio")))return;runOnUiThread(()->{
            inputKind=kind;inputScope=scope;Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType(kind.equals("image")?"image/*":"audio/wav").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(choose,72);
        });}
        @JavascriptInterface public void chatRecord(boolean start){inputRecord(start,"chat");}
        @JavascriptInterface public void inputCamera(String scope){if(!java.util.Set.of("chat","browser","cleopatra","main").contains(scope))return;runOnUiThread(()->{
            try{
                java.io.File directory=new java.io.File(getCacheDir(),"camera");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Cannot prepare camera");
                cameraOutput=androidx.core.content.FileProvider.getUriForFile(MainActivity.this,getPackageName()+".camera",new java.io.File(directory,"capture.jpg"));
                inputScope=scope;inputKind="image";
                Intent capture=new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT,cameraOutput)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                capture.setClipData(ClipData.newRawUri("Photo",cameraOutput));startActivityForResult(capture,75);
            }catch(Exception failure){cameraOutput=null;try{event(new JSONObject().put("type","chat").put("inputScope",scope).put("inputError","Camera unavailable. Choose an image instead."));}catch(Exception ignored){}}
        });}
        @JavascriptInterface public void inputRecord(boolean start,String scope){if(!java.util.Set.of("chat","browser","cleopatra","main").contains(scope))return;runOnUiThread(()->{
            recordWanted=start;
            if(!start){chatInputs.stopRecording();return;}
            recordScope=scope;
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},73);
            else chatInputs.startRecording(recordScope);
        });}
        @JavascriptInterface public void start(String profile,String embedding,String stream){if(engines!=null)engines.configureMotion(profile,embedding,stream);}
        @JavascriptInterface public void startPerformance(String profile,String embedding,String stream){if(engines!=null)engines.configurePerformanceMotion(profile,embedding,stream);}
        @JavascriptInterface public boolean next(){return engines!=null&&engines.nextMotion();}
        @JavascriptInterface public void stop(){if(engines!=null)engines.stopMotion();}
        @JavascriptInterface public void pause(){if(engines!=null)engines.pauseMotion();}
        @JavascriptInterface public void embed(String text){if(engines!=null)engines.createEmbedding(text);}
        @JavascriptInterface public void speak(String text,int threads,int steps,int chunkSize,String precision,boolean buffered){if(engines!=null)engines.speak(text,threads,steps,chunkSize,precision,buffered);}
        @JavascriptInterface public void speakWithFace(String text,int threads,int steps,int chunkSize,String precision,boolean buffered,double cueSeconds,double tailSeconds){
            runOnUiThread(()->{if(view!=null)((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(view.getWindowToken(),0);});
            if(engines!=null)engines.speakWithFace(text,threads,steps,chunkSize,precision,buffered,cueSeconds,tailSeconds);
        }
        @JavascriptInterface public void warmAll(String profile,int threads,String precision,String request){if(engines!=null)engines.warmAll(profile,threads,precision,request);}
        @JavascriptInterface public boolean beginSpeech(String id,String text,int threads,int steps,int chunkSize,String precision,boolean buffered,double cueSeconds,double tailSeconds){return engines!=null&&engines.beginSpeech(id,text,threads,steps,chunkSize,precision,buffered,cueSeconds,tailSeconds);}
        @JavascriptInterface public void appendSpeech(String id,String text,boolean finished){if(engines!=null)engines.appendSpeech(id,text,finished);}
        @JavascriptInterface public void prepareModelLoad(String request){if(engines!=null)engines.prepareModelLoad(request);}
        @JavascriptInterface public void cancelWarmAll(){if(engines!=null)engines.cancelWarmAll();}
        @JavascriptInterface public void unloadAvatarModels(){if(engines!=null)engines.unloadAvatarModels();}
        @JavascriptInterface public void quiet(){if(engines!=null)engines.stopSpeech();}
        @JavascriptInterface public void animateLastClip(){if(engines!=null)engines.animateLastClip();}
        @JavascriptInterface public void faceReady(String run){if(engines!=null)engines.faceReady(run);}
        @JavascriptInterface public double playbackSeconds(){return engines==null?-1:engines.playbackSeconds();}
        @JavascriptInterface public void memoryBudget(int mib){if(engines!=null)engines.memoryBudget(mib);}
        @JavascriptInterface public void benchmarkTrace(boolean enabled){if(engines!=null)engines.benchmarkTrace(enabled);}
        @JavascriptInterface public void benchmarkFrame(String metrics){if(engines!=null)engines.benchmarkFrame(metrics);}
        @JavascriptInterface public void importModels(){runOnUiThread(()->{
            Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
            startActivityForResult(choose,71);
        });}
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==75){if(result==RESULT_OK&&cameraOutput!=null)chatInputs.importFile(cameraOutput,"image",inputScope);cameraOutput=null;return;}
        if(request==72){if(result==RESULT_OK&&data!=null&&data.getData()!=null)chatInputs.importFile(data.getData(),inputKind,inputScope);return;}
        if(request!=71||result!=RESULT_OK||data==null||engines==null)return;
        ArrayList<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null)uris.add(data.getData());
        engines.importModels(uris.toArray(new Uri[0]));
    }
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("inputScope",inputScope);state.putString("inputKind",inputKind);if(cameraOutput!=null)state.putString("cameraOutput",cameraOutput.toString());}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);if(request==74){residencyState();return;}if(request!=73)return;
        boolean granted=results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED;
        // A permission dialog ends a hold gesture. Never start a hidden microphone on return.
        if(granted&&recordWanted&&resumed&&!recordScope.equals("main"))chatInputs.startRecording(recordScope);
        else try{recordWanted=false;event(new JSONObject().put("type","chat").put("inputScope",recordScope).put("recording",false).put("inputError",granted?"Microphone ready — hold to talk.":"Microphone permission was declined"));}catch(Exception ignored){}
    }
    @Override protected void onPause() { resumed=false;if(browser!=null)browser.show(false);if(chatInputs!=null)chatInputs.stopRecording();if(chat!=null)chat.request("{\"action\":\"background\"}");if(engines!=null)engines.visible(false);view.evaluateJavascript("window.cleoVisible?.(false)",null);view.onPause();super.onPause(); }
    @Override protected void onResume() { super.onResume();resumed=true;residencyState();if(browser!=null&&"browser".equals(selectedTab))browser.show(true);if(engines!=null)engines.visible(true);if(view!=null){view.onResume();view.evaluateJavascript("window.cleoVisible?.(true)",null);} }
    @Override protected void onDestroy() { if(browser!=null)browser.close();if(chatInputs!=null)chatInputs.close();if(chat!=null)chat.close();if(engines!=null)engines.detach(this);if(bound)unbindService(connection);view.removeJavascriptInterface("Cleo");view.destroy();view=null;super.onDestroy(); }
}
