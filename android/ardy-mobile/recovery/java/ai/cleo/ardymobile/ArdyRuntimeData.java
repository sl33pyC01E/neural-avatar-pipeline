package ai.cleo.ardymobile;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/* JADX INFO: loaded from: classes3.dex */
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
        AssetManager assets = context.getAssets();
        JSONObject meta = new JSONObject(readText(assets, profile.runtimeAsset));
        return new ArdyRuntimeData(profile, meta, readF32(assets, meta.getString("motionMean")), readF32(assets, meta.getString("motionStd")), readF32(assets, meta.getString("globalRootMean")), readF32(assets, meta.getString("globalRootStd")), readF32(assets, meta.getString("localRootMean")), readF32(assets, meta.getString("localRootStd")), readF32(assets, meta.getString("bindRigInv")), readF32(assets, meta.getString("lbsWeights")), readI32(assets, meta.getString("lbsIndices")), readF32(assets, meta.getString("neutralJoints")), readI32(assets, meta.getString("jointParents")));
    }

    String summary() {
        return this.modelLabel + " runtime constants: " + this.maxFrames + " frames, " + this.genHorizonFrames + "-frame horizon, " + this.jointCount + " joints, " + this.vertexCount + " skin vertices";
    }

    private static String readText(AssetManager assets, String path) throws IOException {
        return new String(readBytes(assets, path), StandardCharsets.UTF_8);
    }

    private static float[] readF32(AssetManager assets, String path) throws IOException {
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

    private static int[] readI32(AssetManager assets, String path) throws IOException {
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

    /* JADX WARN: Code duplicated, block: B:30:0x0033 A[EXC_TOP_SPLITTER, SYNTHETIC] */
    private static byte[] readBytes(AssetManager assets, String path) throws IOException {
        InputStream input = assets.open(path);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try {
                byte[] buffer = new byte[65536];
                while (true) {
                    int read = input.read(buffer);
                    if (read < 0) {
                        break;
                    }
                    output.write(buffer, 0, read);
                    if (input != null) {
                        try {
                            input.close();
                        } catch (Throwable th) {
                            th.addSuppressed(th);
                        }
                    }
                    throw th;
                }
                byte[] byteArray = output.toByteArray();
                output.close();
                if (input != null) {
                    input.close();
                }
                return byteArray;
            } catch (Throwable th2) {
                try {
                    output.close();
                } catch (Throwable th3) {
                    th2.addSuppressed(th3);
                }
                throw th2;
            }
        } catch (Throwable th4) {
            if (input != null) {
                input.close();
            }
            throw th4;
        }
    }
}
