package ai.cleo.ardymobile;

import ai.onnxruntime.*;
import java.nio.FloatBuffer;
import java.util.*;
import org.json.*;

/** Shared Android/JVM CPU inference and postprocessing for aligned LAM windows. */
public final class LamWindow implements AutoCloseable {
    private final OrtEnvironment environment=OrtEnvironment.getEnvironment("ardy-mobile");
    private final OrtSession session;
    private final float[] window=new float[51200],identity={1,0,0,0,0,0,0,0,0,0,0,0};
    private final JSONObject metadata;
    private final LamPostprocess post;
    private long samplesSeen;
    public LamWindow(String model,JSONObject metadata) throws Exception {
        this.metadata=metadata;post=new LamPostprocess(metadata);
        try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()) {
            options.setIntraOpNumThreads(2);options.setInterOpNumThreads(1);
            options.addConfigEntry("session.intra_op.allow_spinning","0");options.addConfigEntry("session.inter_op.allow_spinning","0");
            session=environment.createSession(model,options);
        }
    }
    public void reset(){Arrays.fill(window,0);samplesSeen=0;post.reset();}
    public JSONObject next(float[] pcm,int rate) throws Exception {
        if(rate!=24000||pcm.length<800||pcm.length>24000||pcm.length%800!=0)throw new IllegalArgumentException("LAM expects frame-aligned 24 kHz audio, up to one second");
        System.arraycopy(window,pcm.length,window,0,window.length-pcm.length);
        System.arraycopy(pcm,0,window,window.length-pcm.length,pcm.length);samplesSeen+=pcm.length;
        float[] values;
        try(OnnxTensor audio=OnnxTensor.createTensor(environment,FloatBuffer.wrap(window),new long[]{1,window.length});
            OnnxTensor id=OnnxTensor.createTensor(environment,FloatBuffer.wrap(identity),new long[]{1,12});
            OrtSession.Result output=session.run(Map.of("audio",audio,"identity",id))) {
            FloatBuffer buffer=((OnnxTensor)output.get(0)).getFloatBuffer();values=new float[buffer.remaining()];buffer.get(values);
        }
        if(values.length!=64*52)throw new IllegalStateException("LAM returned an unexpected frame shape");
        int frames=pcm.length/800,start=64-frames;
        float[][] raw=new float[frames][52];float[] volume=new float[frames];
        for(int f=0;f<frames;f++) {
            System.arraycopy(values,(start+f)*52,raw[f],0,52);
            double energy=0;int center=f*800;
            for(int i=center-400;i<center+400;i++)if(i>=0&&i<pcm.length)energy+=pcm[i]*pcm[i];
            volume[f]=(float)Math.sqrt(energy/800);
        }
        float[][] processed=post.process(raw,volume,true);
        return new JSONObject().put("type","face").put("fps",30).put("names",metadata.getJSONArray("names"))
            .put("startSeconds",(samplesSeen-pcm.length)/24000.0).put("frames",new JSONArray(processed));
    }
    @Override public void close(){try{session.close();}catch(OrtException ignored){}}
}
