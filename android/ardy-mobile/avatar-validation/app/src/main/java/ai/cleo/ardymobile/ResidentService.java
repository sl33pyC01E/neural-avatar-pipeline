package ai.cleo.ardymobile;

import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Demand-driven resident engines. Queues block at idle; models stay warm until pressure or Stop. */
public final class ResidentService extends Service {
    public interface Listener { void event(JSONObject event); }
    public final class LocalBinder extends Binder { public ResidentService service(){return ResidentService.this;} }
    private final Handler main=new Handler(Looper.getMainLooper());
    private final LocalBinder binder=new LocalBinder();
    private final ExecutorService motionWorker=Executors.newSingleThreadExecutor();
    private final ExecutorService speechWorker=Executors.newSingleThreadExecutor();
    private final ExecutorService embeddingWorker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean motionBusy=new AtomicBoolean(),speechBusy=new AtomicBoolean(),embeddingBusy=new AtomicBoolean();
    private final AtomicBoolean cancelled=new AtomicBoolean();
    private volatile Listener listener;
    private volatile boolean visible,stopping,motionPaused;
    private volatile String profile="core40",embeddingId;
    private volatile long epoch;
    private volatile AudioTrack audio;
    private ArdySampler sampler;
    private String loadedProfile;
    private PocketAnna pocket;
    private LamDriver lam;
    private volatile long audioWritten;
    private Embeddings embeddings;
    private JSONObject heldMotion;

