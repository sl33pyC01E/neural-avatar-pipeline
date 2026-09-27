package ai.cleo.ardyavatarvalidation;

import java.io.IOException;
import org.json.*;

/** Gemma's normalized YXYX boundary. Convert to display/touch XY only here. */
final class BrowserTarget {
    record Pixels(float left,float top,float right,float bottom) {
        float x(){return (left+right)/2;}
        float y(){return (top+bottom)/2;}
        JSONObject json()throws JSONException{return new JSONObject().put("left",left).put("top",top).put("right",right).put("bottom",bottom).put("tapX",x()).put("tapY",y());}
    }
    record Viewport(int x,int y,int width,int height,int scrollX,int scrollY,int revision) {
        Viewport {if(width<1||height<1)throw new IllegalArgumentException("Invalid viewport dimensions");}
        JSONObject json()throws JSONException{return new JSONObject().put("windowX",x).put("windowY",y).put("width",width).put("height",height).put("scrollX",scrollX).put("scrollY",scrollY).put("revision",revision);}
    }
    static double[] coordinates(JSONObject action)throws Exception {
        if(action.has("box"))throw new IOException("Ambiguous box format. Use box_2d: [top,left,bottom,right] on a 0–1000 grid.");
        JSONArray box=action.getJSONArray("box_2d");if(box.length()!=4)throw new IOException("box_2d requires [top,left,bottom,right]");
        double[] v=new double[4];for(int i=0;i<4;i++){
            if(!(box.get(i) instanceof Number))throw new IOException("Coordinates must be numbers");
            v[i]=box.getDouble(i);if(!Double.isFinite(v[i])||v[i]<0||v[i]>1000)throw new IOException("Box is outside the viewport");
        }
        if(v[2]<=v[0]||v[3]<=v[1])throw new IOException("Empty click box");
        if(v[2]<=1&&v[3]<=1)throw new IOException("Use 0–1000 coordinates, not 0–1 fractions");
        return v;
    }
    static Pixels project(JSONObject action,Viewport view)throws Exception {
        double[] v=coordinates(action);
        Pixels p=new Pixels((float)(v[1]*view.width()/1000),(float)(v[0]*view.height()/1000),
            (float)(v[3]*view.width()/1000),(float)(v[2]*view.height()/1000));
        if(p.right()-p.left()<2||p.bottom()-p.top()<2)throw new IOException("Target is smaller than two screenshot pixels; inspect again");
        return p;
    }
}
