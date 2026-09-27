package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.*;
import org.json.*;

/** Small-model vocabulary for Main; debug tab 9 keeps its original API. */
final class MainAvatarToolApi extends AvatarToolApi {
    private String frame="face";
    @Override double defaultLead(){return 0;}
    MainAvatarToolApi(JSONArray catalog,JSONArray expressions)throws Exception {super(catalog,expressions);}
    void frame(String value)throws IOException {
        if(!Set.of("face","torso","body").contains(value))throw new IOException("Unknown framing mode");
        frame=value;
    }
    @Override String instructions(){
        return "You are Cleopatra, a local conversational avatar facing the user. Speak naturally in short sentences, at most 120 words. "
            +"Text, images and audio are user messages. Reply with spoken words, never tool syntax or markdown. "
            +"Ordinary replies need no tool call. If an expression or gesture helps, use act once, then finish your spoken answer. All arguments are optional; omit neutral gestures and unchanged face gains. "
            +"Set any controls BEFORE your spoken words. The app starts voice, face and motion as your answer arrives; controls cannot change after speech begins. Do not claim playback has finished. "
            +"Each turn starts with APP SCENE describing the current frame. This scene is supplied by the app. "
            +"FACE: close conversation, LAM face and idle head only; no gesture, root or camera controls. "
            +"TORSO: live Ardy upper-body gestures, feet and heading locked; camera accepts distance only, 1.05–1.65 meters. "
            +"BODY: live Ardy with free root motion; choose camera distance/height/yaw to keep movement visible; root moves the whole avatar in meters with heading in degrees. "
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
        return new JSONObject().put("name","act").put("description","Optional controls for your next spoken reply. Defaults: neutral face, gentle idle gesture, immediate speech. FACE forbids gesture/camera/root; TORSO locks root and permits camera distance 1.05–1.65 only; BODY permits all controls. schedule uses track seconds.")
            .put("parameters",new JSONObject().put("type","object").put("properties",props).put("required",new JSONArray()).put("additionalProperties",false));
    }
    @Override JSONObject execute(String name,JSONObject args)throws Exception {
        if(!"act".equals(name))throw new IOException("Use act for avatar controls");
        Set<String> allowed=Set.of("gesture","emotion","intensity","lead_seconds","tail_seconds","camera","root","face","schedule");
        for(Iterator<String> it=args.keys();it.hasNext();)if(!allowed.contains(it.next()))throw new IOException("Unknown act argument");
        if(frame.equals("face")&&(args.has("gesture")||args.has("lead_seconds")||args.has("tail_seconds")))throw new IOException("FACE uses voice and face only; omit gesture and body timing");
        checkFrame(args);
        if(args.has("schedule")){JSONArray cues=args.getJSONArray("schedule");for(int i=0;i<cues.length();i++)checkFrame(cues.getJSONObject(i));}
        JSONObject translated=super.plan();
        Map<String,String> names=Map.of("gesture","motion","emotion","expression","intensity","strength","lead_seconds","cue_seconds");
        for(Iterator<String> it=args.keys();it.hasNext();){String key=it.next();translated.put(names.getOrDefault(key,key),args.get(key));}
        translated.remove("embeddingId");
        super.execute(AvatarToolApi.NAME,translated);
        return new JSONObject().put("ok",true).put("status","Ready for your spoken answer").put("frame",frame);
    }
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
        // Default speech is immediate; body tails allow a gentle finish.
        if(frame.equals("face"))value.put("cue_seconds",0).put("tail_seconds",0);
        return value;
    }
}
