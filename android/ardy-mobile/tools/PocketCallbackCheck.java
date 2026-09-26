// Reproduces the missing concrete JNI method on a Java SAM and checks the replacement.
import ai.cleo.ardymobile.PocketCallback;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicBoolean;
import kotlin.jvm.functions.Function1;

public final class PocketCallbackCheck {
    public static void main(String[] args) throws Exception {
        Function1<float[],Integer> erased=audio->1;
        boolean reproduces=false;
        try{erased.getClass().getMethod("invoke",float[].class);}catch(NoSuchMethodException expected){reproduces=true;}
        if(!reproduces)throw new AssertionError("The original Java SAM unexpectedly exposes the typed method");
        AtomicBoolean cancelled=new AtomicBoolean();int[] received={0};
        PocketCallback callback=new PocketCallback(cancelled,audio->received[0]+=audio.length);
        Method invoke=callback.getClass().getMethod("invoke",float[].class);
        if(invoke.getReturnType()!=Integer.class)throw new AssertionError("Sherpa requires boxed Integer");
        if(!invoke.invoke(callback,(Object)new float[]{.1f,.2f}).equals(1)||received[0]!=2)throw new AssertionError("Audio not delivered");
        if(callback.samples()!=2||callback.firstNanos()==0||callback.sinkNanos()<=0)throw new AssertionError("Missing timing counters");
        cancelled.set(true);
        if(callback.invoke(new float[]{.3f})!=0||received[0]!=2)throw new AssertionError("Cancelled audio delivered");
        PocketCallback broken=new PocketCallback(new AtomicBoolean(),audio->{throw new Exception("sink failed");});
        if(broken.invoke(new float[]{.1f})!=0)throw new AssertionError("Failed sink must stop generation");
        try{broken.rethrow();throw new AssertionError("Failure disappeared");}catch(Exception expected){if(!expected.getMessage().equals("sink failed"))throw expected;}
        PocketCallback invalid=new PocketCallback(new AtomicBoolean(),audio->{throw new AssertionError("Invalid samples reached sink");});
        if(invalid.invoke(new float[]{Float.NaN})!=0)throw new AssertionError("Non-finite audio accepted");
        System.out.println("{\"passed\":true,\"originalSamMismatchReproduced\":true,\"jniSignature\":\"invoke([F)Ljava/lang/Integer;\",\"deliveryCancellationErrorsAndTiming\":true,\"phoneTest\":false}");
    }
}
