package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import java.util.*;
import org.json.*;

/** Production parser, geometry and prompt checks; no Android or model inference. */
public final class BrowserTargetCheck {
    static int cases;
    static void check(boolean value,String message){cases++;if(!value)throw new AssertionError(message);}
    static JSONObject click(double top,double left,double bottom,double right)throws Exception{return new JSONObject().put("action","click").put("box_2d",new JSONArray(new double[]{top,left,bottom,right}));}
    static void near(double actual,double expected,String name){check(Math.abs(actual-expected)<.001,name+": "+actual+" != "+expected);}
    static void reject(JSONObject value)throws Exception{try{BrowserAction.parse(value.toString());throw new AssertionError("Invalid box accepted: "+value);}catch(IOException|JSONException expected){cases++;}}
    public static void main(String[] args)throws Exception {
        BrowserTarget.Viewport portrait=new BrowserTarget.Viewport(25,170,400,800,0,1500,7);
        JSONObject action=BrowserAction.parse(click(50,750,112.5,900).toString());
        BrowserTarget.Pixels p=BrowserTarget.project(action,portrait);
        near(p.left(),300,"left");near(p.top(),40,"top");near(p.right(),360,"right");near(p.bottom(),90,"bottom");near(p.x(),330,"tap x");near(p.y(),65,"tap y");
        // View/window position and document scrolling must not enter viewport-local tap coordinates.
        check(p.equals(BrowserTarget.project(action,new BrowserTarget.Viewport(600,1200,400,800,99,9000,8))),"Window or page offset was added to target");
        for(int[] size:new int[][]{{1080,600},{400,800},{1200,360},{987,531}}){
            BrowserTarget.Viewport view=new BrowserTarget.Viewport(1,2,size[0],size[1],0,0,1);
            for(int[] corner:new int[][]{{0,0},{0,900},{900,0},{900,900}}){
                BrowserTarget.Pixels box=BrowserTarget.project(click(corner[0],corner[1],corner[0]+100,corner[1]+100),view);
                near(box.x(),(corner[1]+50)*size[0]/1000.0,"corner x");near(box.y(),(corner[0]+50)*size[1]/1000.0,"corner y");
            }
        }
        reject(new JSONObject().put("action","click").put("box",new JSONArray(new int[]{0,0,100,100})));
        reject(click(0,0,1,1));reject(click(50,900,100,800));reject(click(100,100,50,200));reject(click(0,0,1001,100));
        reject(new JSONObject().put("action","click").put("box_2d",new JSONArray(List.of("10",20,30,40))));
        boolean tiny=false;try{BrowserTarget.project(click(10,10,10.1,10.1),portrait);}catch(IOException expected){tiny=true;}check(tiny,"Subpixel target accepted");
        for(BrowserTarget.Viewport changed:List.of(new BrowserTarget.Viewport(26,170,400,800,0,1500,7),new BrowserTarget.Viewport(25,170,800,400,0,1500,7),new BrowserTarget.Viewport(25,170,400,800,0,1501,7),new BrowserTarget.Viewport(25,170,400,800,0,1500,8)))check(!portrait.equals(changed),"Stale geometry accepted");
        String prompt=BrowserPrompt.build("Find the menu","","https://example.test",portrait);
        check(prompt.contains("[top, left, bottom, right]")&&prompt.contains("box_2d"),"Prompt and parser disagree");check(prompt.contains("400 pixels wide by 800 pixels high"),"Prompt does not describe the captured image");
        System.out.println(new JSONObject().put("passed",true).put("modelInference",false).put("phoneTest",false).put("checks",cases).put("gemmaYxyx",true).put("asymmetricTarget",p.json()).put("viewport",portrait.json()).put("oldAmbiguousBoxRejected",true).put("viewportChangesRejected",true));
    }
}
