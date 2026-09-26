package ai.cleo.ardymobile;

import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.JSONObject;

/** Bounded Pocket -> LAM -> playback pipeline, shared by Android and CPU checks. */
public final class SpeechFacePipeline implements AutoCloseable {
    public interface Prepare { void run() throws Exception; }
    public interface Play { void accept(float[] pcm,JSONObject face) throws Exception; }
    private static final float[] END=new float[0];
    private record Window(float[] pcm,JSONObject face) {}
    private final ArrayBlockingQueue<float[]> input=new ArrayBlockingQueue<>(2);
    private final ArrayBlockingQueue<Window> output=new ArrayBlockingQueue<>(2);
    private final AtomicBoolean cancelled;
    private final AtomicReference<Throwable> failure=new AtomicReference<>();
    private final ExecutorService workers=Executors.newFixedThreadPool(2);
    private final Future<?> analysis,playback;
    private float[] pending=new float[24000];
    private int used;
    private boolean ended,complete;
    private final long started=System.nanoTime();
    private volatile long loadNanos,computeNanos,firstFaceNanos;
    private volatile int frames,windows;
    public SpeechFacePipeline(AtomicBoolean cancelled,Prepare prepare,LamTimeline.Processor processor,Play play) {
        this.cancelled=cancelled;
        analysis=workers.submit(()->{
            try {
                if(cancelled.get())return;
                long loading=System.nanoTime();prepare.run();loadNanos=System.nanoTime()-loading;
                long offset=0;
                while(!cancelled.get()) {
                    float[] pcm=take(input);if(pcm==null)return;
                    if(pcm==END){put(output,new Window(END,null));return;}
                    long computing=System.nanoTime();
                    JSONObject face=processor.next(Arrays.copyOf(pcm,(pcm.length+799)/800*800),24000);
                    computeNanos+=System.nanoTime()-computing;
                    if(face.getInt("fps")!=30||face.getJSONArray("names").length()!=52||
                       face.getJSONArray("frames").length()!=(pcm.length+799)/800||
                       Math.abs(face.getDouble("startSeconds")-offset/24000.0)>1e-6)
                        throw new IllegalStateException("LAM stream lost audio alignment");
                    if(firstFaceNanos==0)firstFaceNanos=System.nanoTime();
                    frames+=face.getJSONArray("frames").length();windows++;offset+=pcm.length;
                    put(output,new Window(pcm,face));
                }
            }catch(Throwable error){fail(error);}
        });
        playback=workers.submit(()->{
            try {
                while(!cancelled.get()) {
                    Window window=take(output);if(window==null||window.pcm==END)return;
                    play.accept(window.pcm,window.face);
                }
            }catch(Throwable error){fail(error);}
        });
    }
    private void fail(Throwable error){failure.compareAndSet(null,error);cancelled.set(true);}
    private void check() throws Exception {
        Throwable error=failure.get();if(error instanceof Exception)throw (Exception)error;
        if(error!=null)throw new IllegalStateException("Speech/face pipeline failed",error);
    }
    private <T> void put(BlockingQueue<T> queue,T value) throws Exception {
        while(!cancelled.get()){check();if(queue.offer(value,50,TimeUnit.MILLISECONDS))return;}check();
    }
    private <T> T take(BlockingQueue<T> queue) throws Exception {
        while(!cancelled.get()){check();T value=queue.poll(50,TimeUnit.MILLISECONDS);if(value!=null)return value;}check();return null;
    }
    public void accept(float[] pcm,int rate) throws Exception {
        if(rate!=24000||ended)throw new IllegalArgumentException("Expected an open 24 kHz speech stream");
        for(int offset=0;offset<pcm.length&&!cancelled.get();) {
            int count=Math.min(pending.length-used,pcm.length-offset);
            System.arraycopy(pcm,offset,pending,used,count);used+=count;offset+=count;
            if(used==pending.length){put(input,pending);pending=new float[24000];used=0;}
        }
        check();
    }
    public void finish() throws Exception {
        if(ended)throw new IllegalStateException("Speech stream already ended");ended=true;
        if(used>0)put(input,Arrays.copyOf(pending,used));put(input,END);
        // Both tasks must exit before the owning service may close or reuse LAM.
        analysis.get();playback.get();check();complete=true;
    }
    public JSONObject metrics() throws Exception {
        return new JSONObject().put("lamLoadMs",loadNanos/1e6).put("lamComputeMs",computeNanos/1e6)
            .put("firstFaceMs",firstFaceNanos==0?-1:(firstFaceNanos-started)/1e6)
            .put("faceFrames",frames).put("faceWindows",windows).put("queueCapacity",2);
    }
    @Override public void close() {
        if(!complete)cancelled.set(true);
        workers.shutdown();boolean interrupted=false;
        // Cancellation wakes queue waits; native inference completes its current window.
        // Never race model release against a still-running analysis task.
        while(true)try{if(workers.awaitTermination(100,TimeUnit.MILLISECONDS))break;}
            catch(InterruptedException error){interrupted=true;cancelled.set(true);}
        input.clear();output.clear();if(interrupted)Thread.currentThread().interrupt();
    }
}
