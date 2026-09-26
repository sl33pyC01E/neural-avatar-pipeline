package ai.cleo.ardyavatarvalidation;
import java.nio.*;
import java.util.*;
import org.json.*;

public final class WhisperXContractCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static byte[] wave(int rate,int samples){
        ByteBuffer b=ByteBuffer.allocate(54+samples*2).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(0x46464952).putInt(b.capacity()-8).putInt(0x45564157);
        b.putInt(0x4b4e554a).putInt(1).put((byte)7).put((byte)0); // padded odd RIFF chunk
        b.putInt(0x20746d66).putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16);
        b.putInt(0x61746164).putInt(samples*2);for(int i=0;i<samples;i++)b.putShort((short)8192);return b.array();
    }
    public static void main(String[] args)throws Exception {
        float[] direct=WhisperXRuntime.decodeWave(wave(16000,1600));check(direct.length==1600&&direct[0]==.25f,"PCM16/RIFF parsing");
        float[] resampled=WhisperXRuntime.decodeWave(wave(48000,4800));check(resampled.length==1600,"Resample length");
        for(float x:resampled)check(Math.abs(x-.25f)<1e-6,"Resampler changed DC gain");
        boolean rejected=false;try{WhisperXRuntime.decodeWave(Arrays.copyOf(wave(16000,1600),50));}catch(java.io.IOException expected){rejected=true;}
        check(rejected,"Truncated WAV accepted");
        JSONObject vocab=new JSONObject().put("<pad>",0).put("A",1).put("|",2);
        float[][] logits=new float[9][3];for(float[] row:logits){Arrays.fill(row,-8);row[0]=8;}
        logits[1]=new float[]{-8,8,-8};logits[4]=new float[]{-8,-8,8};logits[6]=new float[]{-8,8,-8};
        JSONArray words=WhisperXAlignment.align(logits,"A A",vocab,2.0,.18);
        check(words.length()==2,"Word count");
        JSONObject first=words.getJSONObject(0),second=words.getJSONObject(1);
        check(first.getDouble("start")>=2&&first.getDouble("end")<=second.getDouble("start")&&second.getDouble("end")<=2.18,"Invalid word timing order/offset");
        check(first.getDouble("score")>.9&&second.getDouble("score")>.9,"Known emission alignment");
        JSONArray unknown=WhisperXAlignment.align(logits,"123",vocab,0,.18);check(!unknown.getJSONObject(0).has("start"),"Fabricated unknown-word timing");
        System.out.println(new JSONObject().put("passed",true).put("pcmAndResampling",true).put("ctcWordAlignment",true).put("unknownWordsUntimed",true).put("phoneExecuted",false));
    }
}
