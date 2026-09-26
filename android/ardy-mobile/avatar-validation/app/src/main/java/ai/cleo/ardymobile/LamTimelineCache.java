package ai.cleo.ardymobile;

import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.*;

/** One bounded prepared timeline. Keys include exact PCM and the model/postprocessing contract. */
public final class LamTimelineCache {
    private static final int MAX_SAMPLES=120*24000;
    private byte[] key;
    private String timeline;
    public static byte[] key(float[] clip,String pipeline) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        digest.update(pipeline.getBytes(StandardCharsets.UTF_8));digest.update((byte)0);
        ByteBuffer bytes=ByteBuffer.allocate(8192).order(ByteOrder.LITTLE_ENDIAN);
        for(float sample:clip) {
            if(!Float.isFinite(sample))throw new IllegalArgumentException("Non-finite LAM input");
            if(bytes.remaining()<4){digest.update(bytes.array(),0,bytes.position());bytes.clear();}
            bytes.putFloat(sample);
        }
        digest.update(bytes.array(),0,bytes.position());return digest.digest();
    }
    public JSONObject get(byte[] requested) throws JSONException {
        // A fresh object prevents per-playback run IDs or renderer metadata mutating the cache.
        return timeline!=null&&Arrays.equals(key,requested)?new JSONObject(timeline):null;
    }
    public void put(byte[] requested,float[] clip,JSONObject value) throws JSONException {
        clear();
        if(clip.length>MAX_SAMPLES)return;
        if(value.getInt("fps")!=30||value.getJSONArray("names").length()!=52||
           value.getJSONArray("frames").length()!=(clip.length+799)/800||value.getDouble("startSeconds")!=0)
            throw new IllegalArgumentException("Cannot cache an incomplete LAM timeline");
        timeline=value.toString();key=requested.clone();
    }
    public void clear(){key=null;timeline=null;}
}
