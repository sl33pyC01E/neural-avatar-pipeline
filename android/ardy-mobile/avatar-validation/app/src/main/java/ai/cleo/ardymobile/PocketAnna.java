package ai.cleo.ardymobile;

import android.content.Context;
import com.k2fsa.sherpa.onnx.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.json.JSONObject;

/** PocketTTS with Kyutai's Anna preset source (vctk/p228_023_enhanced.wav). */
public final class PocketAnna implements AutoCloseable {
    public interface AudioChunk { void accept(float[] samples,int sampleRate) throws Exception; }
    private final Context context;
    private OfflineTts engine;
    private float[] reference;
    private int referenceRate;
    private int loadedThreads;
    private String loadedPrecision;
    private static final String[] FILES={"lm_flow.int8.onnx","lm_main.int8.onnx","encoder.onnx",
        "decoder.int8.onnx","text_conditioner.onnx","vocab.json","token_scores.json","anna.wav",
        "lm_flow.onnx","lm_main.onnx","decoder.onnx"};
    public PocketAnna(Context context) { this.context=context.getApplicationContext(); }
    public boolean isWarm(){return engine!=null;}
    public void warm(int threads,String precision) throws Exception {
        PocketModels.file("lm_main",precision); // Validate before releasing a working engine.
        if(engine!=null&&loadedThreads==threads&&precision.equals(loadedPrecision)) return;
        close();
        File root=new File(context.getFilesDir(),"pocket-tts");
        if(!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create PocketTTS model directory");
        String bundled;
        try(InputStream in=context.getAssets().open("pocket-tts/manifest.json")) { bundled=new String(Embeddings.read(in),StandardCharsets.UTF_8); }
        File installedManifest=new File(root,"manifest.json");
        String installed="";
        if(installedManifest.isFile())try(InputStream in=new FileInputStream(installedManifest)){ installed=new String(Embeddings.read(in),StandardCharsets.UTF_8); }
        JSONObject entries=new JSONObject(bundled).getJSONObject("files");
        for(String name:FILES) {
            File destination=new File(root,name);
            JSONObject expected=entries.getJSONObject(name);
            if(!bundled.equals(installed) || !destination.isFile() || destination.length()!=expected.getLong("bytes")) {
                File temporary=new File(root,name+".partial");
                java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
                try(InputStream input=context.getAssets().open("pocket-tts/"+name); FileOutputStream output=new FileOutputStream(temporary)) {
                    byte[] buffer=new byte[1024*1024]; int n;
                    while((n=input.read(buffer))!=-1){output.write(buffer,0,n);digest.update(buffer,0,n);}
                    output.getFD().sync();
                }
                StringBuilder hash=new StringBuilder(); for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
                if(!hash.toString().equals(expected.getString("sha256")))throw new IOException("PocketTTS payload checksum mismatch: "+name);
                if(!temporary.renameTo(destination)) throw new IOException("Cannot prepare PocketTTS "+name);
            }
        }
        try(FileOutputStream out=new FileOutputStream(installedManifest)){out.write(bundled.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
        OfflineTtsPocketModelConfig pocket=new OfflineTtsPocketModelConfig();
        pocket.setLmFlow(new File(root,PocketModels.file("lm_flow",precision)).getPath()); pocket.setLmMain(new File(root,PocketModels.file("lm_main",precision)).getPath());
        pocket.setEncoder(new File(root,"encoder.onnx").getPath()); pocket.setDecoder(new File(root,PocketModels.file("decoder",precision)).getPath());
        pocket.setTextConditioner(new File(root,FILES[4]).getPath()); pocket.setVocabJson(new File(root,FILES[5]).getPath());
        pocket.setTokenScoresJson(new File(root,FILES[6]).getPath()); pocket.setVoiceEmbeddingCacheCapacity(1);
        OfflineTtsModelConfig model=new OfflineTtsModelConfig(); model.setPocket(pocket); model.setNumThreads(threads); model.setProvider("cpu");
        OfflineTtsConfig config=new OfflineTtsConfig(); config.setModel(model);
        readAnna(new File(root,"anna.wav"));
        engine=new OfflineTts(null,config);
        loadedThreads=threads;
        loadedPrecision=precision;
    }
    public JSONObject synthesize(String text,int threads,int steps,int chunkSize,String precision,boolean buffered,AtomicBoolean cancelled,Consumer<String> progress,AudioChunk sink) throws Exception {
        text=PocketPrompt.prepare(text);
        if(threads<1||threads>6||steps<1||steps>10||chunkSize<1||chunkSize>32)throw new IllegalArgumentException("Invalid Pocket runtime settings");
        long started=System.nanoTime();boolean wasWarm=engine!=null&&loadedThreads==threads&&precision.equals(loadedPrecision);
        progress.accept(wasWarm?"Anna is warm":"Loading PocketTTS and Anna…");
        warm(threads,precision);long prepared=System.nanoTime();
        if(cancelled.get())return null;
        GenerationConfig options=new GenerationConfig(); options.setReferenceAudio(reference); options.setReferenceSampleRate(referenceRate);
        options.setNumSteps(steps);
        // Native pause shortening is applied ONLY to the returned audio, after all callbacks.
        options.setSilenceScale(buffered?0.2f:1f);
        Map<String,String> extra=new HashMap<>(); extra.put("temperature","0.7"); extra.put("chunk_size",Integer.toString(chunkSize));
        // Restore the backend's phrase boundaries; do not trade prosody for first-chunk latency.
        extra.put("max_char_in_sentence","200");extra.put("min_char_in_sentence","30");
        // Repeatable A/B comparisons. A new random seed on every click obscures precision/step changes.
        extra.put("seed","42");
        extra.put("max_reference_audio_len",Float.toString(reference.length/(float)referenceRate));
        options.setExtra(extra);
        progress.accept("Generating Anna speech…");
        PocketCallback callback=new PocketCallback(cancelled,samples->{if(!buffered)sink.accept(samples,engine.sampleRate());});
        long generationStarted=System.nanoTime();
        GeneratedAudio generated=engine.generateWithConfigAndCallback(text,options,callback);
        long finished=System.nanoTime();callback.rethrow();
        if(!cancelled.get()&&callback.samples()==0)throw new IOException("Pocket returned no audio");
        if(buffered&&!cancelled.get())sink.accept(generated.getSamples(),generated.getSampleRate());
        double seconds=(buffered?generated.getSamples().length:callback.samples())/(double)engine.sampleRate();
        double computeMs=(finished-generationStarted-callback.sinkNanos())/1e6;
        return new JSONObject().put("type","pocketMetrics").put("precision",precision).put("seed",42).put("silenceScale",buffered?0.2:1).put("rawAudioSeconds",callback.samples()/(double)engine.sampleRate()).put("sampleRate",engine.sampleRate()).put("warm",wasWarm).put("threads",threads).put("steps",steps).put("chunkSize",chunkSize)
            .put("loadMs",(prepared-started)/1e6).put("firstChunkMs",callback.firstNanos()==0?-1:(callback.firstNanos()-started)/1e6)
            .put("computeMs",computeMs).put("playbackSinkMs",callback.sinkNanos()/1e6).put("audioSeconds",seconds)
            .put("computeRtf",seconds>0?computeMs/1000/seconds:-1).put("cancelled",cancelled.get());
    }
    private void readAnna(File file) throws IOException {
        byte[] bytes; try(InputStream input=new FileInputStream(file)){ bytes=Embeddings.read(input); }
        ByteBuffer buffer=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        if(bytes.length<12 || !new String(bytes,0,4,StandardCharsets.US_ASCII).equals("RIFF") || !new String(bytes,8,4,StandardCharsets.US_ASCII).equals("WAVE")) throw new IOException("Invalid Anna WAV");
        int format=0,channels=0,bits=0,dataOffset=-1,dataLength=0;
        for(int p=12;p+8<=bytes.length;) {
            String kind=new String(bytes,p,4,StandardCharsets.US_ASCII); int size=buffer.getInt(p+4), start=p+8;
            if(size<0 || (long)start+size>bytes.length) throw new IOException("Truncated Anna WAV");
            if(kind.equals("fmt ")) { if(size<16)throw new IOException("Invalid WAV format"); format=buffer.getShort(start)&65535; channels=buffer.getShort(start+2)&65535; referenceRate=buffer.getInt(start+4); bits=buffer.getShort(start+14)&65535; }
            if(kind.equals("data")) { dataOffset=start; dataLength=size; }
            p=start+size+(size&1);
        }
        if(format!=1 || channels!=1 || bits!=16 || dataOffset<0 || referenceRate<=0) throw new IOException("Expected mono PCM16 Anna reference");
        reference=new float[dataLength/2]; for(int i=0;i<reference.length;i++)reference[i]=buffer.getShort(dataOffset+2*i)/32768f;
    }
    @Override public void close() { if(engine!=null)engine.release();engine=null;reference=null; }
}
