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
    private final AtomicLong warmEpoch=new AtomicLong();
    private final AtomicBoolean cancelled=new AtomicBoolean();
    private volatile Listener listener;
    private volatile boolean visible,stopping,motionPaused;
    private volatile String profile="core40",embeddingId,streamId;
    private volatile long epoch;
    private volatile AudioTrack audio;
    private ArdySampler sampler;
    private String loadedProfile;
    private volatile boolean motionPerformance;
    private boolean samplerPerformance;
    private String performanceMotionStream;
    private PocketAnna pocket;
    private LamDriver lam;
    private final LamTimelineCache faceCache=new LamTimelineCache();
    private volatile CountDownLatch faceReady;
    private volatile String faceRun;
    private volatile String activeTab="launch",mainFrame="face";
    private volatile long audioWritten;
    private long audioStartNanos;
    private volatile long talkRequestedNanos;
    private Embeddings embeddings;
    private JSONObject heldMotion;
    private boolean benchmarkTracing;
    public synchronized void benchmarkTrace(boolean enabled){
        if(enabled&&!benchmarkTracing)try(FileOutputStream out=new FileOutputStream(new File(getCacheDir(),"benchmark-load.jsonl"))){out.flush();}catch(IOException ignored){}
        if(enabled)benchmarkTracing=true;
        try{traceBenchmark(new JSONObject().put("type",enabled?"traceStart":"traceStop"));}catch(JSONException ignored){}
        benchmarkTracing=enabled;
    }
    public void benchmarkFrame(String metrics){try{JSONObject value=new JSONObject(metrics);value.put("type","renderMetrics");traceBenchmark(value);}catch(JSONException ignored){}}
    private synchronized void traceBenchmark(JSONObject event){
        if(!benchmarkTracing)return;
        String type=event.optString("type");
        if(!java.util.Arrays.asList("traceStart","traceStop","speechStart","speechEnd","talkPlayback","talkMetrics","motion","motionError","face","renderMetrics").contains(type))return;
        try{
            JSONObject line=new JSONObject().put("type",type).put("elapsedRealtimeMs",SystemClock.elapsedRealtime())
                .put("tab",activeTab).put("visible",visible).put("profile",profile).put("embedding",embeddingId)
                .put("pocketWarm",pocket!=null&&pocket.isWarm()).put("lamWarm",lam!=null&&lam.isWarm()).put("ardyResident",sampler!=null)
                .put("speechBusy",speechBusy.get()).put("motionBusy",motionBusy.get());
            for(String key:new String[]{"generationMs","playbackStartMs","underruns","lamComputeMs","audioSeconds","totalMs","displayFps","cpuFrameP95Ms","completed"})
                if(event.has(key))line.put(key,event.get(key));
            File file=new File(getCacheDir(),"benchmark-load.jsonl");
            if(file.length()>2*1024*1024){benchmarkTracing=false;return;}
            try(FileOutputStream out=new FileOutputStream(file,true)){out.write((line+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        }catch(Exception ignored){}
    }

    @Override public void onCreate() {
        super.onCreate();
        embeddings=new Embeddings(this);pocket=new PocketAnna(this);
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
        if(intent!=null&&"stop".equals(intent.getAction())) { stopping=true;stopSpeech();startService(new Intent(this,ai.cleo.ardyavatarvalidation.ModelChatService.class).setAction("unload"));emit("stopped","Cleopatra stopped");stopForeground(STOP_FOREGROUND_REMOVE);stopSelf(); }
        return stopping?START_NOT_STICKY:START_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return binder;}
    public void attach(Listener listener) { this.listener=listener; }
    public void detach(Listener listener) { if(this.listener==listener)this.listener=null; }
    public void visible(boolean value) {
        visible=value;
        if(!value){cancelWarmAll();stopSpeech();if(!stopping)motionWorker.execute(this::saveMotion);}
        else { emit("ready","Engines available"); }
    }
    public void state() {
        try {
            JSONObject status=new JSONObject().put("type","state").put("bank",embeddings.list())
                .put("llmNative",embeddings.nativeAvailable()).put("llmModel",embeddings.modelAvailable())
                .put("core8",modelsPresent("core8")).put("core40",modelsPresent("core40"))
                .put("lastProfile",getSharedPreferences("runtime",MODE_PRIVATE).getString("profile","core40"))
                .put("lastEmbedding",getSharedPreferences("runtime",MODE_PRIVATE).getString("embedding",""))
                .put("pocketStage",getSharedPreferences("runtime",MODE_PRIVATE).getString("pocketStage","Ready for your speech test"))
                .put("pocketClip",new File(getCacheDir(),"pocket-last.wav").isFile())
                .put("ardyWarm",sampler!=null&&sampler.isWarm()).put("warmProfile",loadedProfile)
                .put("pocketWarm",pocket!=null&&pocket.isWarm()).put("lamWarm",lam!=null&&lam.isWarm())
                .put("backend","CPU").put("memoryBudgetMiB",budgetMiB());
            publish(status);
        } catch(Exception error){error(error);}
    }
    private static boolean performanceTab(String tab){return "full".equals(tab)||"cleopatra".equals(tab)||"main".equals(tab);}
    public void cancelWarmAll(){warmEpoch.incrementAndGet();}
    private void warmCheck(long ticket)throws InterruptedIOException {
        if(stopping||!visible||!("cleopatra".equals(activeTab)||"main".equals(activeTab))||warmEpoch.get()!=ticket)throw new InterruptedIOException("Model preparation stopped");
    }
    private void ensemble(String request,String component,String state,String message){
        try{publish(new JSONObject().put("type","ensemble").put("requestId",request).put("component",component).put("state",state).put("message",message));}catch(JSONException ignored){}
    }
    /** Opens model sessions only. No body generation, speech or face inference. */
    public synchronized void prepareModelLoad(String request) {
        if(stopping||!visible||!("cleopatra".equals(activeTab)||"main".equals(activeTab)))return;
        if(request==null||!request.matches("[a-zA-Z0-9-]{1,80}"))return;
        if(speechBusy.get()||motionBusy.get()||!embeddingBusy.compareAndSet(false,true)){
            ensemble(request,"release","error","An avatar operation is already running");return;
        }
        final long ticket=warmEpoch.incrementAndGet();
        embeddingWorker.execute(()->{
            String state="ready",message="Avatar sessions released for Gemma initialization";
            try{warmCheck(ticket);releaseWarmSessions();warmCheck(ticket);}
            catch(Exception failure){state="error";message="Could not prepare memory for Gemma: "+failure.getMessage();}
            finally{embeddingBusy.set(false);}
            // Acknowledge after both worker queues have actually closed their sessions.
            ensemble(request,"release",state,message);
        });
    }
    public synchronized void warmAll(String requestedProfile,int threads,String precision,String request) {
        if(stopping||!visible||!("cleopatra".equals(activeTab)||"main".equals(activeTab)))return;
        if(request==null||!request.matches("[a-zA-Z0-9-]{1,80}"))return;
        if(!java.util.Set.of("core8","core40").contains(requestedProfile)||!java.util.Set.of(1,2,4,6).contains(threads)||!java.util.Set.of("mixed","fp32","int8").contains(precision)){
            ensemble(request,"all","error","Invalid runtime settings");return;
        }
        if(speechBusy.get()||motionBusy.get()||!embeddingBusy.compareAndSet(false,true)){
            ensemble(request,"all","error","An avatar operation is already running");return;
        }
        final long ticket=warmEpoch.incrementAndGet();
        embeddingWorker.execute(()->{
            String component="ardy";
            try {
                warmCheck(ticket);ensemble(request,component,"loading","Loading live Ardy "+requestedProfile);
                motionWorker.submit(()->{
                    warmCheck(ticket);
                    if(sampler==null||!requestedProfile.equals(loadedProfile)||!samplerPerformance){
                        if(sampler!=null){saveMotion();sampler.close();}
                        sampler=new ArdySampler(this,requestedProfile);loadedProfile=requestedProfile;samplerPerformance=true;performanceMotionStream=null;
                    }
                    sampler.warm();return null;
                }).get();
                warmCheck(ticket);ensemble(request,component,"ready","Live Ardy "+requestedProfile+" resident");
                component="pocket";ensemble(request,component,"loading","Loading PocketTTS and Anna");
                speechWorker.submit(()->{warmCheck(ticket);pocket.warm(threads,precision);return null;}).get();
                warmCheck(ticket);ensemble(request,component,"ready","PocketTTS / Anna resident");
                component="lam";ensemble(request,component,"loading","Loading LAM");
                speechWorker.submit(()->{warmCheck(ticket);if(lam==null)lam=new LamDriver(this);lam.warm();return null;}).get();
                warmCheck(ticket);ensemble(request,component,"ready","LAM resident");
                ensemble(request,"all","ready","Avatar engines resident");
            }catch(Exception failure){
                Throwable cause=failure instanceof ExecutionException?failure.getCause():failure;
                ensemble(request,component,"error",cause.getMessage()==null?cause.toString():cause.getMessage());
                ensemble(request,"all","error","Model preparation incomplete");
            }finally{embeddingBusy.set(false);state();emit("ready","");}
        });
    }
    public void unloadAvatarModels(){cancelWarmAll();stopSpeech();pauseMotion();trim();emit("ensembleReleased","Avatar models unloaded");}
    private boolean modelsPresent(String id) {
        File root=new File(getFilesDir(),"ardy-models/"+id+"-onnx");return new File(root,"denoiser.onnx").isFile()&&new File(root,"decoder.onnx").isFile();
    }
    public synchronized void tab(String value) {
        if(stopping)return;
        if(!java.util.Set.of("launch","main","welcome","avatar","pocket","face","talk","full","chat","browser","cleopatra").contains(value))return;
        if(activeTab.equals(value))return;
        activeTab=value;cancelWarmAll();stopSpeech();pauseMotion();
        // Resident mode keeps sessions across navigation; LAM loads only on explicit demand.
        if(!resident()&&!"avatar".equals(value)&&!performanceTab(value))motionWorker.execute(()->{if(sampler!=null){saveMotion();sampler.close();}});
        // Pocket and LAM can remain resident together; tab switches never run inference.
        // In nonresident mode, pressure/budget trims release sessions on their workers.
        trimIfOverBudget();
    }
    public synchronized void configureMotion(String profile,String embeddingId,String streamId) {
        configureMotion(profile,embeddingId,streamId,false);
    }
    public synchronized void configurePerformanceMotion(String profile,String embeddingId,String streamId) {
        if(!performanceTab(activeTab)||("main".equals(activeTab)&&mainFrame.equals("face")))return;
        configureMotion(profile,embeddingId,streamId,true);
    }
    private void configureMotion(String profile,String embeddingId,String streamId,boolean performance) {
        if((!"avatar".equals(activeTab)&&!performanceTab(activeTab))||stopping||("main".equals(activeTab)&&mainFrame.equals("face")))return;
        if(!"core8".equals(profile)&&!"core40".equals(profile)){error(new IllegalArgumentException("Unknown Ardy profile"));return;}
        if(streamId==null||streamId.isEmpty()||streamId.length()>128){error(new IllegalArgumentException("Invalid motion stream"));return;}
        boolean newRun=this.embeddingId==null||!this.profile.equals(profile)||!streamId.equals(this.streamId)||motionPerformance!=performance;
        this.profile=profile;this.embeddingId=embeddingId;this.streamId=streamId;motionPaused=false;motionPerformance=performance;
        getSharedPreferences("runtime",MODE_PRIVATE).edit().putString("profile",profile).putString("embedding",embeddingId).apply();
        if(newRun){epoch++;heldMotion=null;}
        emit("configured","Motion ready");
    }
    public synchronized void stopMotion() { embeddingId=null;epoch++;heldMotion=null; }
    public void pauseMotion(){motionPaused=true;if(!stopping)motionWorker.execute(this::saveMotion);}
    public synchronized boolean nextMotion() {
        if(stopping||!visible||("main".equals(activeTab)&&mainFrame.equals("face"))||(!"avatar".equals(activeTab)&&!performanceTab(activeTab))||motionPaused||embeddingId==null||embeddingBusy.get())return false;
        if(heldMotion!=null) { JSONObject held=heldMotion;heldMotion=null;publish(held);return true; }
        if(!motionBusy.compareAndSet(false,true))return false;
        final long requestedEpoch=epoch;final String requestedProfile=profile,requestedEmbedding=embeddingId,requestedStream=streamId;
        final boolean requestedPerformance=motionPerformance,lockedRoot="main".equals(activeTab)&&mainFrame.equals("torso");
        motionWorker.execute(()->{
            try {
                if(!visible||stopping||epoch!=requestedEpoch)return;
                if(sampler==null||!requestedProfile.equals(loadedProfile)||samplerPerformance!=requestedPerformance) {
                    if(sampler!=null){saveMotion();sampler.close();}
                    sampler=new ArdySampler(this,requestedProfile);loadedProfile=requestedProfile;samplerPerformance=requestedPerformance;performanceMotionStream=null;
                    if(!requestedPerformance)try{sampler.restore(checkpoint());}catch(IOException failure){emit("stateWarning","Saved motion context was unreadable; starting fresh");}
                }
                if(requestedPerformance&&!requestedStream.equals(performanceMotionStream)){sampler.reset(42);performanceMotionStream=requestedStream;}
                // A new sampler restores durable history; pause/resume keeps its live history.
                ArdySampler.Settings settings=new ArdySampler.Settings();settings.constrainRoot=lockedRoot;settings.lockRoot=lockedRoot;
                ArdySampler.Batch result=sampler.next(embeddings.load(requestedEmbedding),settings);
                JSONObject message=new JSONObject().put("type","motion").put("streamId",requestedStream).put("profile",requestedProfile).put("startFrame",result.startFrame).put("frames",result.frames)
                    .put("jointCount",result.jointCount).put("fps",result.fps).put("joints",new JSONArray(result.joints))
                    .put("roots",new JSONArray(result.roots)).put("rotations",new JSONArray(result.rotations)).put("generationMs",result.elapsedMs);
                synchronized(this) {
                    if(epoch==requestedEpoch&&!stopping) {
                        if(!visible||listener==null)heldMotion=message;else publish(message);
                    }
                }
            }catch(Exception failure){
                try{publish(new JSONObject().put("type","motionError").put("streamId",requestedStream)
                    .put("message",failure.getMessage()==null?failure.toString():failure.getMessage()));}catch(JSONException ignored){}
            }
            finally{motionBusy.set(false);emit("ready","");trimIfOverBudget();}
        });
        return true;
    }
    public synchronized void createEmbedding(String text) {
        if(stopping||!visible||!"avatar".equals(activeTab)||!embeddingBusy.compareAndSet(false,true))return;
        embeddingWorker.execute(()->{
            try {
                // The 4.6 GB GGUF is the largest demand. Give it room before inference.
                releaseWarmSessions();
                JSONObject value=embeddings.create(text);publish(new JSONObject().put("type","embedding").put("record",value));state();
            }catch(Exception failure){error(failure);}
            finally{embeddingBusy.set(false);emit("ready","");trimIfOverBudget();}
        });
    }
    public synchronized void speak(String text,int threads,int steps,int chunkSize,String precision,boolean buffered) {
        if(stopping||!visible||!"pocket".equals(activeTab))return;
        if(embeddingBusy.get()){emit("speechBusy","Wait for the embedding or model import to finish");return;}
        if(!speechBusy.compareAndSet(false,true)){emit("speechBusy","Anna is already speaking or preparing speech");return;}
        cancelled.set(false);
        speechWorker.execute(()->{
            String outcome="Anna ready";
            long requested=System.nanoTime();
            try(PocketRecording recording=new PocketRecording(new File(getCacheDir(),"pocket-last.wav"))) {
                if(cancelled.get())return;
                if(text==null||text.trim().isEmpty())throw new IllegalArgumentException("Enter something for Anna to say");
                audioWritten=0;audioStartNanos=0;emit("speechStart","Preparing PocketTTS only…");
                // Finish releasing motion work before beginning the isolated speech run.
                if(!resident())motionWorker.submit(()->{if(sampler!=null)sampler.close();}).get();
                if(cancelled.get())return;
                PocketRecording.Sink playback=this::playSamples;
                JSONObject metrics=pocket.synthesize(text,threads,steps,chunkSize,precision,buffered,cancelled,this::pocketStage,(samples,rate)->{
                    recording.append(samples,rate);
                    if(!buffered)playback.accept(samples,rate);
                });
                if(cancelled.get()||metrics==null)return;
                recording.finish();
                if(buffered){pocketStage("Speech prepared · playing Anna");recording.play(cancelled,playback);}
                AudioTrack track=audio;
                int underruns=track==null?0:track.getUnderrunCount(); // Before the intentional final drain.
                if(track!=null&&!cancelled.get()) {
                    // Only waits during actual playback; no idle polling or wake lock.
                    long remaining=Math.max(0,audioWritten-Integer.toUnsignedLong(track.getPlaybackHeadPosition()));
                    long deadline=SystemClock.elapsedRealtime()+remaining*1000/track.getSampleRate()+2000;
                    while(!cancelled.get()&&Integer.toUnsignedLong(track.getPlaybackHeadPosition())<audioWritten&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(20);
                }
                metrics.put("playbackMode",buffered?"buffered":"streaming").put("underruns",underruns)
                    .put("playbackStartMs",audioStartNanos==0?-1:(audioStartNanos-requested)/1e6).put("cancelled",cancelled.get());
                try(FileOutputStream report=new FileOutputStream(new File(getCacheDir(),"pocket-last.json"))){report.write(metrics.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                publish(metrics);
            }catch(Exception|LinkageError failure){outcome="Pocket error: "+(failure.getMessage()==null?failure.toString():failure.getMessage());}
            finally {
                AudioTrack track=audio;audio=null;if(track!=null){try{track.stop();}catch(IllegalStateException ignored){}track.release();}
                speechBusy.set(false);String message=cancelled.get()?"Speech stopped":outcome;pocketStage(message);emit("speechEnd",message);trimIfOverBudget();
            }
        });
    }
    public synchronized void speakWithFace(String text,int threads,int steps,int chunkSize,String precision,boolean buffered,double cueSeconds,double tailSeconds) {
        if(stopping||!visible||(!"talk".equals(activeTab)&&!performanceTab(activeTab)))return;
        boolean full=performanceTab(activeTab)&&!("main".equals(activeTab)&&mainFrame.equals("face"));
        if(full&&(!Double.isFinite(cueSeconds)||cueSeconds<0||cueSeconds>3||!Double.isFinite(tailSeconds)||tailSeconds<.5||tailSeconds>3)){
            emit("talkRejected","Choose a speech cue from 0–3 s and a motion tail from 0.5–3 s");return;
        }
        final int leadSamples=full?(int)Math.round(cueSeconds*24000):0,tailSamples=full?(int)Math.round(tailSeconds*24000):0;
        final double cue=leadSamples/24000.0,tail=tailSamples/24000.0;
        if(embeddingBusy.get()||!speechBusy.compareAndSet(false,true)){emit("talkRejected","Wait for the current engine task to finish");return;}
        cancelled.set(false);talkRequestedNanos=System.nanoTime();
        final long requested=talkRequestedNanos;final String stream=java.util.UUID.randomUUID().toString(),tab=activeTab;
        speechWorker.execute(()->{
            String outcome="Ready";boolean failed=false,clipReady=false;
            try(PocketRecording recording=new PocketRecording(new File(getCacheDir(),"pocket-last.wav"))) {
                if(cancelled.get())return;
                PocketPrompt.prepare(text);
                audioWritten=0;audioStartNanos=0;
                publish(new JSONObject().put("type","speechStart").put("tab",tab).put("withFace",true).put("streamId",stream)
                    .put("cueSeconds",cue).put("tailSeconds",tail).put("bodyMotion",full).put("message",full?"Preparing a scheduled take…":"Preparing Anna and LAM…"));
                if(!resident()&&!performanceTab(tab))motionWorker.submit(()->{if(sampler!=null)sampler.close();}).get();
                if(cancelled.get())return;
                if(lam==null)lam=new LamDriver(this);
                final boolean lamWarm=lam.isWarm();final long pipelineStarted=System.nanoTime();
                final AtomicLong spokenSamples=new AtomicLong(),gateNanos=new AtomicLong();
                try(SpeechFacePipeline pipe=new SpeechFacePipeline(cancelled,()->{lam.warm();lam.reset();},lam::next,(pcm,face)->{
                    if(cancelled.get())return;
                    face.put("prepared",true).put("withFace",true).put("tab",tab).put("streamId",stream);
                    if(full)face.put("requiredMotionSeconds",cue+(spokenSamples.get()+pcm.length)/24000.0);
                    long gate=System.nanoTime();awaitRenderer(face,full);gateNanos.addAndGet(System.nanoTime()-gate);
                    if(cancelled.get())return;
                    if(full&&spokenSamples.get()==0&&leadSamples>0)playSamples(new float[leadSamples],24000);
                    playSamples(pcm,24000);spokenSamples.addAndGet(pcm.length);
                })) {
                    JSONObject speech=pocket.synthesize(text,threads,steps,chunkSize,precision,buffered,cancelled,message->emit("talkStage",message),(pcm,rate)->{
                        recording.append(pcm,rate);pipe.accept(pcm,rate);
                    });
                    // finish propagates worker failures, including a failed renderer acknowledgement.
                    if(speech!=null&&!cancelled.get()){recording.finish();clipReady=true;}
                    pipe.finish();
                    if(cancelled.get()||speech==null)return;
                    if(full){
                        JSONObject ending=new JSONObject().put("type","performanceTail").put("tab",tab).put("withFace",true).put("streamId",stream)
                            .put("audioSeconds",spokenSamples.get()/24000.0).put("requiredMotionSeconds",cue+spokenSamples.get()/24000.0+tail);
                        long gate=System.nanoTime();awaitRenderer(ending,true);gateNanos.addAndGet(System.nanoTime()-gate);
                        if(!cancelled.get())playSamples(new float[tailSamples],24000);
                    }
                    AudioTrack track=audio;int underruns=track==null?0:track.getUnderrunCount();
                    drainAudio();
                    JSONObject metrics=pipe.metrics().put("type","talkMetrics").put("tab",tab)
                        .put("lamWarm",lamWarm).put("pocket",speech).put("playbackMode",buffered?"buffered":"streaming")
                        .put("playbackStartMs",audioStartNanos==0?-1:(audioStartNanos-requested)/1e6)
                        .put("speechStartMs",audioStartNanos==0?-1:(audioStartNanos-requested)/1e6+cue*1000).put("audioSeconds",speech.getDouble("audioSeconds")).put("underruns",underruns).put("cancelled",cancelled.get())
                        .put("totalMs",(System.nanoTime()-requested)/1e6);
                    metrics.put("firstFaceMs",metrics.getDouble("firstFaceMs")+(pipelineStarted-requested)/1e6);
                    if(full)metrics.put("ardyProfile",profile).put("embeddingId",embeddingId).put("cueSeconds",cue).put("tailSeconds",tail)
                        .put("motionGateWaitMs",gateNanos.get()/1e6).put("speechStartMs",metrics.getDouble("playbackStartMs")+cue*1000)
                        .put("trackSeconds",audioWritten/24000.0);
                    speech.put("source",tab).put("playbackMode",buffered?"buffered":"streaming")
                        .put("playbackStartMs",metrics.getDouble("playbackStartMs")).put("underruns",underruns).put("cancelled",cancelled.get());
                    saveReport("pocket-last.json",speech);saveReport(tab+"-last.json",metrics);publish(metrics);
                }
            }catch(Exception|LinkageError failure){failed=true;outcome="Pipeline error: "+(failure.getMessage()==null?failure.toString():failure.getMessage());}
            finally {
                faceReady=null;faceRun=null;
                AudioTrack track=audio;audio=null;if(track!=null){try{track.stop();}catch(IllegalStateException ignored){}track.release();}
                speechBusy.set(false);
                if(performanceTab(tab))pauseMotion();
                try{publish(new JSONObject().put("type","speechEnd").put("tab",tab).put("withFace",true).put("streamId",stream)
                    .put("completed",!failed&&!cancelled.get()).put("clipReady",clipReady).put("message",!failed&&cancelled.get()?"Stopped":outcome));}catch(JSONException ignored){}
                trimIfOverBudget();
            }
        });
    }
    private void awaitRenderer(JSONObject message,boolean performance) throws Exception {
        String ack=java.util.UUID.randomUUID().toString();CountDownLatch ready=new CountDownLatch(1);faceRun=ack;faceReady=ready;
        publish(message.put("runId",ack));
        long deadline=SystemClock.elapsedRealtime()+(performance?60000:10000);
        while(!cancelled.get()&&!ready.await(50,TimeUnit.MILLISECONDS))
            if(SystemClock.elapsedRealtime()>deadline)throw new IOException(performance?"Motion did not prepare the scheduled window":"Avatar did not accept the facial window");
    }
    private void saveReport(String name,JSONObject value) throws Exception {
        try(FileOutputStream out=new FileOutputStream(new File(getCacheDir(),name))){out.write(value.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    }
    private void drainAudio() throws Exception {
        AudioTrack track=audio;if(track==null||cancelled.get())return;
        long remaining=Math.max(0,audioWritten-Integer.toUnsignedLong(track.getPlaybackHeadPosition()));
        long deadline=SystemClock.elapsedRealtime()+remaining*1000/track.getSampleRate()+2000;
        while(!cancelled.get()&&Integer.toUnsignedLong(track.getPlaybackHeadPosition())<audioWritten&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(20);
    }
    private void playSamples(float[] samples,int rate) throws Exception {
        if(cancelled.get())return;
        AudioTrack track=audio;boolean starting=track==null;
        if(starting) {
            int bytes=Math.max(rate/2*4,AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_FLOAT));
            track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(bytes).setTransferMode(AudioTrack.MODE_STREAM).build();
            if(track.getState()!=AudioTrack.STATE_INITIALIZED){track.release();throw new IOException("Audio output did not initialize");}
            audio=track;
        }
        int offset=0;
        while(offset<samples.length&&!cancelled.get()) {
            int count=track.write(samples,offset,starting?Math.min(track.getBufferSizeInFrames(),samples.length-offset):Math.min(2048,samples.length-offset),AudioTrack.WRITE_NON_BLOCKING);
            if(count<0)throw new IOException("Audio playback write failed: "+count);
            offset+=count;audioWritten+=count;
            // Prime the track before starting to avoid an initial empty-buffer underrun.
            if(starting&&count>0){synchronized(this){if(!cancelled.get()){
                track.play();audioStartNanos=System.nanoTime();starting=false;
                if("talk".equals(activeTab)||performanceTab(activeTab))publish(new JSONObject().put("type","talkPlayback").put("tab",activeTab).put("playbackStartMs",(audioStartNanos-talkRequestedNanos)/1e6));
                else if("face".equals(activeTab))emit("faceStage","Playing Anna with LAM");else pocketStage("Anna is speaking");
            }}}
            if(count==0){if(starting)throw new IOException("Audio output accepted no initial samples");Thread.sleep(5);}
        }
    }
    private void pocketStage(String message) {
        getSharedPreferences("runtime",MODE_PRIVATE).edit().putString("pocketStage",message).apply();
        emit("pocketStage",message);
    }
    public synchronized void animateLastClip() {
        if(stopping||!visible||!"face".equals(activeTab))return;
        if(embeddingBusy.get()||!speechBusy.compareAndSet(false,true)){emit("faceStage","Wait for the current engine task to finish");return;}
        cancelled.set(false);
        speechWorker.execute(()->{
            String outcome="Face playback complete";
            try {
                publish(new JSONObject().put("type","speechStart").put("withFace",true).put("message","Preparing LAM from the last Anna clip…"));
                if(!resident())motionWorker.submit(()->{if(sampler!=null)sampler.close();}).get();
                if(cancelled.get())return;
                long started=System.nanoTime();
                float[] clip=PocketRecording.readCompleted(new File(getCacheDir(),"pocket-last.wav"));
                if(lam==null)lam=new LamDriver(this);
                boolean warm=lam.isWarm();
                byte[] key=LamTimelineCache.key(clip,lam.cacheIdentity());
                JSONObject timeline=faceCache.get(key);boolean cached=timeline!=null;
                double loadMs=0,computeMs=0;
                if(!cached) {
                    long loading=System.nanoTime();lam.warm();loadMs=(System.nanoTime()-loading)/1e6;
                    if(cancelled.get())return;
                    lam.reset();long computing=System.nanoTime();
                    timeline=LamTimeline.build(clip,cancelled,lam::next,message->emit("faceStage",message));
                    computeMs=(System.nanoTime()-computing)/1e6;
                    if(cancelled.get()||timeline==null)return;
                    faceCache.put(key,clip,timeline);
                }
                if(cancelled.get()||timeline==null)return;
                double prepareMs=(System.nanoTime()-started)/1e6;
                String run=java.util.UUID.randomUUID().toString();
                CountDownLatch ready=new CountDownLatch(1);faceRun=run;faceReady=ready;
                publish(timeline.put("runId",run));
                emit("faceStage",cached?"Reusing prepared face · waiting for avatar":"Face prepared · waiting for avatar");
                if(!ready.await(10,TimeUnit.SECONDS)&&!cancelled.get())throw new IOException("Avatar did not accept the facial timeline");
                if(cancelled.get())return;
                audioWritten=0;audioStartNanos=0;emit("faceStage","Playing Anna with LAM");
                for(int offset=0;offset<clip.length&&!cancelled.get();offset+=12000)
                    playSamples(java.util.Arrays.copyOfRange(clip,offset,Math.min(clip.length,offset+12000)),24000);
                AudioTrack track=audio;int underruns=track==null?0:track.getUnderrunCount();
                if(track!=null&&!cancelled.get()) {
                    long remaining=Math.max(0,audioWritten-Integer.toUnsignedLong(track.getPlaybackHeadPosition()));
                    long deadline=SystemClock.elapsedRealtime()+remaining*1000/24000+2000;
                    while(!cancelled.get()&&Integer.toUnsignedLong(track.getPlaybackHeadPosition())<audioWritten&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(20);
                }
                JSONObject metrics=new JSONObject().put("type","faceMetrics").put("prepareMs",prepareMs).put("frames",timeline.getJSONArray("frames").length())
                    .put("cached",cached).put("warm",warm).put("loadMs",loadMs).put("computeMs",computeMs)
                    .put("playbackStartMs",audioStartNanos==0?-1:(audioStartNanos-started)/1e6)
                    .put("audioSeconds",clip.length/24000.0).put("underruns",underruns).put("cancelled",cancelled.get());
                try(FileOutputStream report=new FileOutputStream(new File(getCacheDir(),"lam-last.json"))){report.write(metrics.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                publish(metrics);
            }catch(Exception|LinkageError failure){outcome="LAM error: "+(failure.getMessage()==null?failure.toString():failure.getMessage());}
            finally {
                faceReady=null;faceRun=null;
                AudioTrack track=audio;audio=null;if(track!=null){try{track.stop();}catch(IllegalStateException ignored){}track.release();}
                speechBusy.set(false);
                try{publish(new JSONObject().put("type","speechEnd").put("withFace",true).put("message",cancelled.get()?"Face playback stopped":outcome));}catch(JSONException ignored){}
                trimIfOverBudget();
            }
        });
    }
    public void faceReady(String run) { CountDownLatch ready=faceReady;if(ready!=null&&run!=null&&run.equals(faceRun))ready.countDown(); }
    public synchronized void stopSpeech() {
        cancelled.set(true);AudioTrack track=audio;
        CountDownLatch ready=faceReady;if(ready!=null)ready.countDown();
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
    public synchronized void importModels(Uri[] uris) {
        if(stopping||!embeddingBusy.compareAndSet(false,true))return;
        embeddingWorker.execute(()->{
            try{for(Uri uri:uris){if(stopping)break;emit("import","Copying and verifying model…");String name=ModelImporter.copy(this,uri);emit("import","Imported "+name);}state();}
            catch(Exception failure){error(failure);}finally{embeddingBusy.set(false);emit("ready","");}
        });
    }
    private boolean resident(){return getSharedPreferences("runtime",MODE_PRIVATE).getBoolean("resident",true);}
    public synchronized void mainFrame(String frame){
        if(!java.util.Set.of("face","torso","body").contains(frame)||!"main".equals(activeTab))return;
        if(!frame.equals(mainFrame)){stopSpeech();pauseMotion();stopMotion();mainFrame=frame;}
    }
    public void memoryBudget(int mib) { getSharedPreferences("runtime",MODE_PRIVATE).edit().putInt("memoryBudgetMiB",Math.max(2048,Math.min(10240,mib))).apply();trimIfOverBudget(); }
    private int budgetMiB(){return getSharedPreferences("runtime",MODE_PRIVATE).getInt("memoryBudgetMiB",6144);}
    private File checkpoint(){return new File(getFilesDir(),"ardy-state/"+loadedProfile+(samplerPerformance?"-performance":"")+".bin");}
    private void saveMotion(){if(sampler!=null)try{sampler.save(checkpoint());}catch(IOException failure){emit("stateWarning","Could not save motion context");}}
    private void trimIfOverBudget(){if(!resident()&&Debug.getPss()/1024>budgetMiB())trim();}
    private void trim(){if(stopping)return;cancelWarmAll();emit("ensembleReleased","Models released for memory pressure");motionWorker.execute(()->{if(sampler!=null)sampler.close();});speechWorker.execute(this::releaseSpeechSessions);}
    private void releaseSpeechSessions(){pocket.close();if(lam!=null)lam.close();faceCache.clear();}
    private void releaseWarmSessions() throws Exception {
        motionWorker.submit(()->{if(sampler!=null)sampler.close();}).get();
        speechWorker.submit(this::releaseSpeechSessions).get();
    }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if(level==TRIM_MEMORY_UI_HIDDEN)visible(false);
        if(!resident()&&((level>=TRIM_MEMORY_RUNNING_LOW&&level<=TRIM_MEMORY_RUNNING_CRITICAL)||level>=TRIM_MEMORY_MODERATE))trim();
    }
    @Override public void onLowMemory(){super.onLowMemory();if(!resident())trim();}
    private void error(Exception error){emit("error",error.getMessage()==null?error.toString():error.getMessage());}
    private void emit(String type,String message){try{publish(new JSONObject().put("type",type).put("message",message));}catch(JSONException ignored){}}
    private void publish(JSONObject message){traceBenchmark(message);main.post(()->{Listener current=listener;if(current!=null)current.event(message);});}
    @Override public void onDestroy() {
        stopping=true;stopMotion();stopSpeech();
        motionWorker.execute(()->{if(sampler!=null){saveMotion();sampler.close();}});speechWorker.execute(this::releaseSpeechSessions);
        motionWorker.shutdown();speechWorker.shutdown();embeddingWorker.shutdownNow();listener=null;super.onDestroy();
    }
}
