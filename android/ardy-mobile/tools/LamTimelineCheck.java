package ai.cleo.ardymobile;

import java.nio.file.*;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

/** Real CPU LAM on completed Pocket WAV, using the Android window/timeline code. No playback. */
public final class LamTimelineCheck {
    public static void main(String[] args) throws Exception {
        float[] clip=PocketRecording.readCompleted(Path.of(args[2]).toFile());
        float[] original=clip.clone();long started=System.nanoTime();
        try(LamWindow lam=new LamWindow(args[0],new JSONObject(Files.readString(Path.of(args[1]))))) {
            JSONObject result=LamTimeline.build(clip,new AtomicBoolean(),lam::next,message->{});
            int count=result.getJSONArray("frames").length();
            if(count!=(clip.length+799)/800||result.getDouble("startSeconds")!=0||!Arrays.equals(clip,original))throw new AssertionError("Timeline altered audio or changed alignment");
            double jaw=0;int jawIndex=result.getJSONArray("names").toList().indexOf("jawOpen");
            for(int f=0;f<count;f++)jaw=Math.max(jaw,result.getJSONArray("frames").getJSONArray(f).getDouble(jawIndex));
            if(jaw<=0)throw new AssertionError("LAM mouth never opens");
            AtomicBoolean cancelled=new AtomicBoolean(true);
            if(LamTimeline.build(clip,cancelled,(pcm,rate)->{throw new AssertionError("Cancelled timeline ran inference");},message->{})!=null)throw new AssertionError("Cancelled timeline was returned");
            Files.writeString(Path.of(args[3]),result.toString());
            JSONObject report=new JSONObject().put("passed",true).put("device","Windows CPU").put("phoneTest",false)
                .put("frames",count).put("audioSamples",clip.length).put("audioUnmodified",true).put("frameAlignedTail",true).put("maxJawOpen",jaw)
                .put("seconds",(System.nanoTime()-started)/1e9).put("cancelBeforeInference",true)
                .put("limitation","Shared production LAM inference and timeline code; Android audio clock and perceptual lip-sync require the user test.");
            Files.writeString(Path.of(args[4]),report.toString(2)+"\n");System.out.println(report);
        }
    }
}
