package ai.cleo.ardymobile;

import java.util.*;
import org.json.*;

/** Desktop LAM silence/blending/SG/symmetry pipeline; stochastic blinks use a local seeded RNG. */
public final class LamPostprocess {
    private final int[] mouth;
    private final int[][] pairs;
    private float[][] previous=new float[0][52];
    private float[] previousVolume=new float[0];
    private final Random random=new Random(42);
    private static final float[][] BLINKS={{.365f,.950f,.956f,.917f,.367f,.119f,.025f},{.235f,.910f,.945f,.778f,.191f,.235f,.089f},
        {.870f,.950f,.949f,.696f,.191f,.073f,.007f},{0,.557f,.953f,.942f,.426f,.148f,.018f}};
    public LamPostprocess(JSONObject metadata) throws Exception {
        JSONArray m=metadata.getJSONArray("mouthIndices");mouth=new int[m.length()];for(int i=0;i<m.length();i++)mouth[i]=m.getInt(i);
        JSONArray p=metadata.getJSONArray("symmetricPairs");pairs=new int[p.length()][2];
        for(int i=0;i<p.length();i++){pairs[i][0]=p.getJSONArray(i).getInt(0);pairs[i][1]=p.getJSONArray(i).getInt(1);}
    }
    public void reset(){previous=new float[0][52];previousVolume=new float[0];random.setSeed(42);}
    public float[][] process(float[][] raw,float[] volumes,boolean blinks) {
        int processed=previous.length,n=processed+raw.length;
        float[][] all=new float[n][52];float[] volume=new float[n];
        for(int f=0;f<processed;f++){all[f]=previous[f].clone();volume[f]=previousVolume[f];}
        for(int f=0;f<raw.length;f++){all[processed+f]=raw[f].clone();volume[processed+f]=volumes[f];}
        // Match find_low_value_regions' consecutive-index counter, including its first-region offset.
        ArrayList<Integer> low=new ArrayList<>();for(int f=0;f<n;f++)if(volume[f]<.001f)low.add(f);
        int count=0,start=0;
        for(int i=1;i<low.size();i++) {
            if(low.get(i)!=low.get(i-1)+1){if(count>=7)silence(all,low.get(start),low.get(i-1),processed);start=i;count=0;}
            count++;
        }
        if(count>=7)silence(all,low.get(start),low.get(low.size()-1),processed);
        int blend=Math.min(processed>0?5:3,raw.length);
        float[] reference=processed>0?all[processed-1].clone():new float[52];
        for(int f=0;f<blend;f++){float weight=(f+1f)/(blend+1f);mix(all[processed+f],reference,weight);}
        float[][] smooth=new float[n][52];int[] weights={-3,12,17,12,-3};
        for(int f=0;f<n;f++)for(int j=0;j<52;j++) {
            double value=0;for(int k=-2;k<=2;k++)value+=all[mirror(f+k,n)][j]*weights[k+2];
            smooth[f][j]=clamp((float)(value/35));
        }
        for(int[] pair:pairs)for(float[] frame:smooth){float mean=(frame[pair[0]]+frame[pair[1]])*.5f;frame[pair[0]]=mean;frame[pair[1]]=mean;}
        if(blinks&&raw.length>7) {
            int last=processed;for(int f=0;f<processed;f++)if(smooth[f][8]>.5f)last=f-7;
            int first=Math.max(0,40+random.nextInt(60)-last);
            if(first<=raw.length-7) {
                blink(smooth,processed+first);
                int remaining=n-(processed+first+7);
                if(remaining>40){float intensity=.8f+random.nextFloat()*.2f;int interval=40+random.nextInt(60);
                    if(remaining-7>interval)blink(smooth,processed+first+7+interval,intensity);}
            }
        }
        float[][] output=Arrays.copyOfRange(smooth,processed,n);
        int keep=Math.min(64,n);previous=Arrays.copyOfRange(smooth,n-keep,n);previousVolume=Arrays.copyOfRange(volume,n-keep,n);
        return output;
    }
    private void silence(float[][] frames,int start,int end,int processed) {
        for(int f=start;f<=end;f++)for(int j:mouth)frames[f][j]*=.1f;
        int length=Math.min(3,start-processed);
        if(length>0){float[] reference=frames[start-1].clone();for(int i=0;i<length;i++)mix(frames[start+i],reference,(i+1f)/(length+1f));}
        length=Math.min(3,frames.length-end-1);
        if(length>0){float[] reference=frames[end+1].clone();for(int i=0;i<length;i++)mix(frames[end-i],reference,(i+1f)/(length+1f));}
    }
    private void blink(float[][] frames,int start){blink(frames,start,.8f+random.nextFloat()*.2f);}
    private void blink(float[][] frames,int start,float intensity){float[] p=BLINKS[random.nextInt(BLINKS.length)];for(int i=0;i<7;i++)frames[start+i][8]=frames[start+i][9]=p[i]*intensity;}
    private static void mix(float[] frame,float[] reference,float weight){for(int j=0;j<52;j++)frame[j]=reference[j]*(1-weight)+frame[j]*weight;}
    private static int mirror(int index,int count){if(count==1)return 0;while(index<0||index>=count)index=index<0?-index:2*count-2-index;return index;}
    private static float clamp(float value){return Math.max(0,Math.min(1,value));}
}
