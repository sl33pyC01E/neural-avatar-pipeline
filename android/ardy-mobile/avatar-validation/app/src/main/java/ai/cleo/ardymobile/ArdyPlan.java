package ai.cleo.ardymobile;

import java.io.IOException;
import java.util.*;
import org.json.*;

/** A bounded turn plan. Root samples are world meters before sampler recentering. */
public final class ArdyPlan {
    public final String core,strategy;
    public final double batchSeconds;
    public final List<double[]> path=new ArrayList<>();
    public final List<double[]> cueTimes=new ArrayList<>();
    public final List<String> embeddings=new ArrayList<>();
    public ArdyPlan(JSONObject value)throws Exception{
        core=value.optString("core","core40");strategy=value.optString("strategy","live");batchSeconds=value.optDouble("batch_seconds",6);
        if(!Set.of("core8","core40").contains(core)||!Set.of("live","batch").contains(strategy)||!Double.isFinite(batchSeconds)||batchSeconds<2||batchSeconds>20)throw new IOException("Invalid Ardy strategy");
        JSONArray trajectory=value.optJSONArray("trajectory");double previous=-1;
        if(trajectory!=null){if(trajectory.length()>24)throw new IOException("At most 24 root waypoints");for(int i=0;i<trajectory.length();i++){
            JSONObject point=trajectory.getJSONObject(i);double t=number(point,"at_seconds",0,30),x=number(point,"x",-3,3),z=number(point,"z",-3,3),heading=number(point,"heading",-180,180);
            if(t<=previous||(i==0&&t!=0))throw new IOException("Trajectory begins at 0 with increasing times");previous=t;path.add(new double[]{t,x,z,heading});
        }}
        JSONArray gestures=value.optJSONArray("gestures");previous=-1;
        if(gestures!=null){if(gestures.length()>12)throw new IOException("At most 12 gestures");for(int i=0;i<gestures.length();i++){
            JSONObject cue=gestures.getJSONObject(i);double time=number(cue,"at_seconds",0,30);String id=cue.getString("embeddingId");
            if(time<previous||!id.matches("(bank|saved):[a-zA-Z0-9_-]{1,100}"))throw new IOException("Invalid gesture cue");previous=time;cueTimes.add(new double[]{time});embeddings.add(id);
        }}
    }
    private static double number(JSONObject obj,String key,double min,double max)throws Exception{if(!(obj.get(key) instanceof Number))throw new IOException(key+" must be numeric");double v=obj.getDouble(key);if(!Double.isFinite(v)||v<min||v>max)throw new IOException(key+" out of range");return v;}
    public float[] root(double time){
        if(path.isEmpty())return null;double[] a=path.get(0),b=a;
        for(double[] p:path){b=p;if(p[0]>=time)break;a=p;}
        double t=b[0]==a[0]?1:Math.max(0,Math.min(1,(time-a[0])/(b[0]-a[0])));t=t*t*(3-2*t);
        double yaw=((b[3]-a[3]+540)%360+360)%360-180;
        return new float[]{(float)(a[1]+(b[1]-a[1])*t),(float)(a[2]+(b[2]-a[2])*t),(float)((a[3]+yaw*t)*Math.PI/180)};
    }
    public String embedding(double time,String fallback){String id=fallback;for(int i=0;i<cueTimes.size()&&cueTimes.get(i)[0]<=time;i++)id=embeddings.get(i);return id;}
}
