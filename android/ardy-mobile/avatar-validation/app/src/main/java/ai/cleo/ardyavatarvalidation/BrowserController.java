package ai.cleo.ardyavatarvalidation;

import android.app.Activity;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Separate untrusted WebView: no application JavaScript bridge is exposed here. */
final class BrowserController {
    private final Activity activity;private final FrameLayout host;private final ModelChatClient models;private final Consumer<JSONObject> events;
    private final Handler main=new Handler(Looper.getMainLooper());
    private WebView web;private BoxOverlay overlay;private boolean visible,running,waiting,inflight,capturing,loading,injecting;
    private String goal="",requestId="";private final ArrayList<String> audioFiles=new ArrayList<>();private final ArrayDeque<String> journal=new ArrayDeque<>();
    private int epoch,navigation,steps;private long loadingStarted;private JSONObject approval;private File screenshot;
    private BrowserTarget.Viewport capturedViewport;
    private JSONObject lastInspection;
    BrowserController(Activity activity,FrameLayout host,ModelChatClient models,Consumer<JSONObject> events){this.activity=activity;this.host=host;this.models=models;this.events=events;}
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private void ensure(){
        if(web!=null)return;web=new WebView(activity);web.setBackgroundColor(Color.WHITE);
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setSupportMultipleWindows(false);web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String scheme=request.getUrl().getScheme();if(!"https".equals(scheme)&&!"http".equals(scheme)){pause("This link needs a separate app. Open it yourself to continue.");return true;}return false;
            }
            public void onPageStarted(WebView view,String url,Bitmap icon){loading=true;loadingStarted=SystemClock.elapsedRealtime();navigation++;if(overlay!=null)overlay.clear();if(!waiting)emit("Loading page…");}
            public void onPageFinished(WebView view,String url){loading=false;if(!waiting)emit(running?"Page ready":"Browser ready");}
            public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())pause("Page error: "+error.getDescription());}
            public void onScaleChanged(WebView view,float oldScale,float newScale){if(oldScale!=newScale){navigation++;if(overlay!=null)overlay.clear();}}
        });
        web.setOnTouchListener((view,event)->{if(event.getActionMasked()==android.view.MotionEvent.ACTION_DOWN&&!injecting){navigation++;if(running)pause("Paused for manual browsing");}return false;});
        web.setOnScrollChangeListener((view,x,y,oldX,oldY)->{if(x!=oldX||y!=oldY)navigation++;});
        web.setDownloadListener((url,userAgent,disposition,mime,length)->pause("A download was requested. Handle it manually before continuing."));
        host.addView(web,new FrameLayout.LayoutParams(1,1));overlay=new BoxOverlay(activity);host.addView(overlay,new FrameLayout.LayoutParams(1,1));
        web.setVisibility(View.GONE);overlay.setVisibility(View.GONE);web.loadUrl("https://www.google.com/");
    }
    void show(boolean show){main.post(()->{visible=show;if(show)ensure();else pause("Paused outside the browser tab");if(web!=null){web.setVisibility(show?View.VISIBLE:View.GONE);overlay.setVisibility(show?View.VISIBLE:View.GONE);if(show)web.onResume();else web.onPause();}});}
    void bounds(String value){main.post(()->{if(!visible||web==null)return;try{
        JSONObject rect=new JSONObject(value);int width=host.getWidth(),height=host.getHeight();
        int x=(int)Math.round(rect.getDouble("x")*width),y=(int)Math.round(rect.getDouble("y")*height);
        int w=(int)Math.round(rect.getDouble("width")*width),h=(int)Math.round(rect.getDouble("height")*height);
        if(x<0||y<0||w<1||h<1||x+w>width+1||y+h>height+1)return;
        FrameLayout.LayoutParams old=(FrameLayout.LayoutParams)web.getLayoutParams();
        if(old.width!=w||old.height!=h||old.leftMargin!=x||old.topMargin!=y){navigation++;overlay.clear();}
        FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(w,h);params.leftMargin=x;params.topMargin=y;web.setLayoutParams(params);
        FrameLayout.LayoutParams box=new FrameLayout.LayoutParams(w,h);box.leftMargin=x;box.topMargin=y;overlay.setLayoutParams(box);
    }catch(JSONException ignored){}});}
    void command(String value){main.post(()->{try{
        JSONObject request=new JSONObject(value);String action=request.getString("action");
        switch(action){
            case "start":
                if(!visible)throw new IOException("Open tab 8 first");ensure();goal=request.getString("goal").trim();if((goal.isEmpty()&&!request.has("audioFile"))||goal.length()>4000)throw new IOException("Enter a goal up to 4,000 characters");
                cancelPending();clearAudio();addAudio(request);if(goal.isEmpty())goal=PromptStorage.load(activity).text("browser.audio_goal");journal.clear();steps=0;waiting=false;approval=null;running=true;emit("Starting browser task…");schedule(350);break;
            case "pause":pause("Paused");break;
            case "stop":cancelPending();running=false;waiting=false;approval=null;goal="";journal.clear();clearAudio();if(overlay!=null)overlay.clear();emit("Stopped");break;
            case "resume":if(goal.isEmpty())throw new IOException("Enter a goal first");if(inflight)throw new IOException("Waiting for the previous response to stop");approval=null;running=true;waiting=false;emit("Resuming…");schedule(250);break;
            case "followup":
                if(!waiting||approval!=null)return;String answer=request.optString("text","");if(answer.length()>4000)throw new IOException("Follow-up is too long");
                addAudio(request);note("User follow-up: "+(request.has("audioFile")?PromptStorage.load(activity).render("browser.followup_audio",Map.of("message",answer)):answer.isEmpty()?PromptStorage.load(activity).text("browser.followup_done"):answer));waiting=false;running=true;schedule(250);break;
            case "approve":
                if(approval==null)return;JSONObject pending=approval;approval=null;waiting=false;running=true;
                if(!sameViewport()){note(PromptStorage.load(activity).text("browser.approval_changed"));schedule(250);}else perform(pending);break;
            case "reject":approval=null;waiting=false;running=true;note(PromptStorage.load(activity).text("browser.declined"));overlay.clear();schedule(250);break;
            case "back":pause("Manual navigation");if(web.canGoBack())web.goBack();break;
            case "home":pause("Manual navigation");web.loadUrl("https://www.google.com/");break;
            case "inspect":pause("Paused for target inspection");inspect();break;
            default:throw new IOException("Unknown browser control");
        }
    }catch(Exception failure){pause(failure.getMessage());}});}
    private void addAudio(JSONObject request)throws Exception {
        if(!request.has("audioFile"))return;if(audioFiles.size()>=4)throw new IOException("Four spoken inputs reached; start a new browser goal");
        String name=request.getString("audioFile");if(!name.matches("[a-zA-Z0-9-]+\\.wav"))throw new IOException("Invalid spoken input");
        File root=new File(activity.getCacheDir(),"chat-input"),source=new File(root,name),copy=new File(root,"browser-audio-"+UUID.randomUUID()+".wav");
        if(!source.isFile()||source.length()>20*1024*1024)throw new IOException("Spoken input is unavailable");
        java.nio.file.Files.copy(source.toPath(),copy.toPath());audioFiles.add(copy.getName());
    }
    private void clearAudio(){for(String name:audioFiles)new File(activity.getCacheDir(),"chat-input/"+name).delete();audioFiles.clear();}
    private void schedule(long delay){int current=epoch;main.postDelayed(()->{if(current==epoch&&running&&visible&&!waiting&&!inflight&&!capturing)capture();},delay);}
    private BrowserTarget.Viewport viewport(){int[] location=new int[2];web.getLocationInWindow(location);return new BrowserTarget.Viewport(location[0],location[1],web.getWidth(),web.getHeight(),web.getScrollX(),web.getScrollY(),navigation);}
    private boolean sameViewport(){return web!=null&&capturedViewport!=null&&capturedViewport.equals(viewport());}
    private void capture(){
        if(web==null||web.getWidth()<10||web.getHeight()<10){pause("Browser viewport is unavailable");return;}
        if(loading){if(SystemClock.elapsedRealtime()-loadingStarted>30000)pause("Page is still loading. Resume when it is ready.");else schedule(500);return;}
        if(steps>=50){running=false;waiting=true;question("50 actions reached. Continue with a follow-up to start another batch.",false);steps=0;return;}
        overlay.clear();capturing=true;int current=++epoch;BrowserTarget.Viewport expected=viewport();emit("Capturing viewport…");
        // Wait for page composition and an overlay-free window frame. PixelCopy sees the
        // same scrolled, zoomed, upright pixels as the user, without a second software draw.
        web.postVisualStateCallback(current,new WebView.VisualStateCallback(){public void onComplete(long ignored){
            if(current!=epoch||!running||!visible)return;
            WebView target=web;target.postOnAnimation(()->target.postOnAnimation(()->copyViewport(current,expected)));
        }});
        main.postDelayed(()->{if(current==epoch&&capturing)pause("Viewport capture timed out. Resume when the page is visible.");},5000);
    }
    private void copyViewport(int current,BrowserTarget.Viewport expected){
        if(current!=epoch||!running||!visible||web==null)return;
        if(!expected.equals(viewport())){capturing=false;schedule(250);return;}
        Bitmap bitmap=Bitmap.createBitmap(expected.width(),expected.height(),Bitmap.Config.ARGB_8888);
        Rect region=new Rect(expected.x(),expected.y(),expected.x()+expected.width(),expected.y()+expected.height());
        try{PixelCopy.request(activity.getWindow(),region,bitmap,result->{
            try{
                if(current!=epoch||!running||!visible||web==null)return;capturing=false;
                if(result!=PixelCopy.SUCCESS)throw new IOException("Viewport capture failed ("+result+"). Resume to retry.");
                if(!expected.equals(viewport())){schedule(250);return;}
                File root=new File(activity.getCacheDir(),"chat-input");if(!root.isDirectory()&&!root.mkdirs())throw new IOException("Cannot save screenshot");
                screenshot=new File(root,UUID.randomUUID()+".png");
                try(FileOutputStream out=new FileOutputStream(screenshot)){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("Cannot encode screenshot");}
                requestId=UUID.randomUUID().toString();capturedViewport=expected;inflight=true;
                File debug=debugRoot();java.nio.file.Files.copy(screenshot.toPath(),new File(debug,"viewport.png").toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                lastInspection=new JSONObject().put("requestId",requestId).put("imageSha256",hash(screenshot)).put("capture","PixelCopy window viewport").put("coordinates","box_2d = [top,left,bottom,right], normalized 0–1000").put("viewport",expected.json()).put("state","Waiting for Gemma");saveInspection();
                models.request(new JSONObject().put("action","agentStep").put("requestId",requestId).put("file",screenshot.getName()).put("audioFiles",new JSONArray(audioFiles))
                    .put("goal",goal).put("journal",String.join("\n",journal)).put("url",web.getUrl()).put("width",expected.width()).put("height",expected.height()).toString());emit("Inspecting viewport…");
            }catch(Exception failure){inflight=false;deleteScreenshot();pause(failure.getMessage());}
            finally{bitmap.recycle();}
        },main);}catch(Exception failure){bitmap.recycle();capturing=false;pause(failure.getMessage());}
    }
    void modelEvent(JSONObject event){
        if(event.optBoolean("unloaded")||event.optBoolean("disconnected")){cancelPending();pause("Model stopped. Load it in tab 7 to continue.");return;}
        if(!event.optString("requestId").equals(requestId)||!event.optString("channel").equals("browser"))return;
        if(event.has("browserDiagnostic")&&lastInspection!=null)try{JSONObject data=event.getJSONObject("browserDiagnostic");for(Iterator<String> i=data.keys();i.hasNext();){String key=i.next();lastInspection.put(key,data.get(key));}saveInspection();}catch(JSONException ignored){}
        if(event.has("error")){inflight=false;inspectionState(event.optString("error"));deleteScreenshot();pause(event.optString("error"));return;}
        if(event.has("result")){
            inflight=false;deleteScreenshot();if(!running||!visible)return;
            try{
                String raw=event.getJSONObject("result").getString("text");if(lastInspection!=null){lastInspection.put("response",raw).put("reasoning",event.getJSONObject("result").optString("reasoning")).put("selection",event.getJSONObject("result").optJSONObject("selection"));saveInspection();}
                if(!sameViewport()){inspectionState("Discarded: viewport changed during generation");note(PromptStorage.load(activity).text("browser.changed"));schedule(300);return;}
                JSONObject action=BrowserAction.parse(raw);String kind=action.getString("action");
                if(lastInspection!=null)lastInspection.put("action",action);
                if(kind.equals("click")){
                    BrowserTarget.Pixels target=BrowserTarget.project(action,capturedViewport);
                    overlay.box(target);if(lastInspection!=null)lastInspection.put("targetPixels",target.json());
                }
                inspectionState("Proposed "+kind);
                if(kind.equals("ask")){running=false;waiting=true;question(action.getString("question"),false);return;}
                if(kind.equals("done")){running=false;overlay.clear();emit("Done · "+action.optString("summary","Task completed"));return;}
                if(action.optBoolean("confirm")){approval=action;running=false;waiting=true;question("Approve: "+action.optString("description",kind)+"?",true);return;}
                emit("Next: "+action.optString("description",kind));int current=epoch;
                main.postDelayed(()->{if(current==epoch&&running&&visible)try{perform(action);}catch(Exception failure){pause(failure.getMessage());}},kind.equals("click")?900:300);
            }catch(Exception failure){inspectionState("Rejected: "+failure.getMessage());pause("No action executed: "+failure.getMessage());}
        }
    }
    private void perform(JSONObject action)throws Exception {
        BrowserAction.validate(action);
        if(!running||!visible)return;if(!sameViewport()){inspectionState("Discarded: viewport changed before action");overlay.clear();schedule(300);return;}String kind=action.getString("action");steps++;
        switch(kind){
            case "click":
                BrowserTarget.Pixels target=BrowserTarget.project(action,capturedViewport);float x=target.x(),y=target.y();
                long now=SystemClock.uptimeMillis();injecting=true;web.requestFocus();
                try{for(int type:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent touch=MotionEvent.obtain(now,now+(type==MotionEvent.ACTION_UP?50:0),type,x,y,0);web.dispatchTouchEvent(touch);touch.recycle();}}finally{injecting=false;}break;
            case "scroll":web.evaluateJavascript("window.scrollBy(0,"+(action.getString("direction").equals("down")?1:-1)+"*window.innerHeight*0.72)",null);break;
            case "type":
                String text=JSONObject.quote(action.getString("text"));
                web.evaluateJavascript("(()=>{const e=document.activeElement;if(!e)return false;if(e.isContentEditable){e.textContent="+text+";}else if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement){const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,"+text+");}else{return false;}e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()",result->{if(!"true".equals(result))pause("No editable field is focused. Resume to let the model select one.");});break;
            case "enter":web.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_ENTER));web.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_ENTER));break;
            case "back":if(web.canGoBack())web.goBack();else{pause("No previous page");return;}break;
        }
        inspectionState("Executed "+kind);note(action.toString());overlay.clear();emit("Action "+steps+" · "+kind);schedule(900);
    }
    private void note(String text){journal.addLast(text.length()>1500?text.substring(0,1500):text);while(journal.size()>12)journal.removeFirst();}
    private void pause(String status){running=false;capturing=false;epoch++;if(inflight)models.request("{\"action\":\"cancel\"}");if(overlay!=null)overlay.clear();emit(status==null?"Paused":status);}
    private void cancelPending(){epoch++;capturing=false;if(inflight)models.request("{\"action\":\"cancel\"}");inflight=false;requestId="";deleteScreenshot();}
    private void deleteScreenshot(){if(screenshot!=null){screenshot.delete();screenshot=null;}}
    private File debugRoot()throws IOException {File root=new File(activity.getCacheDir(),"browser-debug");if(!root.isDirectory()&&!root.mkdirs())throw new IOException("Cannot save browser inspection");return root;}
    private static String hash(File file)throws Exception {byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(file.toPath()));StringBuilder result=new StringBuilder();for(byte b:bytes)result.append(String.format(Locale.ROOT,"%02x",b&255));return result.toString();}
    private void saveInspection(){if(lastInspection==null)return;try(FileOutputStream out=new FileOutputStream(new File(debugRoot(),"last.json"))){out.write(lastInspection.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception failure){android.util.Log.w("CleoBrowser","Cannot save inspection",failure);}}
    private void inspectionState(String state){if(lastInspection!=null)try{lastInspection.put("state",state);saveInspection();}catch(JSONException ignored){}}
    private void inspect()throws Exception {
        File root=debugRoot(),file=new File(root,"viewport.png");
        if(lastInspection==null){File saved=new File(root,"last.json");if(saved.isFile())lastInspection=new JSONObject(new String(java.nio.file.Files.readAllBytes(saved.toPath()),java.nio.charset.StandardCharsets.UTF_8));}
        if(lastInspection==null||!file.isFile())throw new IOException("Run a browser step first to inspect its screenshot and target");
        if(!hash(file).equals(lastInspection.optString("imageSha256")))throw new IOException("Inspection was interrupted; run another step to capture a matching image and result");
        Bitmap image=BitmapFactory.decodeFile(file.getPath(),new BitmapFactory.Options());if(image==null)throw new IOException("Captured image is unavailable");
        Bitmap display=image.copy(Bitmap.Config.ARGB_8888,true);image.recycle();
        JSONObject p=lastInspection.optJSONObject("targetPixels");
        if(p!=null){Canvas canvas=new Canvas(display);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setColor(0xffffb000);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(4);
            canvas.drawRect((float)p.getDouble("left"),(float)p.getDouble("top"),(float)p.getDouble("right"),(float)p.getDouble("bottom"),paint);
            canvas.drawCircle((float)p.getDouble("tapX"),(float)p.getDouble("tapY"),7,paint);}
        android.widget.LinearLayout content=new android.widget.LinearLayout(activity);content.setOrientation(android.widget.LinearLayout.VERTICAL);content.setPadding(16,8,16,8);
        android.widget.ImageView preview=new android.widget.ImageView(activity);preview.setImageBitmap(display);preview.setAdjustViewBounds(true);preview.setContentDescription("Exact screenshot given to Gemma, with its proposed target");content.addView(preview,new android.widget.LinearLayout.LayoutParams(-1,-2));
        android.widget.TextView text=new android.widget.TextView(activity);text.setText(lastInspection.toString(2));text.setTextIsSelectable(true);text.setTextSize(12);content.addView(text);
        android.widget.ScrollView scroll=new android.widget.ScrollView(activity);scroll.addView(content);
        android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity).setTitle("Gemma’s last view and target").setView(scroll).setPositiveButton("Close",null)
            .setNeutralButton("Clear",(d,which)->{file.delete();new File(root,"last.json").delete();lastInspection=null;}).create();
        dialog.setOnDismissListener(d->display.recycle());dialog.show();
    }
    private void question(String text,boolean confirm){try{JSONObject event=status(text);event.put("question",text).put("confirmation",confirm);events.accept(event);}catch(JSONException ignored){}}
    private JSONObject status(String text)throws JSONException{return new JSONObject().put("type","browser").put("status",text).put("running",running).put("waiting",waiting).put("steps",steps).put("url",web==null?"":web.getUrl());}
    private void emit(String text){try{events.accept(status(text));}catch(JSONException ignored){}}
    void close(){cancelPending();clearAudio();if(web!=null){web.stopLoading();web.destroy();host.removeView(web);host.removeView(overlay);web=null;}}
    private static final class BoxOverlay extends View {
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private BrowserTarget.Pixels box;
        BoxOverlay(android.content.Context context){super(context);setClickable(false);setFocusable(false);}
        void box(BrowserTarget.Pixels value){box=value;invalidate();}
        void clear(){box=null;invalidate();}
        protected void onDraw(Canvas canvas){if(box==null)return;paint.setColor(0xfff7c94a);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(4);canvas.drawRect(box.left(),box.top(),box.right(),box.bottom(),paint);canvas.drawCircle(box.x(),box.y(),7,paint);}
    }
}
