package ai.cleo.ardyavatarvalidation;

import ai.onnxruntime.*;
import android.content.Context;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** Native English WhisperX pipeline: Silero VAD, CTranslate2 ASR, wav2vec2 alignment.
 * Single-utterance greedy decoding; no Python runtime or speaker diarization. */
final class WhisperXRuntime implements AutoCloseable {
    private final Object lock=new Object();
    private final OrtEnvironment ort=OrtEnvironment.getEnvironment();
    private OrtSession vad,aligner;
    private JSONObject vocabulary;
    private long decoder;
    private volatile boolean cancelled,closed;
    private static native long nativeLoad(String path)throws IOException;
    private static native byte[] nativeTranscribe(long handle,float[] audio)throws IOException;
    private static native void nativeClose(long handle);

    WhisperXRuntime(Context context)throws Exception {
        System.loadLibrary("cleo_whisperx");
        File root=new File(context.getFilesDir(),"whisperx");
        try {
            for(String file:List.of("base.en/model.bin","base.en/config.json","base.en/vocabulary.txt","vad/model.onnx","alignment/model.onnx","alignment/vocab.json"))
                if(!new File(root,file).isFile())throw new IOException("Missing WhisperX asset: "+file);
            vocabulary=new JSONObject(new String(Files.readAllBytes(new File(root,"alignment/vocab.json").toPath()),StandardCharsets.UTF_8));
            try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()){
                options.setIntraOpNumThreads(2);options.setInterOpNumThreads(1);
                options.addConfigEntry("session.intra_op.allow_spinning","0");options.addConfigEntry("session.inter_op.allow_spinning","0");
                vad=ort.createSession(new File(root,"vad/model.onnx").getPath(),options);
                aligner=ort.createSession(new File(root,"alignment/model.onnx").getPath(),options);
            }
            decoder=nativeLoad(new File(root,"base.en").getPath());
        }catch(Exception|LinkageError error){release();throw error;}
    }
    JSONObject transcribe(byte[] wav)throws Exception {
        synchronized(lock){
            if(closed)throw new IOException("WhisperX is unloaded");cancelled=false;
            long start=System.nanoTime();float[] audio=decodeWave(wav);JSONArray words=new JSONArray();StringBuilder text=new StringBuilder();
            List<int[]> segments=detectSpeech(audio);double vadMs=elapsed(start),asrMs=0,alignmentMs=0;
            for(int[] segment:segments){
                checkCancelled();float[] chunk=Arrays.copyOfRange(audio,segment[0],segment[1]);long phase=System.nanoTime();
                String phrase=new String(nativeTranscribe(decoder,chunk),StandardCharsets.UTF_8).trim();asrMs+=elapsed(phase);checkCancelled();
                if(phrase.isEmpty())continue;if(text.length()>0)text.append(' ');text.append(phrase);
                phase=System.nanoTime();JSONArray aligned=align(chunk,phrase,segment[0]/16000.0);alignmentMs+=elapsed(phase);
                for(int i=0;i<aligned.length();i++)words.put(aligned.get(i));
            }
            checkCancelled();return new JSONObject().put("text",text.toString()).put("words",words).put("deviceRequestMs",elapsed(start))
                .put("vadMs",vadMs).put("decodeMs",asrMs).put("alignmentMs",alignmentMs).put("segments",segments.size()).put("engine","WhisperX native · base.en INT8 · CPU");
        }
    }
    private List<int[]> detectSpeech(float[] audio)throws Exception {
        List<int[]> spans=new ArrayList<>();float[][][] state=new float[2][1][128];float[] context=new float[64];int speech=-1,silence=-1;
        for(int offset=0;offset<audio.length;offset+=512){
            checkCancelled();float[][] frame=new float[1][576];System.arraycopy(context,0,frame[0],0,64);
            System.arraycopy(audio,offset,frame[0],64,Math.min(512,audio.length-offset));System.arraycopy(frame[0],512,context,0,64);
            float probability;
            try(OnnxTensor input=OnnxTensor.createTensor(ort,frame);OnnxTensor recurrent=OnnxTensor.createTensor(ort,state);
                OnnxTensor rate=OnnxTensor.createTensor(ort,LongBuffer.wrap(new long[]{16000}),new long[]{});
                OrtSession.Result result=vad.run(Map.of("input",input,"state",recurrent,"sr",rate))){
                probability=((float[][])result.get("output").orElseThrow(()->new IOException("Missing VAD output")).getValue())[0][0];state=(float[][][])result.get("stateN").orElseThrow(()->new IOException("Missing VAD state")).getValue();
            }
            if(probability>=.5f){if(speech<0)speech=offset;silence=-1;}
            else if(probability<.35f&&speech>=0){
                if(silence<0)silence=offset;
                if(offset-silence>=1600){if(silence-speech>=4000)spans.add(new int[]{Math.max(0,speech-2560),Math.min(audio.length,silence+2560)});speech=-1;silence=-1;}
            }
        }
        if(speech>=0&&audio.length-speech>=4000)spans.add(new int[]{Math.max(0,speech-2560),audio.length});
        List<int[]> merged=new ArrayList<>();
        for(int[] span:spans){if(!merged.isEmpty()&&span[0]<=merged.get(merged.size()-1)[1])merged.get(merged.size()-1)[1]=span[1];else merged.add(span);}
        List<int[]> bounded=new ArrayList<>();
        for(int[] span:merged)for(int from=span[0];from<span[1];from+=400000)bounded.add(new int[]{from,Math.min(from+400000,span[1])});
        return bounded;
    }
    private JSONArray align(float[] audio,String text,double offset)throws Exception {
        checkCancelled();double mean=0;for(float x:audio)mean+=x;mean/=audio.length;double variance=0;for(float x:audio)variance+=(x-mean)*(x-mean);variance/=audio.length;
        float[][] input=new float[1][audio.length];double scale=1/Math.sqrt(variance+1e-7);
        for(int i=0;i<audio.length;i++)input[0][i]=(float)((audio[i]-mean)*scale);
        float[][] logits;
        try(OnnxTensor tensor=OnnxTensor.createTensor(ort,input);OrtSession.Result result=aligner.run(Map.of("input_values",tensor))){logits=((float[][][])result.get("logits").orElseThrow(()->new IOException("Missing alignment output")).getValue())[0];}
        checkCancelled();return WhisperXAlignment.align(logits,text,vocabulary,offset,audio.length/16000.0);
    }
    static float[] decodeWave(byte[] bytes)throws IOException {
        if(bytes==null||bytes.length<44)throw new IOException("No WAV audio attached");
        ByteBuffer b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        if(b.getInt(0)!=0x46464952||b.getInt(8)!=0x45564157)throw new IOException("WhisperX expects a WAV file");
        int format=0,channels=0,rate=0,bits=0,data=-1,size=0;
        for(int p=12;p+8<=bytes.length;){int id=b.getInt(p),length=b.getInt(p+4);if(length<0||(long)p+8+length>bytes.length)throw new IOException("Truncated WAV chunk");
            if(id==0x20746d66&&length>=16){format=b.getShort(p+8)&65535;channels=b.getShort(p+10)&65535;rate=b.getInt(p+12);bits=b.getShort(p+22)&65535;}
            if(id==0x61746164){data=p+8;size=length;}long next=(long)p+8+length+(length&1);if(next>Integer.MAX_VALUE)break;p=(int)next;}
        if(data<0||channels<1||channels>8||rate<8000||rate>96000||!((format==1&&bits==16)||(format==3&&bits==32)))throw new IOException("WhisperX supports PCM16 or float32 WAV, 8–96 kHz");
        int width=bits/8,count=size/(width*channels);if(count<1||count>(long)rate*60)throw new IOException("WhisperX audio must be 0–60 seconds");
        float[] mono=new float[count];for(int i=0;i<count;i++){double value=0;for(int c=0;c<channels;c++){int at=data+(i*channels+c)*width;float sample=format==1?b.getShort(at)/32768.f:b.getFloat(at);if(!Float.isFinite(sample))throw new IOException("Invalid audio sample");value+=sample;}mono[i]=(float)(value/channels);}
        if(rate==16000)return mono;
        float[] output=new float[(int)Math.round(count*16000.0/rate)];double cutoff=Math.min(1,16000.0/rate);
        for(int i=0;i<output.length;i++){double position=i*rate/16000.0,sum=0,weight=0;int center=(int)position;
            for(int j=center-32;j<=center+32;j++){double d=position-j;if(Math.abs(d)>32)continue;double x=Math.PI*d*cutoff;double w=(Math.abs(x)<1e-12?1:Math.sin(x)/x)*(.5+.5*Math.cos(Math.PI*d/32))*cutoff;sum+=mono[Math.max(0,Math.min(count-1,j))]*w;weight+=w;}
            output[i]=(float)(sum/weight);}
        return output;
    }
    private static double elapsed(long start){return (System.nanoTime()-start)/1e6;}
    private void checkCancelled()throws InterruptedIOException{if(cancelled||closed)throw new InterruptedIOException("WhisperX cancelled");}
    void cancel(){cancelled=true;}
    private void release(){if(decoder!=0){nativeClose(decoder);decoder=0;}try{if(vad!=null)vad.close();}catch(Exception ignored){}try{if(aligner!=null)aligner.close();}catch(Exception ignored){}vad=null;aligner=null;}
    @Override public void close(){closed=true;cancelled=true;Thread cleanup=new Thread(()->{synchronized(lock){release();}},"whisperx-release");cleanup.setDaemon(true);cleanup.start();}
}
