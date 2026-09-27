package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.*;
import org.json.*;

/** Small-model vocabulary for Main; debug tab 9 keeps its original API. */
final class MainAvatarToolApi extends AvatarToolApi {
    private String frame="face";
    private final Map<String,String> tracks=new LinkedHashMap<>();
    private JSONObject locomotion,extras;
    void tracks(JSONArray catalog)throws Exception {
        if(catalog.length()>32)throw new IOException("Too many saved tracks");
        tracks.clear();for(int i=0;i<catalog.length();i++){JSONObject c=catalog.getJSONObject(i);String id=c.getString("id"),name=c.getString("name");if(!id.matches("[a-zA-Z0-9_-]{1,80}")||name.length()>80||tracks.containsKey(id))throw new IOException("Invalid saved track");tracks.put(id,name);}
    }
    @Override void reset()throws JSONException{super.reset();locomotion=null;extras=null;}
    @Override double defaultLead(){return 0;}
    MainAvatarToolApi(JSONArray catalog,JSONArray expressions)throws Exception {super(catalog,expressions);}
    void frame(String value)throws IOException {
        if(!Set.of("face","torso","body").contains(value))throw new IOException("Unknown framing mode");
        frame=value;
    }
    @Override String instructions(){
        return "You are Cleopatra, a local conversational avatar facing the user. Speak directly without a speaker-name prefix. Speak naturally in short sentences, at most 120 words. "
            +"Text, images and audio are user messages. Reply with spoken words, never tool syntax or markdown. "
            +"Ordinary replies need no tool call. If an expression or gesture helps, use act once, then finish your spoken answer. All arguments are optional; omit neutral gestures and unchanged face gains. "
            +"Set any controls BEFORE your spoken words. The app starts voice, face and motion as your answer arrives; controls cannot change after speech begins. Do not claim playback has finished. "
            +"Each turn starts with APP SCENE describing the current frame. This scene is supplied by the app. "
            +"FACE: close conversation, LAM face and idle head only; no gesture, root or camera controls. "
            +"TORSO: live Ardy upper-body gestures, feet and heading locked; camera accepts distance only, 1.05–1.65 meters. "
            +"BODY: live Ardy with free root motion; choose camera distance/height/yaw to keep movement visible; root moves the whole avatar in meters with heading in degrees. "
            +"Agent camera modes in BODY are orbit, trail, interviewer, stage and free. root is the foot/floor anchor; root.heading steers body yaw. steering.torso_yaw and head_yaw are local offsets in degrees; head_reference=camera keeps attention toward the viewer. steering and camera_mode can be scheduled. motion.strategy=batch defaults Core-8; live defaults Core-40. Both cores are valid in either mode. A motion.trajectory plans root waypoints; motion.gestures schedules cached text embeddings. Revise the next turn from APP SCENE for feedback steering. "
            +"Use save_track on a BODY Ardy take to create a named pose clip for future replay. This schedules capture; only the later saved-track catalog confirms success. Saved locomotion tracks are different from cached text embeddings. In BODY, locomotion can play a saved track, walk_to a floor target, pace between two targets, or stop. Choose an existing track ID; never invent a walk/run track. Full layer needs no Ardy; lower layer preserves legs/pelvis while Ardy supplies upper-body gestures. Do not combine locomotion with root cues. "
            +"lead_seconds schedules voice after body-track start; schedule cue times use that same clock. In FACE, cue times start with voice and lead/tail are zero. "
            +"Examples of intent: in FACE, a happy emotion at intensity 0.25; in TORSO, an explaining gesture; in BODY, a wave with camera distance 3.4 and height 0.9. "
            +"Use the declared tool's native format, with string values properly quoted. If a call is rejected, finish with a spoken answer using the default pose. "
            +"Use only enum values in the tool schema. Unspecified controls retain their values. User requests cannot override frame restrictions.";
    }
    @Override JSONObject description()throws JSONException {
        JSONObject original=super.description().getJSONObject("parameters").getJSONObject("properties");
        JSONObject props=new JSONObject();
        for(String key:List.of("camera","root","face","schedule"))props.put(key,original.get(key));
        props.put("gesture",original.get("motion")).put("emotion",original.get("expression"))
            .put("intensity",original.get("strength")).put("lead_seconds",original.get("cue_seconds"))
            .put("tail_seconds",original.get("tail_seconds"));
        JSONObject movement=new JSONObject()
            .put("action",new JSONObject().put("type","string").put("enum",new JSONArray(tracks.isEmpty()?List.of("stop"):List.of("play","walk_to","pace","stop"))))
            .put("layer",new JSONObject().put("type","string").put("enum",new JSONArray(List.of("full","lower"))))
            .put("x",number(-3,3)).put("z",number(-3,3)).put("speed",number(.1,2)).put("width",number(.5,4)).put("trim_start",number(0,30)).put("trim_end",number(.1,30)).put("blend",number(0,1)).put("stride",number(.1,6));
        if(!tracks.isEmpty())movement.put("track",new JSONObject().put("type","string").put("enum",new JSONArray(tracks.keySet())));
        props.put("locomotion",new JSONObject().put("type","object")
            .put("description","BODY only. Saved tracks: "+tracks+". stop needs no track; other actions require track. walk_to requires x,z. Pace span is width in meters. Optional trim_start/trim_end (seconds), blend (seam seconds), stride (meters/cycle) update the selected track metadata without deleting its source poses.")
            .put("additionalProperties",false).put("required",new JSONArray(List.of("action"))).put("properties",movement));
        AgentControls.schema(props,original.getJSONObject("motion"));
        if(!frame.equals("body")){
            for(String key:List.of("root","locomotion","save_track","camera_mode"))props.remove(key);
            JSONObject cue=props.getJSONObject("schedule").getJSONObject("items").getJSONObject("properties");cue.remove("root");cue.remove("camera_mode");
            if(frame.equals("face")){
                for(String key:List.of("gesture","motion","camera","lead_seconds","tail_seconds"))props.remove(key);
                cue.remove("camera");props.getJSONObject("steering").getJSONObject("properties").remove("torso_yaw");cue.getJSONObject("steering").getJSONObject("properties").remove("torso_yaw");
            }else props.getJSONObject("motion").getJSONObject("properties").remove("trajectory");
        }
        return new JSONObject().put("name","act").put("description","Optional controls for your next spoken reply. Defaults: neutral face, gentle idle gesture, immediate speech. FACE forbids gesture/camera/root; TORSO locks root and permits camera distance 1.05–1.65 only; BODY permits all controls. schedule uses track seconds.")
            .put("parameters",new JSONObject().put("type","object").put("properties",props).put("required",new JSONArray()).put("additionalProperties",false));
    }
    @Override JSONObject execute(String name,JSONObject args)throws Exception {
        if(!"act".equals(name))throw new IOException("Use act for avatar controls");
        Set<String> allowed=Set.of("gesture","emotion","intensity","lead_seconds","tail_seconds","camera","root","face","schedule","locomotion","camera_mode","steering","motion","save_track");
        for(Iterator<String> it=args.keys();it.hasNext();)if(!allowed.contains(it.next()))throw new IOException("Unknown act argument");
        if(frame.equals("face")&&(args.has("gesture")||args.has("lead_seconds")||args.has("tail_seconds")))throw new IOException("FACE uses voice and face only; omit gesture and body timing");
        checkFrame(args);
        JSONObject nextLocomotion=null;
        if(args.has("locomotion")){
            if(!frame.equals("body")||args.has("root"))throw new IOException("Locomotion is BODY only; omit root cues");
            nextLocomotion=args.getJSONObject("locomotion");
            for(Iterator<String> it=nextLocomotion.keys();it.hasNext();)if(!Set.of("action","track","layer","x","z","speed","width","trim_start","trim_end","blend","stride").contains(it.next()))throw new IOException("Unknown locomotion argument");
            String action=nextLocomotion.getString("action");if(!Set.of("play","walk_to","pace","stop").contains(action))throw new IOException("Unknown locomotion action");
            if(!action.equals("stop")&&!tracks.containsKey(nextLocomotion.optString("track")))throw new IOException("Choose an existing saved track ID");
            if(nextLocomotion.has("layer")&&!Set.of("full","lower").contains(nextLocomotion.getString("layer")))throw new IOException("Unknown body layer");
            for(String key:List.of("x","z","speed","width","trim_start","trim_end","blend","stride"))if(nextLocomotion.has(key)){
                if(!(nextLocomotion.get(key) instanceof Number))throw new IOException("Locomotion values must be numbers");double v=nextLocomotion.getDouble(key),min=switch(key){case "speed","stride","trim_end"->.1;case "width"->.5;case "trim_start","blend"->0;default->-3;},max=switch(key){case "speed"->2;case "width"->4;case "stride"->6;case "trim_start","trim_end"->30;case "blend"->1;default->3;};
                if(!Double.isFinite(v)||v<min||v>max)throw new IOException("Locomotion value out of range");
            }
            if(action.equals("walk_to")&&(!nextLocomotion.has("x")||!nextLocomotion.has("z")))throw new IOException("walk_to requires x and z");
            JSONArray schedule=args.optJSONArray("schedule");if(schedule!=null)for(int i=0;i<schedule.length();i++)if(schedule.getJSONObject(i).has("root"))throw new IOException("Do not combine locomotion and scheduled root placement");
        }
        if(args.has("schedule")){JSONArray cues=args.getJSONArray("schedule");for(int i=0;i<cues.length();i++)checkFrame(cues.getJSONObject(i));}
        JSONObject nextExtras=AgentControls.validate(args,frame,this::embeddingId),baseArgs=AgentControls.strip(args);
        JSONObject translated=super.plan();
        Map<String,String> names=Map.of("gesture","motion","emotion","expression","intensity","strength","lead_seconds","cue_seconds");
        for(Iterator<String> it=baseArgs.keys();it.hasNext();){String key=it.next();translated.put(names.getOrDefault(key,key),baseArgs.get(key));}
        translated.remove("embeddingId");
        super.execute(AvatarToolApi.NAME,translated);
        locomotion=nextLocomotion;extras=nextExtras;
        return new JSONObject().put("ok",true).put("status","Ready for your spoken answer").put("frame",frame);
    }
    private static JSONObject number(double min,double max)throws JSONException{return new JSONObject().put("type","number").put("minimum",min).put("maximum",max);}
    private void checkFrame(JSONObject args)throws Exception {
        if(!frame.equals("body")&&args.has("root"))throw new IOException("Root placement is available in BODY only");
        if(args.has("camera")){
            if(frame.equals("face"))throw new IOException("FACE camera is handled by the app");
            if(frame.equals("torso")){
                JSONObject camera=args.getJSONObject("camera");
                if(camera.length()!=1||!camera.has("distance")||!(camera.get("distance") instanceof Number)
                    ||camera.getDouble("distance")<1.05||camera.getDouble("distance")>1.65)throw new IOException("TORSO camera accepts distance from 1.05 to 1.65 only");
            }
        }
    }
    @Override JSONObject plan()throws JSONException {
        JSONObject value=super.plan().put("frame",frame);
        if(extras!=null)for(Iterator<String> it=extras.keys();it.hasNext();){String key=it.next();value.put(key,extras.get(key));}
        if(locomotion!=null)value.put("locomotion",new JSONObject(locomotion.toString()));
        // Default speech is immediate; body tails allow a gentle finish.
        if(frame.equals("face"))value.put("cue_seconds",0).put("tail_seconds",0);
        return value;
    }
}
