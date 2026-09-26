// Local JVM/CPU synthesis check. Never opens an audio device or controls a phone.
import com.k2fsa.sherpa.onnx.*;
import java.nio.file.*;
import java.util.*;

public class PocketAnnaCheck {
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]);
        OfflineTtsPocketModelConfig pocket=OfflineTtsPocketModelConfig.builder()
            .setLmFlow(root.resolve("lm_flow.int8.onnx").toString()).setLmMain(root.resolve("lm_main.int8.onnx").toString())
            .setEncoder(root.resolve("encoder.onnx").toString()).setDecoder(root.resolve("decoder.int8.onnx").toString())
            .setTextConditioner(root.resolve("text_conditioner.onnx").toString()).setVocabJson(root.resolve("vocab.json").toString())
            .setTokenScoresJson(root.resolve("token_scores.json").toString()).build();
        OfflineTts tts=new OfflineTts(OfflineTtsConfig.builder().setModel(OfflineTtsModelConfig.builder().setPocket(pocket).setNumThreads(2).build()).build());
        try {
            WaveReader reference=new WaveReader(root.resolve("anna.wav").toString());
            GenerationConfig config=new GenerationConfig(); config.setReferenceAudio(reference.getSamples());config.setReferenceSampleRate(reference.getSampleRate());config.setNumSteps(5);
            config.setExtra(Map.of("temperature","0.7","seed","42","max_reference_audio_len",Float.toString(reference.getSamples().length/(float)reference.getSampleRate())));
            long started=System.nanoTime();
            GeneratedAudio audio=tts.generateWithConfigAndCallback("Hello. I'm Cleopatra. It's good to meet you.",config,(OfflineTtsCallback)samples -> 1);
            double seconds=(System.nanoTime()-started)/1e9, energy=0; float peak=0;
            for(float value:audio.getSamples()) { if(!Float.isFinite(value))throw new AssertionError("Non-finite audio"); energy+=value*value;peak=Math.max(peak,Math.abs(value)); }
            double duration=audio.getSamples().length/(double)audio.getSampleRate(), rms=Math.sqrt(energy/audio.getSamples().length);
            if(duration<.5 || rms<.001)throw new AssertionError("Empty or silent speech");
            audio.save(args[1]);
            System.out.printf(Locale.ROOT,"{\"passed\":true,\"voice\":\"anna\",\"device\":\"Windows CPU\",\"sampleRate\":%d,\"durationSeconds\":%.3f,\"generationSeconds\":%.3f,\"rtf\":%.3f,\"rms\":%.5f,\"peak\":%.5f}%n",audio.getSampleRate(),duration,seconds,seconds/duration,rms,peak);
        } finally { tts.release(); }
    }
}