    @Override public void onCreate() {
        super.onCreate();
        embeddings=new Embeddings(this);pocket=new PocketAnna(this);lam=new LamDriver(this);
        NotificationManager notifications=getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel("resident","Cleopatra availability",NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null,null);notifications.createNotificationChannel(channel);
        Intent open=new Intent(this,ai.cleo.ardyavatarvalidation.MainActivity.class);
        PendingIntent content=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,ResidentService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE);
        startForeground(31,new Notification.Builder(this,"resident").setContentTitle("Cleopatra")
            .setContentText("Available · sleeps when idle").setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(content).addAction(new Notification.Action.Builder(null,"Stop",stop).build()).setOngoing(true).build());
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent!=null&&"stop".equals(intent.getAction())) { stopping=true;stopSpeech();emit("stopped","Cleopatra stopped");stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(); }
        return stopping?START_NOT_STICKY:START_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return binder;}
    public void attach(Listener listener) { this.listener=listener; }
    public void detach(Listener listener) { if(this.listener==listener)this.listener=null; }
    public void visible(boolean value) {
        visible=value;
        if(!value){stopSpeech();if(!stopping)motionWorker.execute(this::saveMotion);}
        else { emit("ready","Engines available"); }
    }
    public void state() {
        try {
            JSONObject status=new JSONObject().put("type","state").put("bank",embeddings.list())
                .put("llmNative",embeddings.nativeAvailable()).put("llmModel",embeddings.modelAvailable())
                .put("core8",modelsPresent("core8")).put("core40",modelsPresent("core40"))
                .put("lastProfile",getSharedPreferences("runtime",MODE_PRIVATE).getString("profile","core40"))
                .put("lastEmbedding",getSharedPreferences("runtime",MODE_PRIVATE).getString("embedding",""))
                .put("backend","CPU").put("memoryBudgetMiB",budgetMiB());
            publish(status);
        } catch(Exception error){error(error);}
    }
    private boolean modelsPresent(String id) {
        File root=new File(getFilesDir(),"ardy-models/"+id+"-onnx");return new File(root,"denoiser.onnx").isFile()&&new File(root,"decoder.onnx").isFile();
    }
    public synchronized void configureMotion(String profile,String embeddingId) {
        if(!"core8".equals(profile)&&!"core40".equals(profile)){error(new IllegalArgumentException("Unknown Ardy profile"));return;}
        boolean newRun=this.embeddingId==null||!this.profile.equals(profile);
        this.profile=profile;this.embeddingId=embeddingId;motionPaused=false;
        getSharedPreferences("runtime",MODE_PRIVATE).edit().putString("profile",profile).putString("embedding",embeddingId).apply();
        if(newRun){epoch++;heldMotion=null;}
        emit("configured","Motion ready");
    }
    public synchronized void stopMotion() { embeddingId=null;epoch++;heldMotion=null; }
    public void pauseMotion(){motionPaused=true;motionWorker.execute(this::saveMotion);}
    public synchronized boolean nextMotion() {
        if(stopping||!visible||motionPaused||embeddingId==null||embeddingBusy.get())return false;
        if(heldMotion!=null) { JSONObject held=heldMotion;heldMotion=null;publish(held);return true; }
        if(!motionBusy.compareAndSet(false,true))return false;
        final long requestedEpoch=epoch;final String requestedProfile=profile,requestedEmbedding=embeddingId;
        motionWorker.execute(()->{
            try {
                if(!visible||stopping)return;
                if(sampler==null||!requestedProfile.equals(loadedProfile)) {
                    if(sampler!=null){saveMotion();sampler.close();}
                    sampler=new ArdySampler(this,requestedProfile);loadedProfile=requestedProfile;
                    try{sampler.restore(checkpoint());}catch(IOException failure){emit("stateWarning","Saved motion context was unreadable; starting fresh");}
                }
                // A new sampler restores durable history; pause/resume keeps its live history.
                ArdySampler.Settings settings=new ArdySampler.Settings();settings.constrainRoot=false;
                ArdySampler.Batch result=sampler.next(embeddings.load(requestedEmbedding),settings);
                JSONObject message=new JSONObject().put("type","motion").put("startFrame",result.startFrame).put("frames",result.frames)
                    .put("jointCount",result.jointCount).put("fps",result.fps).put("joints",new JSONArray(result.joints))
                    .put("roots",new JSONArray(result.roots)).put("rotations",new JSONArray(result.rotations)).put("generationMs",result.elapsedMs);
                synchronized(this) {
                    if(epoch==requestedEpoch&&!stopping) {
                        if(!visible||listener==null)heldMotion=message;else publish(message);
                    }
                }
            }catch(Exception failure){emit("motionError",failure.getMessage()==null?failure.toString():failure.getMessage());}
            finally{motionBusy.set(false);emit("ready","");trimIfOverBudget();}
        });
        return true;
    }
    public void createEmbedding(String text) {
        if(stopping||!visible||!embeddingBusy.compareAndSet(false,true))return;
        embeddingWorker.execute(()->{
            try {
                // The 4.6 GB GGUF is the largest demand. Give it room before inference.
                releaseWarmSessions();
                JSONObject value=embeddings.create(text);publish(new JSONObject().put("type","embedding").put("record",value));state();
            }catch(Exception failure){error(failure);}
            finally{embeddingBusy.set(false);emit("ready","");trimIfOverBudget();}
        });
    }
    public void speak(String text) {
        if(stopping||!visible||!speechBusy.compareAndSet(false,true))return;
        cancelled.set(false);
        speechWorker.execute(()->{
            try {
                if(cancelled.get())return;
                if(text==null||text.trim().isEmpty())throw new IllegalArgumentException("Enter something for Anna to say");
                audioWritten=0;emit("speechStart","Anna is preparing speech…");
                lam.warm();lam.reset();if(cancelled.get())return;
                final long[] written={0};
                pocket.synthesize(text,cancelled,(samples,rate)->{
                    if(cancelled.get())return;
                    for(int start=0;start<samples.length;start+=24000) {
                        if(cancelled.get())return;
                        float[] chunk=java.util.Arrays.copyOfRange(samples,start,Math.min(samples.length,start+24000));
                        publish(lam.next(chunk,rate));
                    AudioTrack track=audio;
                    if(track==null) {
                        int bytes=Math.max(rate/2*4,AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_FLOAT));
                        track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                            .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                            .setBufferSizeInBytes(bytes).setTransferMode(AudioTrack.MODE_STREAM).build();
                        audio=track;track.play();emit("speech","Anna is speaking");
                    }
                    int offset=0;
                    while(offset<chunk.length&&!cancelled.get()) {
                        int count=track.write(chunk,offset,Math.min(2048,chunk.length-offset),AudioTrack.WRITE_NON_BLOCKING);
                        if(count<0)throw new IOException("Audio playback write failed: "+count);
                        if(count==0){Thread.sleep(5);continue;}
                        offset+=count;written[0]+=count;audioWritten=written[0];
                    }
                    }
                });
                AudioTrack track=audio;
                if(track!=null&&!cancelled.get()) {
                    // Only waits during actual playback. The playback head is also the future LAM clock.
                    long remaining=Math.max(0,written[0]-Integer.toUnsignedLong(track.getPlaybackHeadPosition()));
                    long deadline=SystemClock.elapsedRealtime()+remaining*1000/track.getSampleRate()+2000;
                    while(!cancelled.get()&&Integer.toUnsignedLong(track.getPlaybackHeadPosition())<written[0]&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(20);
                }
            }catch(Exception failure){if(!cancelled.get())error(failure);}
            finally {
                AudioTrack track=audio;audio=null;if(track!=null){try{track.stop();}catch(IllegalStateException ignored){}track.release();}
                speechBusy.set(false);emit("speechEnd",cancelled.get()?"Speech stopped":"Anna ready");trimIfOverBudget();
            }
        });
    }
    public void stopSpeech() {
        cancelled.set(true);AudioTrack track=audio;
        if(track!=null)try{track.pause();track.flush();}catch(IllegalStateException ignored){}
    }
    public double playbackSeconds() {
        AudioTrack track=audio;if(track==null)return -1;
        try {
            if(track.getPlayState()!=AudioTrack.PLAYSTATE_PLAYING)return -1;
            AudioTimestamp timestamp=new AudioTimestamp();double frames;
            if(track.getTimestamp(timestamp))frames=timestamp.framePosition+Math.max(0,System.nanoTime()-timestamp.nanoTime)*track.getSampleRate()/1e9;
            else frames=Integer.toUnsignedLong(track.getPlaybackHeadPosition());
            return Math.min(audioWritten,Math.max(0,frames))/track.getSampleRate();
        }catch(IllegalStateException ignored){return -1;}
    }
    public void importModels(Uri[] uris) {
        if(stopping||!embeddingBusy.compareAndSet(false,true))return;
        embeddingWorker.execute(()->{
            try{for(Uri uri:uris){if(stopping)break;emit("import","Copying and verifying model…");String name=ModelImporter.copy(this,uri);emit("import","Imported "+name);}state();}
            catch(Exception failure){error(failure);}finally{embeddingBusy.set(false);emit("ready","");}
        });
    }
    public void memoryBudget(int mib) { getSharedPreferences("runtime",MODE_PRIVATE).edit().putInt("memoryBudgetMiB",Math.max(2048,Math.min(10240,mib))).apply();trimIfOverBudget(); }
    private int budgetMiB(){return getSharedPreferences("runtime",MODE_PRIVATE).getInt("memoryBudgetMiB",6144);}
    private File checkpoint(){return new File(getFilesDir(),"ardy-state/"+loadedProfile+".bin");}
    private void saveMotion(){if(sampler!=null)try{sampler.save(checkpoint());}catch(IOException failure){emit("stateWarning","Could not save motion context");}}
    private void trimIfOverBudget(){if(Debug.getPss()/1024>budgetMiB())trim();}
    private void trim(){if(stopping)return;motionWorker.execute(()->{if(sampler!=null)sampler.close();});speechWorker.execute(()->{pocket.close();lam.close();});}
    private void releaseWarmSessions() throws Exception {
        motionWorker.submit(()->{if(sampler!=null)sampler.close();}).get();
        speechWorker.submit(()->{pocket.close();lam.close();}).get();
    }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if(level==TRIM_MEMORY_UI_HIDDEN)visible(false);
        if((level>=TRIM_MEMORY_RUNNING_LOW&&level<=TRIM_MEMORY_RUNNING_CRITICAL)||level>=TRIM_MEMORY_MODERATE)trim();
    }
    @Override public void onLowMemory(){super.onLowMemory();trim();}
    private void error(Exception error){emit("error",error.getMessage()==null?error.toString():error.getMessage());}
    private void emit(String type,String message){try{publish(new JSONObject().put("type",type).put("message",message));}catch(JSONException ignored){}}
    private void publish(JSONObject message){main.post(()->{Listener current=listener;if(current!=null)current.event(message);});}
    @Override public void onDestroy() {
        stopping=true;stopMotion();stopSpeech();
        motionWorker.execute(()->{if(sampler!=null){saveMotion();sampler.close();}});speechWorker.execute(()->{pocket.close();lam.close();});
        motionWorker.shutdown();speechWorker.shutdown();embeddingWorker.shutdownNow();listener=null;super.onDestroy();
    }
}
