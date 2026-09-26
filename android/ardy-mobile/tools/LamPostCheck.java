package ai.cleo.ardymobile;
import java.nio.file.*;
import org.json.*;
public final class LamPostCheck {
    public static void main(String[] args)throws Exception {
        LamPostprocess processor=new LamPostprocess(new JSONObject(Files.readString(Path.of(args[0]))));
        JSONArray chunks=new JSONArray(Files.readString(Path.of(args[1])));double max=0;int frames=0;
        for(int c=0;c<chunks.length();c++) {
            JSONObject chunk=chunks.getJSONObject(c);JSONArray raw=chunk.getJSONArray("raw"),expected=chunk.getJSONArray("expected");
            float[][] input=new float[raw.length()][52];float[] volume=new float[raw.length()];
            for(int f=0;f<input.length;f++){volume[f]=(float)chunk.getJSONArray("volume").getDouble(f);for(int j=0;j<52;j++)input[f][j]=(float)raw.getJSONArray(f).getDouble(j);}
            float[][] actual=processor.process(input,volume,false);
            for(int f=0;f<input.length;f++)for(int j=0;j<52;j++)max=Math.max(max,Math.abs(actual[f][j]-expected.getJSONArray(f).getDouble(j)));
            frames+=input.length;
        }
        if(max>2e-6)throw new AssertionError("LAM postprocessing differs: "+max);
        JSONObject report=new JSONObject().put("passed",true).put("device","Windows JVM").put("phoneTest",false)
            .put("chunks",chunks.length()).put("frames",frames).put("maxAbsError",max)
            .put("limits","Matches desktop silence/blending/Savitzky-Golay/symmetry. Stochastic blink sequences excluded.");
        Files.writeString(Path.of(args[2]),report.toString(2)+"\n");System.out.println(report);
    }
}
