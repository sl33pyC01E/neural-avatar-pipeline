package ai.cleo.ardyavatarvalidation;

import android.app.*;
import android.content.Intent;
import android.os.*;
import com.google.ai.edge.litertlm.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** User-run benchmark adapter. Separate process; no automatic startup or inference. */
public final class BenchmarkService extends Service {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile Conversation conversation;
    private Engine engine;
    private String modelName,backendName;
    private static final String CHANNEL="cleopatra-benchmark";

    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onCreate(){
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL,"User-started model benchmark",NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null)return START_NOT_STICKY;
        if("stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        PendingIntent stop=PendingIntent.getService(this,14,new Intent(this,BenchmarkService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE);
        startForeground(14,new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("Cleopatra model benchmark").setContentText("User-started; resident until stopped")
            .addAction(new Notification.Action.Builder(null,"Stop benchmark",stop).build()).build());
        String id=intent.getStringExtra("request");
        if(id==null||!id.matches("[a-zA-Z0-9-]{1,64}")){return START_NOT_STICKY;}
        if(!busy.compareAndSet(false,true)){write(id,new JSONObject(),"Another benchmark request is active");return START_NOT_STICKY;}
        worker.execute(()->{
            JSONObject result=new JSONObject();
            try {
                File request=new File(getCacheDir(),"benchmark-"+id+".request.json");
                if(request.length()>65536)throw new IOException("Request too large");
                JSONObject config=new JSONObject(new String(Files.readAllBytes(request.toPath()),java.nio.charset.StandardCharsets.UTF_8));
                long started=SystemClock.elapsedRealtimeNanos();
                switch(config.getString("action")){
                    case "load":
                        closeEngine();
                        modelName=config.getString("model");backendName=config.getString("backend");
                        File model=privateFile(modelName);
                        Backend backend;
                        if("cpu".equals(backendName))backend=new Backend.CPU(config.optInt("threads",2),null);
                        else if("gpu".equals(backendName))backend=new Backend.GPU();
                        else throw new IllegalArgumentException("Only CPU/GPU are qualified for this adapter");
                        Backend vision="gpu".equals(backendName)?new Backend.GPU():new Backend.CPU(2,null);
                        engine=new Engine(new EngineConfig(model.getPath(),backend,vision,new Backend.CPU(2,null),4096,1,getCacheDir().getPath()));
                        engine.initialize();result.put("loadMs",elapsed(started));break;
                    case "infer":
                        if(engine==null||!engine.isInitialized())throw new IllegalStateException("Load a model first");
                        result=infer(config);break;
                    case "unload":closeEngine();break;
                    default:throw new IllegalArgumentException("Unknown benchmark action");
                }
                result.put("model",modelName).put("backendRequested",backendName).put("runtime","LiteRT-LM 0.17.1")
                    .put("pid",android.os.Process.myPid()).put("elapsedRealtimeMs",SystemClock.elapsedRealtime())
                    .put("imageBudgetControl","fixed by LiteRT artifact; not exposed by this adapter");
                Debug.MemoryInfo memory=new Debug.MemoryInfo();Debug.getMemoryInfo(memory);
                result.put("endPssKb",memory.getTotalPss());
                write(id,result,null);
            }catch(Throwable failure){write(id,result,failure.toString());}
            finally{busy.set(false);}
        });
        return START_NOT_STICKY;
    }
    private JSONObject infer(JSONObject config)throws Exception {
        List<Content> contents=new ArrayList<>();
        if(config.has("image"))contents.add(new Content.ImageBytes(Files.readAllBytes(privateFile(config.getString("image")).toPath())));
        if(config.has("audio"))contents.add(new Content.AudioBytes(Files.readAllBytes(privateFile(config.getString("audio")).toPath())));
        contents.add(new Content.Text(config.getString("prompt")));
        int maximum=config.optInt("maxTokens",256);
        if(maximum<1||maximum>1024)throw new IllegalArgumentException("Invalid output limit");
        boolean thinking=config.optBoolean("thinking",false);
        int budget=config.optInt("reasoningBudget",0);
        if(budget<0||budget>512)throw new IllegalArgumentException("Invalid reasoning budget");
        ThinkingConfig thought=new ThinkingConfig(thinking,budget);
        ConversationConfig options=new ConversationConfig(null,Collections.emptyList(),Collections.emptyList(),
            new SamplerConfig(1,1.0,0.0,42),false,null,Collections.emptyMap(),null,false,maximum,thought,false);
        StringBuilder text=new StringBuilder();AtomicReference<Throwable> error=new AtomicReference<>();
        AtomicLong first=new AtomicLong(-1);CountDownLatch done=new CountDownLatch(1);
        long started=SystemClock.elapsedRealtimeNanos();
        try(Conversation active=engine.createConversation(options)){
            conversation=active;
            active.sendMessageAsync(Contents.Companion.of(contents),new MessageCallback(){
                public void onMessage(com.google.ai.edge.litertlm.Message message){
                    for(Content part:message.getContents().getContents())if(part instanceof Content.Text){
                        String value=((Content.Text)part).getText();
                        if(!value.isEmpty()){first.compareAndSet(-1,SystemClock.elapsedRealtimeNanos());text.append(value);}
                    }
                }
                public void onDone(){done.countDown();}
                public void onError(Throwable failure){error.set(failure);done.countDown();}
            });
            if(!done.await(180,TimeUnit.SECONDS)){active.cancelProcess();throw new IOException("Inference timed out");}
            if(error.get()!=null)throw new IOException("Inference failed",error.get());
        }finally{conversation=null;}
        return new JSONObject().put("text",text.toString()).put("inferMs",elapsed(started))
            .put("firstTokenMs",first.get()<0?JSONObject.NULL:(first.get()-started)/1e6)
            .put("thinking",thinking).put("reasoningBudget",budget).put("maxOutputTokens",maximum);
    }
    private File privateFile(String name)throws IOException {
        File root=new File(getFilesDir(),"benchmark").getCanonicalFile();
        File file=new File(root,name).getCanonicalFile();
        if(!file.getPath().startsWith(root.getPath()+File.separator)||!file.isFile())throw new IOException("Missing benchmark payload");
        return file;
    }
    private static double elapsed(long start){return (SystemClock.elapsedRealtimeNanos()-start)/1e6;}
    private void closeEngine(){if(engine!=null){engine.close();engine=null;}}
    private void write(String id,JSONObject value,String error){
        try{
            value.put("id",id).put("ok",error==null);if(error!=null)value.put("error",error);
            File output=new File(getCacheDir(),"benchmark-"+id+".json"),temp=new File(output+".partial");
            Files.write(temp.toPath(),value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));Files.move(temp.toPath(),output.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        }catch(Exception failure){android.util.Log.e("CleoBenchmark","Cannot save result",failure);}
    }
    @Override public void onDestroy(){
        Conversation active=conversation;if(active!=null)active.cancelProcess();
        worker.execute(()->{try{closeEngine();}finally{android.os.Process.killProcess(android.os.Process.myPid());}});
        worker.shutdown();super.onDestroy();
    }
}
