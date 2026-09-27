package ai.cleo.ardyavatarvalidation;

import android.app.*;
import android.content.Intent;
import android.os.*;
import com.google.ai.edge.litertlm.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Shared Gemma engine for chat, browser and avatar. Every load/generation is user initiated. */
public final class ModelChatService extends Service {
    static final int COMMAND=1,EVENT=2;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private final AtomicLong cancellation=new AtomicLong();
    private long operationCancellation;
    private volatile Messenger client;
    private Engine engine;
    private volatile Conversation conversation,avatarConversation,mainConversation,activeConversation;
    private MainAvatarToolApi mainTools;
    private String mainToolKey="";
    private volatile JSONArray mainHistory=new JSONArray();
    private volatile boolean mainPrepared,resident=true;
    private double prefillMs;
    private int prefillTokens=-1;
    private int mainTurns;
    private AvatarToolApi avatarTools;
    private String avatarToolKey="";
    private volatile JSONArray avatarHistory=new JSONArray();
    private int avatarTurns;
    private volatile boolean stopping,loaded;
    private volatile String requestId="",channel="chat";
    private volatile JSONObject selection=new JSONObject(),lastMetrics=new JSONObject();
    private volatile JSONArray history=new JSONArray();
    private int avatarPid,turns;
    private double loadMs;
    private static final String CHANNEL="cleo-model-chat";
    private final Messenger binder=new Messenger(new Handler(Looper.getMainLooper(),message->{
        if(message.what!=COMMAND)return false;client=message.replyTo;
        try{JSONObject request=new JSONObject(message.getData().getString("json","{}"));
            String action=request.optString("action");resident=request.optBoolean("resident",resident);avatarPid=request.optInt("avatarPid",avatarPid);
            if(action.equals("status")){state();return true;}
            if(action.equals("cancel")){cancellation.incrementAndGet();if(activeConversation!=null)activeConversation.cancelProcess();return true;}
            if(action.equals("resident")){state();return true;}
            if(action.equals("unload")){unload();return true;}
            if(action.equals("background")){if(busy.get()){cancellation.incrementAndGet();if(activeConversation!=null)activeConversation.cancelProcess();}if(!resident)unload();return true;}
            if(stopping||!busy.compareAndSet(false,true)){emit(json("error","A model operation is already running"));return true;}
            worker.execute(()->execute(request));
        }catch(Exception failure){emit(json("error",failure.toString()));}
        return true;
    }));
    @Override public IBinder onBind(Intent intent){return binder.getBinder();}
    @Override public void onCreate(){super.onCreate();getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Cleopatra local models",NotificationManager.IMPORTANCE_LOW));}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&"unload".equals(intent.getAction())){unload();return START_NOT_STICKY;}
        PendingIntent stop=PendingIntent.getService(this,17,new Intent(this,ModelChatService.class).setAction("unload"),PendingIntent.FLAG_IMMUTABLE);
        startForeground(17,new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("Cleopatra local models").setContentText("Resident · sleeps between messages")
            .addAction(new Notification.Action.Builder(null,"Unload",stop).build()).setOngoing(true).build());
        return START_NOT_STICKY;
    }
    private void execute(JSONObject request){
        operationCancellation=cancellation.get();
        requestId=request.optString("requestId","");channel=request.optString("action").equals("agentStep")?"browser":request.optString("action").startsWith("avatar")?"avatar":request.optString("action").startsWith("main")?"main":"chat";
        ScheduledExecutorService monitor=Executors.newSingleThreadScheduledExecutor();
        AtomicLong peak=new AtomicLong();JSONObject cpuStart=memory();
        state();
        monitor.scheduleWithFixedDelay(()->{JSONObject value=memory();long pss=value.optLong("pssKb",0);peak.accumulateAndGet(pss,Math::max);try{value.put("peakPssKb",peak.get());}catch(JSONException ignored){}emit(json("memory",value));},0,1000,TimeUnit.MILLISECONDS);
        try{
            switch(request.getString("action")){
                case "load":load(request);break;
                case "newChat":
                    if(conversation!=null){conversation.close();conversation=null;}
                    turns=0;history=new JSONArray();lastMetrics=new JSONObject();break;
                case "send":send(request);break;
                case "avatarSend":avatarSend(request);break;
                case "mainPrepare":prepareMain(request);break;
                case "mainSend":mainSend(request);break;
                case "mainNew":closeMainConversation();prepareMain(request);break;
                case "avatarNew":closeAvatarConversation();break;
                case "agentStep":agentStep(request);break;
                default:throw new IOException("Unknown chat command");
            }
        }catch(Throwable failure){
            android.util.Log.e("CleoGemma",request.optString("action")+" failed",failure);
            ModelDiagnostics.stage(this,"failed "+request.optString("action"),selection);
            if(request.optString("action").equals("load")){closeModels();loaded=false;}
            if(channel.equals("main"))closeMainConversation();
            else if(channel.equals("avatar"))closeAvatarConversation();
            else if(request.optString("action").equals("send")){if(conversation!=null){conversation.close();conversation=null;}history=new JSONArray();turns=0;}
            emit(json("error",failure.getMessage()==null?failure.toString():failure.getMessage()));
        }finally{
            monitor.shutdownNow();busy.set(false);
            JSONObject measured=memory();try{
                measured.put("peakPssKb",Math.max(peak.get(),measured.optLong("pssKb",0)));
                double start=cpuStart.optDouble("modelCpuTotalMs",-1),end=measured.optDouble("modelCpuTotalMs",-1);
                if(start>=0&&end>=start)lastMetrics.put("cpuMs",end-start);
                lastMetrics.put("memory",measured).put("loadMs",loadMs);
            }catch(JSONException ignored){}
            state();
        }
    }
    private void load(JSONObject request)throws Exception {
        closeModels();loaded=false;history=new JSONArray();turns=0;lastMetrics=new JSONObject();
        String backend=request.optString("backend","litert-gpu"),model=request.optString("model","gemma");int reasoning=request.optInt("reasoning",0),visualTokens=request.optInt("visualTokens",280),contextTokens=request.optInt("contextTokens",4096);
        Object context=request.opt("contextTokens");
        if(!Set.of(4096,8192,16384,32768,65536,131072).contains(contextTokens)||(context!=null&&(!(context instanceof Number)||((Number)context).doubleValue()!=contextTokens)))throw new IOException("Unsupported context size");
        if(!Set.of("gemma","gemma-e4b").contains(model)||!Set.of(70,140,280,560,1120).contains(visualTokens)||!Set.of("litert-cpu","litert-gpu").contains(backend)||!Set.of(0,128,256,512).contains(reasoning))throw new IOException("Unsupported Gemma settings");
        selection=new JSONObject().put("model",model).put("backend",backend).put("reasoning",reasoning).put("visualTokens",visualTokens).put("contextTokens",contextTokens);
        long start=SystemClock.elapsedRealtimeNanos();boolean gpu=backend.equals("litert-gpu");
        emit(json("phase","Loading Gemma with vision and audio..."));
        File file=new File(getFilesDir(),"benchmark/gemma-4-"+(model.equals("gemma-e4b")?"E4B":"E2B")+"-it.litertlm");
        if(!file.isFile())throw new IOException("Missing full Gemma audio/vision model");
        ExperimentalFlags.INSTANCE.setVisualTokenBudget(visualTokens); // Must precede engine creation: reserves the matching vision buffers.
        ModelDiagnostics.stage(this,"engine initialization",selection);
        engine=new Engine(new EngineConfig(file.getPath(),gpu?new Backend.GPU():new Backend.CPU(2,null),gpu?new Backend.GPU():new Backend.CPU(2,null),new Backend.CPU(2,null),contextTokens,8,getCacheDir().getPath()));
        engine.initialize();checkCancelled();loadMs=elapsed(start);loaded=true;emit(json("phase","Gemma ready · "+contextTokens+"-token context"));
        ModelDiagnostics.stage(this,"engine ready",selection);
    }
    private Conversation createConversation(AvatarToolApi api)throws Exception {
        List<ToolProvider> tools=new ArrayList<>();Contents instruction=null;
        if(api!=null){
            instruction=Contents.Companion.of(api.instructions());
            final String schema=api.description().toString();
            tools.add(ToolKt.tool(new OpenApiTool(){public String getToolDescriptionJsonString(){return schema;}public String execute(String arguments){throw new IllegalStateException("Avatar tools require explicit validation");}}));
        }
        int reasoning=selection.getInt("reasoning");
        return engine.createConversation(new ConversationConfig(instruction,Collections.emptyList(),tools,new SamplerConfig(40,.95,.3,42),false,
            null,Collections.emptyMap(),null,api instanceof MainAvatarToolApi,(api==null?512:768)+reasoning,new ThinkingConfig(reasoning>0,reasoning),false));
    }
    private com.google.ai.edge.litertlm.Message input(String prompt,String kind,byte[] media){
        List<Content> parts=new ArrayList<>();if("image".equals(kind))parts.add(new Content.ImageBytes(media));if("audio".equals(kind))parts.add(new Content.AudioBytes(media));parts.add(new Content.Text(prompt));
        return new com.google.ai.edge.litertlm.Message(Role.USER,Contents.Companion.of(parts),Collections.emptyList(),Collections.emptyMap());
    }
    private List<ToolCall> stream(Conversation active,com.google.ai.edge.litertlm.Message input,GemmaStream text,long started,AtomicLong first)throws Exception {
        checkCancelled();activeConversation=active;
        AtomicReference<Throwable> error=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        List<ToolCall> calls=new ArrayList<>();Set<String> seen=new HashSet<>();
        try{
            active.sendMessageAsync(input,new MessageCallback(){
                public void onMessage(com.google.ai.edge.litertlm.Message message){
                    StringBuilder chunk=new StringBuilder();for(Content part:message.getContents().getContents())if(part instanceof Content.Text)chunk.append(((Content.Text)part).getText());
                    if(chunk.length()>0)first.compareAndSet(-1,SystemClock.elapsedRealtimeNanos());
                    text.append(chunk.toString(),message.getChannels());
                    for(ToolCall call:message.getToolCalls()){String key=call.getName()+call.getArguments().toString();if(seen.add(key))calls.add(call);}
                    try{emit(text.event());}catch(JSONException failure){error.set(failure);}
                }
                public void onDone(){done.countDown();}public void onError(Throwable failure){error.set(failure);done.countDown();}
            });
            if(!done.await(180,TimeUnit.SECONDS)){active.cancelProcess();throw new IOException("Gemma timed out; start a new conversation");}
            if(error.get()!=null)throw new IOException("Gemma response failed",error.get());checkCancelled();return calls;
        }finally{activeConversation=null;}
    }
    private JSONObject result(GemmaStream text,long started,AtomicLong first)throws Exception {
        return new JSONObject().put("text",text.answer.toString()).put("reasoning",text.reasoning.toString()).put("totalMs",elapsed(started)).put("modelMs",elapsed(started))
            .put("firstTokenMs",first.get()<0?-1:(first.get()-started)/1e6).put("prefixCache","Persistent Gemma conversation; reused token count unavailable");
    }
    private void send(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load Gemma first");
        String prompt=request.optString("text","").trim(),kind=request.optString("kind","");
        if(prompt.length()>12000||!Set.of("","image","audio").contains(kind))throw new IOException("Invalid message");
        byte[] media=null;if(!kind.isEmpty()){File file=inputFile(request.getString("file"));if(file.length()>20*1024*1024)throw new IOException("Attachment too large");media=Files.readAllBytes(file.toPath());}
        if(prompt.isEmpty()&&kind.isEmpty())throw new IOException("Enter a message or attach media");
        if(prompt.isEmpty())prompt=kind.equals("image")?"Describe this image.":"Respond to the speech in this audio.";
        if(conversation==null)conversation=createConversation(null);
        long started=SystemClock.elapsedRealtimeNanos();GemmaStream text=new GemmaStream();AtomicLong first=new AtomicLong(-1);
        stream(conversation,input(prompt,kind,media),text,started,first);JSONObject result=result(text,started,first);
        history.put(new JSONObject().put("role","user").put("text",request.optString("text")).put("attachment",kind));
        history.put(new JSONObject().put("role","assistant").put("text",text.answer.toString()).put("reasoning",text.reasoning.toString()));turns++;
        lastMetrics=result;emit(json("result",result));
    }
    private void avatarSend(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load all models first");
        String prompt=request.optString("text","").trim(),kind=request.optString("kind","");
        if(prompt.length()>4000||!Set.of("","audio","image").contains(kind)||(prompt.isEmpty()&&kind.isEmpty()))throw new IOException("Enter a message or attach audio/image");
        byte[] media=kind.isEmpty()?null:readMedia(request.getString("file"));
        if(prompt.isEmpty())prompt=kind.equals("audio")?"Respond to the speech in this audio.":"Respond to this image.";
        JSONArray catalog=request.getJSONArray("motions"),expressions=request.getJSONArray("expressions");String key=catalog.toString()+expressions.toString();
        if(avatarConversation==null||!key.equals(avatarToolKey)){
            closeAvatarConversation();avatarTools=new AvatarToolApi(catalog,expressions);avatarToolKey=key;avatarConversation=createConversation(avatarTools);
        }
        avatarTools.reset();GemmaStream text=new GemmaStream();AtomicLong first=new AtomicLong(-1);long started=SystemClock.elapsedRealtimeNanos();
        com.google.ai.edge.litertlm.Message next=input(prompt,kind,media);JSONArray actions=new JSONArray();
        for(int round=0;;round++){
            List<ToolCall> calls=stream(avatarConversation,next,text,started,first);
            if(calls.isEmpty())break;
            if(round>=3||calls.size()>3)throw new IOException("Avatar tool-call limit reached");
            List<Content> responses=new ArrayList<>();
            for(ToolCall call:calls){
                checkCancelled();JSONObject args=new JSONObject(call.getArguments()),out;
                try{out=avatarTools.execute(call.getName(),args);}catch(Exception invalid){out=new JSONObject().put("ok",false).put("error",invalid.getMessage());}
                JSONObject action=new JSONObject().put("name",call.getName()).put("arguments",args).put("result",out);actions.put(action);emit(json("avatarTool",action));
                responses.add(new Content.ToolResponse(call.getName(),out.toString()));
            }
            next=new com.google.ai.edge.litertlm.Message(Role.TOOL,Contents.Companion.of(responses),Collections.emptyList(),Collections.emptyMap());
        }
        checkCancelled();if(text.answer.toString().isBlank())throw new IOException("Gemma did not provide a spoken answer");
        JSONObject result=result(text,started,first).put("avatarPlan",avatarTools.plan()).put("tools",actions);
        avatarHistory.put(new JSONObject().put("role","user").put("text",prompt).put("attachment",kind));
        avatarHistory.put(new JSONObject().put("role","assistant").put("text",text.answer.toString()).put("reasoning",text.reasoning.toString()).put("tools",actions));avatarTurns++;
        lastMetrics=result;emit(json("result",result));
    }
    private void prepareMain(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load Gemma first");
        JSONArray catalog=request.getJSONArray("motions"),expressions=request.getJSONArray("expressions");String key=catalog.toString()+expressions.toString();
        if(mainConversation==null||!key.equals(mainToolKey)){
            closeMainConversation();mainTools=new MainAvatarToolApi(catalog,expressions);mainToolKey=key;
            long start=SystemClock.elapsedRealtimeNanos();emit(json("phase","Preparing Cleopatra's situation and avatar controls…"));
            ModelDiagnostics.stage(this,"avatar prompt preparation",selection);
            mainConversation=createConversation(mainTools);checkCancelled();prefillMs=elapsed(start);try{prefillTokens=mainConversation.getTokenCount();}catch(RuntimeException unavailable){prefillTokens=-1;}mainPrepared=true;
            ModelDiagnostics.stage(this,"avatar prompt ready",selection);
        }
        emit(json("mainPrepared",true));
    }
    private String scene(JSONObject request)throws Exception {
        JSONObject input=request.optJSONObject("scene"),safe=new JSONObject();
        if(input!=null)for(String group:List.of("camera","root")){
            JSONObject values=input.optJSONObject(group);if(values==null)continue;JSONObject clean=new JSONObject();
            for(String key:List.of("yaw","elevation","distance","height","pan_x","pan_z","x","z","heading"))
                if(values.opt(key) instanceof Number&&Double.isFinite(values.getDouble(key)))clean.put(key,values.getDouble(key));
            safe.put(group,clean);
        }
        return safe.toString();
    }
    private void mainSend(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load all models first");
        String prompt=request.optString("text","").trim(),kind=request.optString("kind","");
        if(prompt.length()>4000||!Set.of("","audio","image").contains(kind)||(prompt.isEmpty()&&kind.isEmpty()))throw new IOException("Enter a message or attach audio/image");
        byte[] media=kind.isEmpty()?null:readMedia(request.getString("file"));
        if(prompt.isEmpty())prompt=kind.equals("audio")?"Respond to the speech in this audio.":"Respond to this image.";
        prepareMain(request);
        mainTools.frame(request.getString("frame"));
        mainTools.reset();GemmaStream text=new GemmaStream();AtomicLong first=new AtomicLong(-1);long started=SystemClock.elapsedRealtimeNanos();
        com.google.ai.edge.litertlm.Message next=input("APP SCENE: frame="+request.getString("frame")+"; "+scene(request)+"\nUSER MESSAGE:\n"+prompt,kind,media);JSONArray actions=new JSONArray();
        for(int round=0;;round++){
            List<ToolCall> calls=stream(mainConversation,next,text,started,first);
            if(calls.isEmpty())break;
            if(round>=3||calls.size()>3)throw new IOException("Avatar tool-call limit reached");
            List<Content> responses=new ArrayList<>();
            for(ToolCall call:calls){
                checkCancelled();JSONObject args=new JSONObject(call.getArguments()),out;
                try{out=mainTools.execute(call.getName(),args);}catch(Exception invalid){out=new JSONObject().put("ok",false).put("error",invalid.getMessage());}
                JSONObject action=new JSONObject().put("name",call.getName()).put("arguments",args).put("result",out);actions.put(action);emit(json("avatarTool",action));
                responses.add(new Content.ToolResponse(call.getName(),out.toString()));
            }
            next=new com.google.ai.edge.litertlm.Message(Role.TOOL,Contents.Companion.of(responses),Collections.emptyList(),Collections.emptyMap());
        }
        checkCancelled();if(text.answer.toString().isBlank())throw new IOException("Gemma did not provide a spoken answer");
        JSONObject result=result(text,started,first).put("avatarPlan",mainTools.plan()).put("tools",actions);
        mainHistory.put(new JSONObject().put("role","user").put("text",prompt).put("attachment",kind));
        mainHistory.put(new JSONObject().put("role","assistant").put("text",text.answer.toString()).put("reasoning",text.reasoning.toString()).put("tools",actions));mainTurns++;
        lastMetrics=result;emit(json("result",result));
    }
    private void agentStep(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load Gemma in tab 7 first");String prompt=request.getString("text");if(prompt.length()>24000)throw new IOException("Browser context too large");
        File file=inputFile(request.getString("file"));if(file.length()>20*1024*1024)throw new IOException("Screenshot too large");
        long started=SystemClock.elapsedRealtimeNanos();GemmaStream text=new GemmaStream();AtomicLong first=new AtomicLong(-1);
        List<Content> parts=new ArrayList<>();parts.add(new Content.ImageBytes(Files.readAllBytes(file.toPath())));
        JSONArray audio=request.optJSONArray("audioFiles");if(audio!=null){if(audio.length()>4)throw new IOException("Too many audio instructions");for(int i=0;i<audio.length();i++){parts.add(new Content.Text("User spoken instruction "+(i+1)+" (chronological order):"));parts.add(new Content.AudioBytes(readMedia(audio.getString(i))));}}
        parts.add(new Content.Text(prompt));
        com.google.ai.edge.litertlm.Message message=new com.google.ai.edge.litertlm.Message(Role.USER,Contents.Companion.of(parts),Collections.emptyList(),Collections.emptyMap());
        try(Conversation active=createConversation(null)){stream(active,message,text,started,first);}
        lastMetrics=result(text,started,first);emit(json("result",lastMetrics));
    }
    private void checkCancelled()throws InterruptedIOException{if(stopping||cancellation.get()!=operationCancellation)throw new InterruptedIOException("Response cancelled; conversation reset");}
    private static double elapsed(long started){return (SystemClock.elapsedRealtimeNanos()-started)/1e6;}
    private byte[] readMedia(String name)throws IOException{File file=inputFile(name);if(file.length()>20*1024*1024)throw new IOException("Attachment too large");return Files.readAllBytes(file.toPath());}
    private File inputFile(String name)throws IOException{
        if(!name.matches("[a-zA-Z0-9-]+\\.(png|wav)"))throw new IOException("Invalid attachment");File file=new File(getCacheDir(),"chat-input/"+name);if(!file.isFile())throw new IOException("Attachment is unavailable");return file;
    }
    private JSONObject memory(){
        JSONObject result=new JSONObject();JSONArray rows=new JSONArray();long pss=0,rss=0;double cpu=0;boolean complete=true,cpuComplete=true;
        List<Integer> pids=List.of(android.os.Process.myPid());
        try{
            for(int pid:pids){JSONObject row=processMemory(pid);rows.put(row);if(!row.has("pssKb"))complete=false;if(!row.has("cpuTotalMs"))cpuComplete=false;pss+=row.optLong("pssKb");rss+=row.optLong("rssKb");cpu+=row.optDouble("cpuTotalMs",0);}
            result.put("modelPssKb",pss);if(cpuComplete)result.put("modelCpuTotalMs",cpu);
            if(avatarPid>0){JSONObject avatar=processMemory(avatarPid);rows.put(avatar);if(!avatar.has("pssKb"))complete=false;pss+=avatar.optLong("pssKb");rss+=avatar.optLong("rssKb");result.put("avatarPssKb",avatar.optLong("pssKb",-1));}
            result.put("pssKb",pss).put("rssKb",rss).put("complete",complete).put("processes",rows);
            result.put("thermalStatus",getSystemService(PowerManager.class).getCurrentThermalStatus());
        }catch(Exception ignored){}return result;
    }
    private JSONObject processMemory(int pid)throws Exception {
        JSONObject row=new JSONObject().put("pid",pid);
        try{for(String line:Files.readAllLines(new File("/proc/"+pid+"/smaps_rollup").toPath())){
            if(line.startsWith("Pss:"))row.put("pssKb",Long.parseLong(line.trim().split("\\s+")[1]));
            if(line.startsWith("Rss:"))row.put("rssKb",Long.parseLong(line.trim().split("\\s+")[1]));
        }}catch(Exception denied){Debug.MemoryInfo[] info=getSystemService(ActivityManager.class).getProcessMemoryInfo(new int[]{pid});if(info.length>0&&info[0].getTotalPss()>0)row.put("pssKb",info[0].getTotalPss());}
        try{String stat=new String(Files.readAllBytes(new File("/proc/"+pid+"/stat").toPath()),StandardCharsets.UTF_8);String[] fields=stat.substring(stat.lastIndexOf(')')+2).split(" ");long ticks=Long.parseLong(fields[11])+Long.parseLong(fields[12]);row.put("cpuTotalMs",ticks*1000.0/android.system.Os.sysconf(android.system.OsConstants._SC_CLK_TCK));}catch(Exception ignored){}
        return row;
    }
    private void state(){try{emit(new JSONObject().put("state",true).put("loaded",loaded).put("busy",busy.get()).put("selection",selection).put("history",history).put("metrics",new JSONObject(lastMetrics.toString()).put("memory",memory())).put("turns",turns).put("avatarHistory",avatarHistory).put("avatarTurns",avatarTurns).put("mainHistory",mainHistory).put("mainTurns",mainTurns).put("mainPrepared",mainPrepared).put("prefillMs",prefillMs).put("prefillTokens",prefillTokens).put("resident",resident));}catch(JSONException ignored){}}
    private void emit(JSONObject value){try{value.put("type","chat").put("modelPid",android.os.Process.myPid()).put("requestId",requestId).put("channel",channel);Messenger target=client;if(target!=null){android.os.Message message=android.os.Message.obtain(null,EVENT);Bundle bundle=new Bundle();bundle.putString("json",value.toString());message.setData(bundle);target.send(message);}}catch(Exception ignored){}}
    private static JSONObject json(String key,Object value){try{return new JSONObject().put(key,value);}catch(JSONException impossible){throw new IllegalArgumentException(impossible);}}
    private void closeAvatarConversation(){if(avatarConversation!=null){avatarConversation.close();avatarConversation=null;}avatarTools=null;avatarToolKey="";avatarHistory=new JSONArray();avatarTurns=0;}
    private void closeMainConversation(){mainPrepared=false;if(mainConversation!=null){mainConversation.close();mainConversation=null;}mainTools=null;mainToolKey="";mainHistory=new JSONArray();mainTurns=0;prefillMs=0;prefillTokens=-1;}
    private void closeModels(){loaded=false;closeMainConversation();closeAvatarConversation();if(conversation!=null){conversation.close();conversation=null;}if(engine!=null){try{if(engine.isInitialized())engine.close();}finally{engine=null;}}}
    private void unload(){
        if(stopping)return;stopping=true;loaded=false;
        Conversation active=activeConversation;if(active!=null)active.cancelProcess();
        emit(json("unloaded",true));stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
        worker.execute(()->{try{closeModels();}finally{android.os.Process.killProcess(android.os.Process.myPid());}});
        new Handler(Looper.getMainLooper()).postDelayed(()->android.os.Process.killProcess(android.os.Process.myPid()),3000);
    }
    @Override public void onDestroy(){if(!stopping)unload();worker.shutdown();super.onDestroy();}
    @Override public void onTrimMemory(int level){super.onTrimMemory(level);if(!resident&&(level==TRIM_MEMORY_RUNNING_CRITICAL||level>=TRIM_MEMORY_MODERATE))unload();}
}
