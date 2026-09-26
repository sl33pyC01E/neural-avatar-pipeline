package ai.cleo.ardymobile;

import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.json.*;

/** Prepares frame-aligned LAM windows from the exact completed Pocket playback PCM. */
public final class LamTimeline {
    public interface Processor { JSONObject next(float[] samples,int rate) throws Exception; }
    private LamTimeline() {}
    public static JSONObject build(float[] samples,AtomicBoolean cancelled,Processor processor,Consumer<String> progress) throws Exception {
        JSONArray frames=new JSONArray(),names=null;
        for(int offset=0;offset<samples.length;offset+=24000) {
            if(cancelled.get())return null;
            int count=Math.min(24000,samples.length-offset),aligned=(count+799)/800*800;
            // Pad only the analysis tail. Playback still uses the original, unpadded clip.
            JSONObject part=processor.next(Arrays.copyOfRange(samples,offset,offset+aligned),24000);
            if(part.getInt("fps")!=30||Math.abs(part.getDouble("startSeconds")-offset/24000.0)>1e-6)throw new IOException("LAM audio/frame alignment changed");
            names=part.getJSONArray("names");JSONArray batch=part.getJSONArray("frames");
            if(names.length()!=52||batch.length()!=aligned/800)throw new IOException("Invalid LAM timeline shape");
            for(int f=0;f<batch.length();f++) {
                JSONArray frame=batch.getJSONArray(f);if(frame.length()!=52)throw new IOException("Invalid LAM frame");
                for(int j=0;j<52;j++)if(!Double.isFinite(frame.getDouble(j)))throw new IOException("Non-finite LAM expression");
                frames.put(frame);
            }
            progress.accept("Preparing face · "+Math.min(100,(offset+count)*100L/samples.length)+"%");
        }
        return new JSONObject().put("type","face").put("prepared",true).put("withFace",true)
            .put("fps",30).put("names",names).put("startSeconds",0).put("frames",frames);
    }
}
