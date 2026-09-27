package ai.cleo.ardyavatarvalidation;

import ai.cleo.ardymobile.ArdyPlan;
import java.io.IOException;
import java.util.*;
import org.json.*;

/** Small, frame-aware vocabulary for camera, gaze and planned Ardy generation. */
final class AgentControls {
    static final Set<String> EXTRA=Set.of("camera_mode","steering","motion","save_track");
    interface Embedding {String resolve(String gesture)throws IOException;}
    private static JSONObject enumeration(String... choices)throws JSONException{return new JSONObject().put("type","string").put("enum",new JSONArray(List.of(choices)));}
    private static JSONObject number(double min,double max)throws JSONException{return new JSONObject().put("type","number").put("minimum",min).put("maximum",max);}
    private static JSONObject object(JSONObject props,String... required)throws JSONException{return new JSONObject().put("type","object").put("properties",props).put("additionalProperties",false).put("required",new JSONArray(List.of(required)));}
    static JSONObject steering()throws JSONException{return object(new JSONObject().put("torso_yaw",number(-60,60)).put("head_yaw",number(-70,70)).put("head_reference",enumeration("body","camera")));}
    static JSONObject cameraMode()throws JSONException{return enumeration("orbit","trail","interviewer","stage","free").put("description","BODY camera presets: orbit around avatar; trail behind heading; interviewer close and at eye level; stage centered; free holds target. Combine camera numeric fields for offsets.");}
    static void schema(JSONObject props,JSONObject gesture)throws JSONException{
        props.put("camera_mode",cameraMode()).put("steering",steering());
        JSONObject motion=object(new JSONObject().put("core",enumeration("core8","core40")).put("strategy",enumeration("batch","live"))
            .put("batch_seconds",number(2,20)).put("trajectory",new JSONObject().put("type","array").put("maxItems",24).put("items",object(new JSONObject().put("at_seconds",number(0,30)).put("x",number(-3,3)).put("z",number(-3,3)).put("heading",number(-180,180)),"at_seconds","x","z","heading")))
            .put("gestures",new JSONObject().put("type","array").put("maxItems",12).put("items",object(new JSONObject().put("at_seconds",number(0,30)).put("gesture",gesture),"at_seconds","gesture"))));
        motion.put("description","ARDY generation plan. Default live/Core-40; batch defaults Core-8 and prepares batch_seconds (6 by default) before speech. Trajectory: relative to current floor anchor, first at_seconds=0, strictly increasing. Root waypoints are interpolation constraints, not teleports. Gestures switch on generated horizon boundaries (Core-8 0.4s, Core-40 2s). Audio beyond the initial batch extends generation. Revise next turn for feedback steering.");
        props.put("motion",motion);
        props.put("save_track",object(new JSONObject().put("name",new JSONObject().put("type","string").put("minLength",1).put("maxLength",80)).put("seconds",number(2,12)).put("blend",number(0,1)).put("stride",number(.1,6)),"name").put("description","Capture this BODY Ardy take to the local pose library, up to seconds (default 12) or the spoken take end. The track appears in APP SCENE on a later turn; scheduling is not proof it was saved. No inference on later full-track replay."));
        JSONObject cue=props.getJSONObject("schedule").getJSONObject("items").getJSONObject("properties");cue.put("steering",steering()).put("camera_mode",cameraMode());
    }
    static JSONObject validate(JSONObject args,String frame,Embedding resolver)throws Exception{
        JSONObject extra=new JSONObject();validateCue(args,frame);
        for(String key:List.of("camera_mode","steering"))if(args.has(key))extra.put(key,args.get(key));
        if(args.has("schedule")){
            JSONArray cues=args.getJSONArray("schedule");if(cues.length()>12)throw new IOException("At most 12 cues");double previous=-1;
            for(int i=0;i<cues.length();i++){JSONObject cue=cues.getJSONObject(i);double t=bound(cue,"at_seconds",0,30);if(t<previous)throw new IOException("Cues must be chronological");previous=t;
                keys(cue,Set.of("at_seconds","transition_seconds","camera","root","face","expression","strength","steering","camera_mode"));validateCue(cue,frame);if(cue.has("transition_seconds"))bound(cue,"transition_seconds",0,3);
            }extra.put("schedule",new JSONArray(cues.toString()));
        }
        if(args.has("motion")){
            if(frame.equals("face"))throw new IOException("FACE has no Ardy body motion");
            JSONObject motion=new JSONObject(args.getJSONObject("motion").toString());keys(motion,Set.of("core","strategy","batch_seconds","trajectory","gestures"));
            if(!motion.has("core"))motion.put("core",motion.optString("strategy").equals("batch")?"core8":"core40");
            if(motion.has("trajectory")){
                if(!frame.equals("body")||args.has("root")||args.has("locomotion"))throw new IOException("Trajectory requires BODY; do not mix with root placement or cached locomotion");
                JSONArray points=motion.getJSONArray("trajectory");for(int i=0;i<points.length();i++)keys(points.getJSONObject(i),Set.of("at_seconds","x","z","heading"));
                JSONArray schedule=args.optJSONArray("schedule");if(schedule!=null)for(int i=0;i<schedule.length();i++)if(schedule.getJSONObject(i).has("root"))throw new IOException("Trajectory cannot include scheduled root placement");
            }
            JSONArray gestures=motion.optJSONArray("gestures");if(gestures!=null)for(int i=0;i<gestures.length();i++){
                JSONObject cue=gestures.getJSONObject(i);keys(cue,Set.of("at_seconds","gesture"));cue.put("embeddingId",resolver.resolve(cue.getString("gesture")));cue.remove("gesture");
            }
            new ArdyPlan(motion);extra.put("motion_plan",motion);
        }
        if(args.has("save_track")){
            if(!frame.equals("body")||args.has("locomotion"))throw new IOException("Track capture requires a BODY Ardy take, without cached locomotion");
            JSONObject save=args.getJSONObject("save_track");keys(save,Set.of("name","seconds","blend","stride"));String name=save.getString("name").trim();if(name.isEmpty()||name.length()>80)throw new IOException("Track name must be 1–80 characters");
            if(save.has("seconds"))bound(save,"seconds",2,12);if(save.has("blend"))bound(save,"blend",0,1);if(save.has("stride"))bound(save,"stride",.1,6);extra.put("save_track",save);
        }
        return extra;
    }
    private static void validateCue(JSONObject cue,String frame)throws Exception{
        if(cue.has("camera_mode")&&(!frame.equals("body")||!Set.of("orbit","trail","interviewer","stage","free").contains(cue.getString("camera_mode"))))throw new IOException("Camera modes require BODY and a declared preset");
        if(cue.has("steering")){JSONObject values=cue.getJSONObject("steering");keys(values,Set.of("torso_yaw","head_yaw","head_reference"));if(values.length()==0)throw new IOException("Empty steering");
            if(values.has("torso_yaw")){if(frame.equals("face"))throw new IOException("FACE cannot steer torso");bound(values,"torso_yaw",-60,60);}
            if(values.has("head_yaw"))bound(values,"head_yaw",-70,70);
            if(values.has("head_reference")&&!Set.of("body","camera").contains(values.getString("head_reference")))throw new IOException("Unknown head reference");
        }
    }
    static JSONObject strip(JSONObject args)throws Exception{
        JSONObject base=new JSONObject(args.toString());for(String key:EXTRA)base.remove(key);base.remove("locomotion");
        if(base.has("schedule")){JSONArray filtered=new JSONArray(),cues=base.getJSONArray("schedule");for(int i=0;i<cues.length();i++){JSONObject c=new JSONObject(cues.getJSONObject(i).toString());c.remove("steering");c.remove("camera_mode");if(c.has("camera")||c.has("root")||c.has("face")||c.has("expression"))filtered.put(c);}base.put("schedule",filtered);}
        return base;
    }
    private static void keys(JSONObject args,Set<String> allowed)throws IOException{for(Iterator<String> it=args.keys();it.hasNext();)if(!allowed.contains(it.next()))throw new IOException("Unknown agent control");}
    private static double bound(JSONObject args,String key,double min,double max)throws Exception{if(!(args.get(key) instanceof Number))throw new IOException(key+" must be numeric");double v=args.getDouble(key);if(!Double.isFinite(v)||v<min||v>max)throw new IOException(key+" out of range");return v;}
}
