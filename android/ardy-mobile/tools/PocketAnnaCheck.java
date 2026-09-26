// Local JVM/CPU synthesis check. Never opens an audio device or controls a phone.
import com.k2fsa.sherpa.onnx.*;
import java.nio.file.*;
import java.util.*;
import ai.cleo.ardymobile.PocketPrompt;
import ai.cleo.ardymobile.PocketRecording;
import ai.cleo.ardymobile.PocketModels;

public class PocketAnnaCheck {
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]);
        String precision=args.length>2?args[2]:"fp32";
        int steps=args.length>3?Integer.parseInt(args[3]):10;
        OfflineTtsPocketModelConfig pocket=OfflineTtsPocketModelConfig.builder()
            .setLmFlow(root.resolve(PocketModels.file("lm_flow",precision)).toString()).setLmMain(root.resolve(PocketModels.file("lm_main",precision)).toString())
            .setEncoder(root.resolve("encoder.onnx").toString()).setDecoder(root.resolve(PocketModels.file("decoder",precision)).toString())
            .setTextConditioner(root.resolve("text_conditioner.onnx").toString()).setVocabJson(root.resolve("vocab.json").toString())
            .setTokenScoresJson(root.resolve("token_scores.json").toString()).build();
        OfflineTts tts=new OfflineTts(OfflineTtsConfig.builder().setModel(OfflineTtsModelConfig.builder().setPocket(pocket).setNumThreads(2).build()).build());
        try {
            WaveReader reference=new WaveReader(root.resolve("anna.wav").toString());
            GenerationConfig config=new GenerationConfig(); config.setReferenceAudio(reference.getSamples());config.setReferenceSampleRate(reference.getSampleRate());config.setNumSteps(steps);
            config.setSilenceScale(0.2f);
            config.setExtra(Map.of("temperature","0.7","seed","42","chunk_size","15","max_char_in_sentence","200","min_char_in_sentence","30","max_reference_audio_len",Float.toString(reference.getSamples().length/(float)reference.getSampleRate())));
            int repeats=args.length>5?Integer.parseInt(args[5]):1;
            for(int run=0;run<repeats;run++) {
            long started=System.nanoTime();
            java.util.ArrayList<float[]> chunks=new java.util.ArrayList<>();
            GeneratedAudio audio=tts.generateWithConfigAndCallback(PocketPrompt.prepare(args.length>4?args[4]:"Hello. I'm Cleopatra. It's good to meet you."),config,(OfflineTtsCallback)samples -> {chunks.add(samples);return 1;});
            double seconds=(System.nanoTime()-started)/1e9, energy=0; float peak=0;
            for(float value:audio.getSamples()) { if(!Float.isFinite(value))throw new AssertionError("Non-finite audio"); energy+=value*value;peak=Math.max(peak,Math.abs(value)); }
            double duration=audio.getSamples().length/(double)audio.getSampleRate(), rms=Math.sqrt(energy/audio.getSamples().length);
            if(duration<.5 || rms<.001)throw new AssertionError("Empty or silent speech");
            try(PocketRecording recording=new PocketRecording(Path.of(args[1]).toFile())) {
                // The native callback is pre-ScaleSilence: finalized audio is the buffered source.
                recording.append(audio.getSamples(),audio.getSampleRate());
                recording.finish();
                final int[] read={0};recording.play(new java.util.concurrent.atomic.AtomicBoolean(),(values,rate)->{
                    if(rate!=audio.getSampleRate())throw new AssertionError("Recording changed sample rate");
                    for(float value:values)if(Float.floatToIntBits(value)!=Float.floatToIntBits(audio.getSamples()[read[0]++]))throw new AssertionError("Buffered PCM changed");
                });
                if(read[0]!=audio.getSamples().length)throw new AssertionError("Buffered playback lost samples");
            }
            double rawSeconds=chunks.stream().mapToInt(v->v.length).sum()/(double)audio.getSampleRate();
            System.out.printf(Locale.ROOT,"{\"passed\":true,\"voice\":\"anna\",\"precision\":\"%s\",\"steps\":%d,\"run\":%d,\"device\":\"Windows CPU\",\"sampleRate\":%d,\"durationSeconds\":%.3f,\"rawCallbackSeconds\":%.3f,\"generationSeconds\":%.3f,\"rtf\":%.3f,\"rms\":%.5f,\"peak\":%.5f,\"bufferedPcmBitExact\":true,\"qualityVerified\":false}%n",precision,steps,run,audio.getSampleRate(),duration,rawSeconds,seconds,seconds/duration,rms,peak);
            }
        } finally { tts.release(); }
    }
}
