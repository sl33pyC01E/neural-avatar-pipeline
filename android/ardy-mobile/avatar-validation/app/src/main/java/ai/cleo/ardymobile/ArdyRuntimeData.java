package ai.cleo.ardymobile;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Runtime constants recovered from the installed app. Shared by Android and the CPU check. */
final class ArdyRuntimeData {
    final float[] bindRigInv;
    final int bodyDim;
    final float fps;
    final int genHorizonFrames;
    final float[] globalRootMean;
    final float[] globalRootStd;
    final int influencesPerVertex;
    final int jointCount;
    final int[] jointParents;
    final int latentDim;
    final int[] lbsIndices;
    final float[] lbsWeights;
    final int localRootDim;
    final float[] localRootMean;
    final float[] localRootStd;
    final int maxFrames;
    final int maxTokens;
    final String modelId;
    final String modelLabel;
    final int motionDim;
    final float[] motionMean;
    final float[] motionStd;
    final float[] neutralJoints;
    final int numBaseDiffusionSteps;
    final int numFramesPerToken;
    final int rootDim;
    final int tokenDim;
    final int vertexCount;
    float[] latentMean, latentStd, latentHalfWidth;

    private ArdyRuntimeData(ArdyModelProfile profile, JSONObject meta, float[] motionMean, float[] motionStd, float[] globalRootMean, float[] globalRootStd, float[] localRootMean, float[] localRootStd, float[] bindRigInv, float[] lbsWeights, int[] lbsIndices, float[] neutralJoints, int[] jointParents) {
        this.modelId = meta.optString("modelId", profile.id);
        this.modelLabel = profile.label;
        this.maxTokens = meta.optInt("maxTokens", 16);
        this.maxFrames = meta.optInt("maxFrames", 64);
        this.tokenDim = meta.optInt("tokenDim", 148);
        this.rootDim = meta.optInt("rootDim", 5);
        this.latentDim = meta.optInt("latentDim", 128);
        this.motionDim = meta.optInt("motionDim", 330);
        this.bodyDim = meta.optInt("bodyDim", 325);
        this.localRootDim = meta.optInt("localRootDim", 4);
        this.jointCount = meta.optInt("jointCount", 27);
        this.vertexCount = meta.optInt("vertexCount", 9084);
        this.influencesPerVertex = meta.optInt("influencesPerVertex", 5);
        this.genHorizonFrames = meta.optInt("genHorizonFrames", 8);
        this.numFramesPerToken = meta.optInt("numFramesPerToken", 4);
        this.numBaseDiffusionSteps = meta.optInt("numBaseDiffusionSteps", 10);
        this.fps = (float) meta.optDouble("fps", 20.0d);
        this.motionMean = motionMean;
        this.motionStd = motionStd;
        this.globalRootMean = globalRootMean;
        this.globalRootStd = globalRootStd;
        this.localRootMean = localRootMean;
        this.localRootStd = localRootStd;
        this.bindRigInv = bindRigInv;
        this.lbsWeights = lbsWeights;
        this.lbsIndices = lbsIndices;
        this.neutralJoints = neutralJoints;
        this.jointParents = jointParents;
    }

    static ArdyRuntimeData load(Context context, ArdyModelProfile profile) throws Exception {
        return load(context.getAssets()::open, profile);
    }

    static ArdyRuntimeData load(File directory, ArdyModelProfile profile) throws Exception {
        return load(path -> new FileInputStream(new File(directory, path)), profile);
    }

    private interface Assets { InputStream open(String path) throws IOException; }

    private static ArdyRuntimeData load(Assets assets, ArdyModelProfile profile) throws Exception {
        JSONObject meta = new JSONObject(readText(assets, profile.runtimeAsset));
        ArdyRuntimeData data=new ArdyRuntimeData(profile, meta, readF32(assets, meta.getString("motionMean")), readF32(assets, meta.getString("motionStd")), readF32(assets, meta.getString("globalRootMean")), readF32(assets, meta.getString("globalRootStd")), readF32(assets, meta.getString("localRootMean")), readF32(assets, meta.getString("localRootStd")), readF32(assets, meta.getString("bindRigInv")), readF32(assets, meta.getString("lbsWeights")), readI32(assets, meta.getString("lbsIndices")), readF32(assets, meta.getString("neutralJoints")), readI32(assets, meta.getString("jointParents")));
        JSONObject quant=new JSONObject(readText(assets,"ardy-contract/"+profile.id+".json"));
        data.latentMean=array(quant,"mean",data.latentDim);
        data.latentStd=array(quant,"std",data.latentDim);
        data.latentHalfWidth=array(quant,"halfWidth",data.latentDim);
        for(int i=0;i<data.latentDim;i++)if(data.latentStd[i]<=0||data.latentHalfWidth[i]<=0)throw new IOException("Invalid FSQ scale");
        return data;
    }

    private static float[] array(JSONObject object,String name,int size)throws Exception {
        org.json.JSONArray values=object.getJSONArray(name);
        if(values.length()!=size)throw new IOException("Invalid FSQ dimensions");
        float[] out=new float[size];for(int i=0;i<size;i++){out[i]=(float)values.getDouble(i);if(!Float.isFinite(out[i]))throw new IOException("Invalid FSQ value");}
        return out;
    }

    String summary() {
        return this.modelLabel + " runtime constants: " + this.maxFrames + " frames, " + this.genHorizonFrames + "-frame horizon, " + this.jointCount + " joints, " + this.vertexCount + " skin vertices";
    }

    private static String readText(Assets assets, String path) throws IOException {
        return new String(readBytes(assets, path), StandardCharsets.UTF_8);
    }

    private static float[] readF32(Assets assets, String path) throws IOException {
        byte[] bytes = readBytes(assets, path);
        if (bytes.length % 4 != 0) {
            throw new IOException(path + " is not float32 aligned");
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] values = new float[bytes.length / 4];
        for (int i = 0; i < values.length; i++) {
            values[i] = buffer.getFloat();
        }
        return values;
    }

    private static int[] readI32(Assets assets, String path) throws IOException {
        byte[] bytes = readBytes(assets, path);
        if (bytes.length % 4 != 0) {
            throw new IOException(path + " is not int32 aligned");
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int[] values = new int[bytes.length / 4];
        for (int i = 0; i < values.length; i++) {
            values[i] = buffer.getInt();
        }
        return values;
    }

    private static byte[] readBytes(Assets assets, String path) throws IOException {
        try (InputStream input = assets.open(path); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }
}
