package ai.cleo.ardymobile;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Synthetic PCM only: verifies the production text queue and rolling face pipeline. */
public final class SpeechInputCheck {
    static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
    public static void main(String[] args)throws Exception {
        AtomicBoolean cancel=new AtomicBoolean();SpeechTextQueue input=new SpeechTextQueue("turn");
        ExecutorService producer=Executors.newSingleThreadExecutor();
        AtomicInteger preparations=new AtomicInteger(),samples=new AtomicInteger(),analysisSamples=new AtomicInteger();
        List<Float> audio=Collections.synchronizedList(new ArrayList<>());
        CountDownLatch firstPlayed=new CountDownLatch(1);
        try(SpeechFacePipeline pipe=new SpeechFacePipeline(cancel,preparations::incrementAndGet,(pcm,rate)->{
            return new JSONObject().put("fps",30).put("names",new JSONArray(Collections.nCopies(52,"channel")))
                .put("frames",new JSONArray(new float[pcm.length/800][52])).put("startSeconds",analysisSamples.getAndAdd(pcm.length)/24000.0);
        },(pcm,face)->{for(float sample:pcm)audio.add(sample);samples.addAndGet(pcm.length);firstPlayed.countDown();})){
            Future<?> feeding=producer.submit(()->{try{String phrase;while((phrase=input.next(cancel))!=null){float[] pcm=new float[Integer.parseInt(phrase)];Arrays.fill(pcm,phrase.equals("30000")?1:2);pipe.accept(pcm,24000);}pipe.finish();}catch(Exception e){throw new RuntimeException(e);}});
            input.append("30000");check(firstPlayed.await(2,TimeUnit.SECONDS),"No playback before text input finished");
            input.append("18017");input.finish();feeding.get(3,TimeUnit.SECONDS);
            check(preparations.get()==1,"LAM was reset between phrases");check(samples.get()==48017,"Phrase boundary dropped or padded PCM");
            for(int i=0;i<audio.size();i++)check(audio.get(i)==(i<30000?1:2),"PCM reordered across phrases");
        }finally{producer.shutdownNow();}
        boolean rejected=false;try{input.append("late");}catch(java.io.IOException expected){rejected=true;}check(rejected,"Late phrase accepted");
        SpeechTextQueue bounded=new SpeechTextQueue("bounded");for(int i=0;i<5;i++)bounded.append("a".repeat(400));
        rejected=false;try{bounded.append("x");}catch(java.io.IOException expected){rejected=true;}check(rejected,"Unbounded speech input");
        SpeechTextQueue waiting=new SpeechTextQueue("cancel");AtomicBoolean stop=new AtomicBoolean();ExecutorService waiter=Executors.newSingleThreadExecutor();
        try{Future<String> result=waiter.submit(()->waiting.next(stop));stop.set(true);check(result.get(1,TimeUnit.SECONDS)==null,"Cancel didn't wake waiting input");}finally{waiter.shutdownNow();}
        System.out.println(new JSONObject().put("passed",true).put("nativeInference",false).put("continuousPcmSamples",samples.get()).put("lamResets",preparations.get()).put("cancellation",true).put("boundedText",true));
    }
}
