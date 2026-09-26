package ai.cleo.ardyavatarvalidation;

import java.util.*;
import org.json.*;

/** CTC trellis/backtracking following WhisperX alignment.py (BSD-2-Clause).
 * Unalignable words retain text with no fabricated timestamps. */
final class WhisperXAlignment {
    static JSONArray align(float[][] logits,String text,JSONObject vocabulary,double offset,double seconds)throws JSONException {
        String[] words=text.trim().split("\\s+");List<Integer> tokens=new ArrayList<>(),owners=new ArrayList<>();
        for(int w=0;w<words.length;w++){
            if(w>0){tokens.add(vocabulary.getInt("|"));owners.add(-1);}
            for(char ch:words[w].toUpperCase(Locale.ROOT).toCharArray()){String key=String.valueOf(ch);if(vocabulary.has(key)){tokens.add(vocabulary.getInt(key));owners.add(w);}}
        }
        int frames=logits.length,n=tokens.size();JSONArray result=new JSONArray();
        if(n==0||n>frames||(long)n*frames>4000000){for(String word:words)result.put(new JSONObject().put("word",word));return result;}
        float[][] emission=new float[frames][];
        for(int t=0;t<frames;t++){float max=Float.NEGATIVE_INFINITY;for(float v:logits[t])max=Math.max(max,v);double sum=0;for(float v:logits[t])sum+=Math.exp(v-max);double log=Math.log(sum)+max;emission[t]=new float[logits[t].length];for(int k=0;k<logits[t].length;k++)emission[t][k]=(float)(logits[t][k]-log);}
        float[][] trellis=new float[frames+1][n+1];for(float[] row:trellis)Arrays.fill(row,Float.NEGATIVE_INFINITY);trellis[0][0]=0;
        int blank=vocabulary.getInt("<pad>");
        for(int t=0;t<frames;t++){
            trellis[t+1][0]=trellis[t][0]+emission[t][blank];
            for(int j=1;j<=n;j++)trellis[t+1][j]=Math.max(trellis[t][j]+emission[t][blank],trellis[t][j-1]+emission[t][tokens.get(j-1)]);
        }
        int end=0;for(int t=1;t<=frames;t++)if(trellis[t][n]>trellis[end][n])end=t;
        int[] starts=new int[words.length],ends=new int[words.length],counts=new int[words.length];double[] scores=new double[words.length];Arrays.fill(starts,Integer.MAX_VALUE);
        int j=n;
        for(int t=end;t>0&&j>0;t--){
            boolean change=trellis[t-1][j-1]+emission[t-1][tokens.get(j-1)]>trellis[t-1][j]+emission[t-1][blank];
            int owner=owners.get(j-1);if(owner>=0){starts[owner]=Math.min(starts[owner],t-1);ends[owner]=Math.max(ends[owner],t);scores[owner]+=Math.exp(emission[t-1][change?tokens.get(j-1):blank]);counts[owner]++;}
            if(change)j--;
        }
        for(int w=0;w<words.length;w++){JSONObject word=new JSONObject().put("word",words[w]);if(j==0&&counts[w]>0)word.put("start",offset+starts[w]*seconds/frames).put("end",offset+ends[w]*seconds/frames).put("score",scores[w]/counts[w]);result.put(word);}
        return result;
    }
}
