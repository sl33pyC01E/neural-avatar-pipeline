package ai.cleo.ardymobile;

import java.util.concurrent.atomic.AtomicBoolean;
import kotlin.jvm.functions.Function1;

/** Sherpa JNI looks up invoke([F)Ljava/lang/Integer;, not the erased Java SAM method. */
public final class PocketCallback implements Function1<float[], Integer> {
    public interface Sink { void accept(float[] samples) throws Exception; }
    private final AtomicBoolean cancelled;
    private final Sink sink;
    private Exception failure;
    private long sinkNanos, firstNanos, samples;
    public PocketCallback(AtomicBoolean cancelled, Sink sink) { this.cancelled=cancelled;this.sink=sink; }
    @Override public Integer invoke(float[] audio) {
        if(cancelled.get()||failure!=null)return 0;
        if(audio==null||audio.length==0)return 1;
        if(firstNanos==0)firstNanos=System.nanoTime();
        long started=System.nanoTime();
        try {
            for(float sample:audio)if(!Float.isFinite(sample))throw new IllegalStateException("Pocket produced non-finite audio");
            samples+=audio.length;
            // JNI already created an owned Java array. The synchronous sink needs no second copy.
            sink.accept(audio);
            return cancelled.get()?0:1;
        }catch(Exception error){failure=error;return 0;}
        finally{sinkNanos+=System.nanoTime()-started;}
    }
    public void rethrow() throws Exception { if(failure!=null)throw failure; }
    public long sinkNanos(){return sinkNanos;}
    public long firstNanos(){return firstNanos;}
    public long samples(){return samples;}
}
