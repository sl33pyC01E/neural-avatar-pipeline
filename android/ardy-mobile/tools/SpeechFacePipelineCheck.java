package ai.cleo.ardymobile;

import com.k2fsa.sherpa.onnx.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Real CPU Pocket + LAM through the production rolling pipeline. Never plays audio. */
public final class SpeechFacePipelineCheck {
    static JSONObject fake(float[] pcm,long offset) throws Exception {
        return new JSONObject().put("type","face").put("fps",30).put("startSeconds",offset/24000.0)
            .put("names",new JSONArray(Collections.nCopies(52,"channel")))
            .put("frames",new JSONArray(new float[pcm.length/800][52]));
    }
    static void concurrencyChecks() throws Exception {
        AtomicBoolean cancelled=new AtomicBoolean();AtomicInteger processed=new AtomicInteger();CountDownLatch playing=new CountDownLatch(1);
        ExecutorService producer=Executors.newSingleThreadExecutor();
        try(SpeechFacePipeline pipe=new SpeechFacePipeline(cancelled,()->{},pcmProcessor(processed),(pcm,face)->{
            playing.countDown();while(!cancelled.get())Thread.sleep(10);
        })) {
            Future<?> feeding=producer.submit(()->{try{pipe.accept(new float[24000*20],24000);pipe.finish();}catch(Exception e){throw new RuntimeException(e);}});
            if(!playing.await(3,TimeUnit.SECONDS))throw new AssertionError("No first window before producer completion");
            Thread.sleep(50);
            if(feeding.isDone()||processed.get()>4)throw new AssertionError("Producer queues were not bounded");
            cancelled.set(true);feeding.get(3,TimeUnit.SECONDS);
        }finally{producer.shutdownNow();}
        boolean propagated=false;
        try(SpeechFacePipeline pipe=new SpeechFacePipeline(new AtomicBoolean(),()->{},(pcm,rate)->{throw new IllegalStateException("intentional processor failure");},(pcm,face)->{})) {
            pipe.accept(new float[48000],24000);pipe.finish();
        }catch(IllegalStateException expected){propagated=expected.getMessage().contains("intentional");}
        if(!propagated)throw new AssertionError("LAM failure did not reach the caller");
    }
    static LamTimeline.Processor pcmProcessor(AtomicInteger count){return (pcm,rate)->fake(pcm,count.getAndIncrement()*24000L);}
    public static void main(String[] args) throws Exception {
        concurrencyChecks();Path root=Path.of(args[0]),out=Path.of(args[3]);Files.createDirectories(out);
        OfflineTtsPocketModelConfig config=OfflineTtsPocketModelConfig.builder()
            .setLmMain(root.resolve(PocketModels.file("lm_main","mixed")).toString())
            .setLmFlow(root.resolve(PocketModels.file("lm_flow","mixed")).toString())
            .setDecoder(root.resolve(PocketModels.file("decoder","mixed")).toString())
            .setEncoder(root.resolve("encoder.onnx").toString()).setTextConditioner(root.resolve("text_conditioner.onnx").toString())
            .setVocabJson(root.resolve("vocab.json").toString()).setTokenScoresJson(root.resolve("token_scores.json").toString()).setVoiceEmbeddingCacheCapacity(1).build();
        OfflineTts tts=new OfflineTts(OfflineTtsConfig.builder().setModel(OfflineTtsModelConfig.builder().setPocket(config).setNumThreads(2).build()).build());
        JSONArray modes=new JSONArray();
        try(LamWindow lam=new LamWindow(args[1],new JSONObject(Files.readString(Path.of(args[2]))))) {
            WaveReader reference=new WaveReader(root.resolve("anna.wav").toString());
            for(boolean buffered:new boolean[]{true,false}) {
                AtomicBoolean cancel=new AtomicBoolean();List<float[]> audioChunks=new ArrayList<>(),sourceChunks=new ArrayList<>();JSONArray frames=new JSONArray();
                GenerationConfig options=new GenerationConfig();options.setReferenceAudio(reference.getSamples());options.setReferenceSampleRate(reference.getSampleRate());options.setNumSteps(10);options.setSilenceScale(buffered?.2f:1f);
                options.setExtra(Map.of("temperature","0.7","seed","42","chunk_size","15","max_char_in_sentence","200","min_char_in_sentence","30","max_reference_audio_len",Float.toString(reference.getSamples().length/(float)reference.getSampleRate())));
                JSONObject metrics;long started=System.nanoTime();AtomicLong firstPlayback=new AtomicLong();
                try(SpeechFacePipeline pipe=new SpeechFacePipeline(cancel,lam::reset,lam::next,(pcm,face)->{
                    firstPlayback.compareAndSet(0,System.nanoTime());audioChunks.add(pcm);
                    for(Object frame:face.getJSONArray("frames"))frames.put(frame);
                })) {
                    AtomicReference<Exception> sinkError=new AtomicReference<>();
                    GeneratedAudio generated=tts.generateWithConfigAndCallback(PocketPrompt.prepare("Hello. I'm Cleopatra. It's good to meet you."),options,(OfflineTtsCallback)pcm->{
                        if(cancel.get())return 0;
                        try{if(!buffered){sourceChunks.add(pcm);pipe.accept(pcm,24000);}return 1;}
                        catch(Exception error){sinkError.set(error);return 0;}
                    });
                    if(sinkError.get()!=null)throw sinkError.get();
                    if(buffered){sourceChunks.add(generated.getSamples());pipe.accept(generated.getSamples(),generated.getSampleRate());}
                    pipe.finish();metrics=pipe.metrics();
                }
                float[] source=concat(sourceChunks),played=concat(audioChunks);
                if(!Arrays.equals(source,played))throw new AssertionError("Rolling playback changed the selected PCM");
                lam.reset();JSONObject referenceFace=LamTimeline.build(source,new AtomicBoolean(),lam::next,message->{});
                if(!new JSONArray(frames.toString()).similar(new JSONArray(referenceFace.getJSONArray("frames").toString())))throw new AssertionError("Rolling LAM changed facial values");
                metrics.put("mode",buffered?"buffered":"streaming").put("audioSamples",source.length).put("pcmBitExact",true)
                    .put("matchesPreparedLam",true).put("firstPlaybackSinkMs",(firstPlayback.get()-started)/1e6);
                modes.put(metrics);
            }
        }finally{tts.release();}
        JSONObject report=new JSONObject().put("passed",true).put("device","Windows CPU").put("phoneTest",false)
            .put("realPocketAndLam",true).put("boundedBackpressure",true).put("cancelWhileQueuesFull",true).put("workerFailurePropagates",true).put("modes",modes)
            .put("limitation","Production rolling queues and LAM with real JVM Pocket. Sink captures PCM without AudioTrack, WebView or phone execution; timings are not phone performance.");
        Files.writeString(out.resolve("result.json"),report.toString(2)+"\n");System.out.println(report);
    }
    static float[] concat(List<float[]> chunks) {
        float[] result=new float[chunks.stream().mapToInt(a->a.length).sum()];int offset=0;
        for(float[] chunk:chunks){System.arraycopy(chunk,0,result,offset,chunk.length);offset+=chunk.length;}return result;
    }
}
