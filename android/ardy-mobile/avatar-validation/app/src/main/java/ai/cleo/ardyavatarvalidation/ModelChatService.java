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

/** Tab 7's resident models. Loading and generation require an explicit app command. */
public final class ModelChatService extends Service {
    static final int COMMAND=1,EVENT=2;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private final AtomicLong cancellation=new AtomicLong();
    private long operationCancellation;
    private volatile Messenger client;
    private volatile NativeChatRuntime nativeRuntime;
    private Engine engine;
    private volatile Conversation conversation;
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
            String action=request.optString("action");avatarPid=request.optInt("avatarPid",avatarPid);
            if(action.equals("status")){state();return true;}
            if(action.equals("cancel")){cancellation.incrementAndGet();if(nativeRuntime!=null)nativeRuntime.cancel();if(conversation!=null)conversation.cancelProcess();return true;}
            if(action.equals("unload")||(action.equals("background")&&busy.get())){unload();return true;}
            if(action.equals("background"))return true;
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
            .addAction(new Notification.Action.Builder(null,"Unload",stop).build()).build());
        return START_NOT_STICKY;
    }
    private void execute(JSONObject request){
        operationCancellation=cancellation.get();
        requestId=request.optString("requestId","");channel=request.optString("action").equals("agentStep")?"browser":"chat";
        ScheduledExecutorService monitor=Executors.newSingleThreadScheduledExecutor();
        AtomicLong peak=new AtomicLong();JSONObject cpuStart=memory();
        state();
        monitor.scheduleWithFixedDelay(()->{JSONObject value=memory();long pss=value.optLong("pssKb",0);peak.accumulateAndGet(pss,Math::max);try{value.put("peakPssKb",peak.get());}catch(JSONException ignored){}emit(json("memory",value));},0,1000,TimeUnit.MILLISECONDS);
        try{
            switch(request.getString("action")){
                case "load":load(request);break;
                case "newChat":
                    if(nativeRuntime!=null)nativeRuntime.newChat();
                    if(conversation!=null){conversation.close();conversation=null;}
                    turns=0;history=new JSONArray();lastMetrics=new JSONObject();break;
                case "send":send(request);break;
                case "agentStep":agentStep(request);break;
                default:throw new IOException("Unknown chat command");
            }
        }catch(Throwable failure){
            if(request.optString("action").equals("load")){closeModels();loaded=false;}
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
        String model=request.optString("model","qwen"),backend=request.optString("backend","cpu"),asr=request.optString("whisper","base");
        int tokens=request.optInt("imageTokens",560),minTokens=request.optInt("imageMinTokens",0),batchTokens=request.optInt("imageBatchTokens",1024),reasoning=request.optInt("reasoning",256);
        if(!Set.of("qwen","gemma").contains(model)||!Set.of("cpu","opencl","litert-cpu","litert-gpu").contains(backend)
            ||!Set.of("tiny","base","small","whisperx-base").contains(asr)||tokens<70||tokens>2048||minTokens<0||minTokens>tokens||batchTokens<32||batchTokens>2048||!Set.of(0,128,256,512).contains(reasoning))throw new IOException("Unsupported chat settings");
        boolean qwen=model.equals("qwen"),lite=backend.startsWith("litert");
        selection=new JSONObject().put("model",model).put("backend",backend).put("whisper",asr).put("imageTokens",tokens).put("imageMinTokens",minTokens).put("imageBatchTokens",batchTokens).put("reasoning",reasoning);
        long start=SystemClock.elapsedRealtimeNanos();
        if(backend.startsWith("litert")){
            emit(json("phase","Loading "+(qwen?"Qwen + vision":"Gemma + vision/audio")+" LiteRT…"));boolean gpu=backend.endsWith("gpu");
            File file=modelFile(qwen?"Qwen3.5-2B-Cleo-512-4k-int8.litertlm":"gemma-4-E2B-it.litertlm");
            Backend selected=gpu?new Backend.GPU():new Backend.CPU(2,null);
            engine=new Engine(new EngineConfig(file.getPath(),selected,gpu?new Backend.GPU():new Backend.CPU(2,null),qwen?null:new Backend.CPU(2,null),4096,qwen?1:8,getCacheDir().getPath()));
            engine.initialize();
            if(qwen){nativeRuntime=new NativeChatRuntime(this);emit(json("phase","Qwen LiteRT ready · loading Whisper…"));nativeRuntime.loadWhisper(asr,message->emit(json("phase",message)));}
        }else{
            nativeRuntime=new NativeChatRuntime(this);
            nativeRuntime.load(model,backend,asr,minTokens,tokens,batchTokens,message->emit(json("phase",message)));
        }
        if(stopping)throw new InterruptedIOException("Unloaded");
        loadMs=NativeChatRuntime.elapsed(start);loaded=true;
        emit(json("phase",model.equals("qwen")?"Qwen + Whisper ready":"Gemma ready"));
    }
    private void send(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load a model first");
        String prompt=request.optString("text","").trim(),kind=request.optString("kind","");
        if(prompt.length()>12000)throw new IOException("Message too long");
        if(!Set.of("","image","audio").contains(kind))throw new IOException("Unknown attachment type");
        byte[] media=null;if(!kind.isEmpty()){
            File input=inputFile(request.getString("file"));if(input.length()>20*1024*1024)throw new IOException("Attachment too large");media=Files.readAllBytes(input.toPath());
        }
        if(prompt.isEmpty()&&kind.isEmpty())throw new IOException("Enter a message or attach media");
        if(prompt.isEmpty())prompt=kind.equals("image")?"Describe this image.":selection.optString("model").equals("qwen")?"":"Respond to the speech in this audio.";
        emit(json("phase",kind.equals("audio")?"Processing audio…":"Thinking…"));
        JSONObject result;
        if(engine==null)result=nativeRuntime.chat(prompt,kind,media,selection.getInt("reasoning"),this::emit);
        else {
            long start=SystemClock.elapsedRealtimeNanos();double asrWall=0;JSONObject asr=null;
            if(kind.equals("audio")&&selection.getString("model").equals("qwen")){
                emit(json("phase","Transcribing with Whisper…"));asr=nativeRuntime.transcribeAudio(media);asrWall=NativeChatRuntime.elapsed(start);
                String transcript=asr.getString("text").trim();if(transcript.isEmpty())throw new IOException("Whisper found no speech. No empty turn was added.");
                prompt=(prompt.isBlank()?"":prompt+"\n\n")+transcript;kind="";emit(json("transcript",transcript));
            }
            checkCancelled();result=liteChat(prompt,kind,media);
            if(asr!=null){double first=result.optDouble("firstTokenMs",-1);result.put("transcript",asr.getString("text").trim()).put("asrDetails",asr).put("asrMs",asr.optDouble("deviceRequestMs",asrWall)).put("firstTokenMs",first<0?-1:first+asrWall).put("totalMs",NativeChatRuntime.elapsed(start));}
        }
        turns++;
        String display=request.optString("text");if(result.has("transcript"))display=(display.isBlank()?"":display+"\n")+result.getString("transcript");
        JSONArray next=new JSONArray(history.toString());next.put(new JSONObject().put("role","user").put("text",display).put("attachment",request.optString("kind","")));
        next.put(new JSONObject().put("role","assistant").put("text",result.getString("text")));history=next;
        lastMetrics=result;emit(json("result",result));
    }
    private JSONObject liteChat(String prompt,String kind,byte[] media)throws Exception {
        checkCancelled();
        int reasoning=selection.getInt("reasoning");long started=SystemClock.elapsedRealtimeNanos();
        boolean qwen=selection.getString("model").equals("qwen");
        if(conversation==null){
            SamplerConfig sampler=qwen?new SamplerConfig(20,reasoning>0?.95:.8,reasoning>0?1.0:.7,42):new SamplerConfig(40,.95,.3,42);
            ConversationConfig options=new ConversationConfig(null,Collections.emptyList(),Collections.emptyList(),sampler,false,
                null,Collections.emptyMap(),null,false,512+reasoning,new ThinkingConfig(reasoning>0,reasoning),false);
            conversation=engine.createConversation(options);
        }
        List<Content> contents=new ArrayList<>();if(kind.equals("image"))contents.add(new Content.ImageBytes(media));if(kind.equals("audio"))contents.add(new Content.AudioBytes(media));contents.add(new Content.Text(prompt));
        StringBuilder answer=new StringBuilder();AtomicReference<Throwable> error=new AtomicReference<>();AtomicLong first=new AtomicLong(-1),lastEmit=new AtomicLong();CountDownLatch done=new CountDownLatch(1);
        conversation.sendMessageAsync(Contents.Companion.of(contents),new MessageCallback(){
            public void onMessage(com.google.ai.edge.litertlm.Message message){for(Content part:message.getContents().getContents())if(part instanceof Content.Text){
                String text=((Content.Text)part).getText();if(!text.isEmpty()){first.compareAndSet(-1,SystemClock.elapsedRealtimeNanos());answer.append(text);}
            }long now=SystemClock.elapsedRealtime();if(now-lastEmit.get()>60){lastEmit.set(now);emit(json("partial",answer.toString()));}}
            public void onDone(){done.countDown();}public void onError(Throwable failure){error.set(failure);done.countDown();}
        },Collections.emptyMap(),qwen?new RepetitionPenaltyConfig(1f,1.5f,0f,0):null);
        if(!done.await(180,TimeUnit.SECONDS)){conversation.cancelProcess();conversation.close();conversation=null;history=new JSONArray();turns=0;throw new IOException("Response timed out; conversation reset");}
        if(error.get()!=null){conversation.close();conversation=null;history=new JSONArray();turns=0;throw new IOException("LiteRT session reset: "+error.get());}
        if(stopping||cancellation.get()!=operationCancellation){conversation.close();conversation=null;history=new JSONArray();turns=0;throw new InterruptedIOException("Response cancelled; conversation reset");}
        return new JSONObject().put("text",answer.toString()).put("totalMs",NativeChatRuntime.elapsed(started)).put("modelMs",NativeChatRuntime.elapsed(started))
            .put("firstTokenMs",first.get()<0?-1:(first.get()-started)/1e6).put("prefixCache","Persistent LiteRT conversation; reused token count unavailable");
    }
    private void agentStep(JSONObject request)throws Exception {
        if(!loaded)throw new IOException("Load the selected model in tab 7 first");
        String prompt=request.getString("text");if(prompt.length()>24000)throw new IOException("Browser context too large");
        File file=inputFile(request.getString("file"));if(file.length()>20*1024*1024)throw new IOException("Screenshot too large");
        byte[] image=Files.readAllBytes(file.toPath());JSONObject result;
        if(engine==null)result=nativeRuntime.agent(prompt,image,selection.getInt("reasoning"),this::emit);
        else {
            Conversation chat=conversation;JSONArray savedHistory=history;int savedTurns=turns;conversation=null;
            try{result=liteChat(prompt,"image",image);}finally{if(conversation!=null)conversation.close();conversation=chat;history=savedHistory;turns=savedTurns;}
        }
        lastMetrics=result;emit(json("result",result));
    }
    private void checkCancelled()throws InterruptedIOException{if(stopping||cancellation.get()!=operationCancellation)throw new InterruptedIOException("Response cancelled");}
    private File modelFile(String name)throws IOException{File file=new File(getFilesDir(),"benchmark/"+name);if(!file.isFile())throw new IOException("Missing model: "+name);return file;}
    private File inputFile(String name)throws IOException{
        if(!name.matches("[a-zA-Z0-9-]+\\.(png|wav)"))throw new IOException("Invalid attachment");
        File file=new File(getCacheDir(),"chat-input/"+name);if(!file.isFile())throw new IOException("Attachment is unavailable");return file;
    }
    private JSONObject memory(){
        JSONObject result=new JSONObject();JSONArray rows=new JSONArray();long pss=0,rss=0;double cpu=0;boolean complete=true,cpuComplete=true;
        List<Integer> pids=new ArrayList<>();pids.add(android.os.Process.myPid());NativeChatRuntime nativeNow=nativeRuntime;if(nativeNow!=null){int[] children=nativeNow.pids();for(int pid:children)pids.add(pid);if(children.length<nativeNow.workerCount()){complete=false;cpuComplete=false;}}
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
    private void state(){try{emit(new JSONObject().put("state",true).put("loaded",loaded).put("busy",busy.get()).put("selection",selection).put("history",history).put("metrics",lastMetrics).put("turns",turns));}catch(JSONException ignored){}}
    private void emit(JSONObject value){try{value.put("type","chat").put("requestId",requestId).put("channel",channel);Messenger target=client;if(target!=null){android.os.Message message=android.os.Message.obtain(null,EVENT);Bundle bundle=new Bundle();bundle.putString("json",value.toString());message.setData(bundle);target.send(message);}}catch(Exception ignored){}}
    private static JSONObject json(String key,Object value){try{return new JSONObject().put(key,value);}catch(JSONException impossible){throw new IllegalArgumentException(impossible);}}
    private void closeModels(){loaded=false;if(nativeRuntime!=null){nativeRuntime.close();nativeRuntime=null;}if(conversation!=null){conversation.close();conversation=null;}if(engine!=null){try{if(engine.isInitialized())engine.close();}finally{engine=null;}}}
    private void unload(){
        if(stopping)return;stopping=true;loaded=false;
        if(nativeRuntime!=null)nativeRuntime.close();Conversation active=conversation;if(active!=null)active.cancelProcess();
        emit(json("unloaded",true));stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
        worker.execute(()->{try{closeModels();}finally{android.os.Process.killProcess(android.os.Process.myPid());}});
        new Handler(Looper.getMainLooper()).postDelayed(()->android.os.Process.killProcess(android.os.Process.myPid()),3000);
    }
    @Override public void onDestroy(){if(!stopping)unload();worker.shutdown();super.onDestroy();}
    @Override public void onTrimMemory(int level){super.onTrimMemory(level);if(level==TRIM_MEMORY_RUNNING_CRITICAL||level>=TRIM_MEMORY_MODERATE)unload();}
}
