package ai.cleo.ardymobile;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/* JADX INFO: loaded from: classes3.dex */
final class VrmRetargetAsset {
    final String avatarName;
    final String[] boneNames;
    final int[] edgePairs;
    final float floorY;
    final float hipsHeightM;
    final float[] localPositions;
    final float[] localRotations;
    final long modelAssetBytes;
    final String modelAssetPath;
    final int[] parents;
    final float[] restCentered;
    final String vrmVersion;
    final float[] worldRotations;

    private VrmRetargetAsset(String avatarName, String vrmVersion, String modelAssetPath, long modelAssetBytes, String[] boneNames, int[] parents, int[] edgePairs, float[] restCentered, float[] localPositions, float[] localRotations, float[] worldRotations, float hipsHeightM, float floorY) {
        this.avatarName = avatarName;
        this.vrmVersion = vrmVersion;
        this.modelAssetPath = modelAssetPath;
        this.modelAssetBytes = modelAssetBytes;
        this.boneNames = boneNames;
        this.parents = parents;
        this.edgePairs = edgePairs;
        this.restCentered = restCentered;
        this.localPositions = localPositions;
        this.localRotations = localRotations;
        this.worldRotations = worldRotations;
        this.hipsHeightM = hipsHeightM;
        this.floorY = floorY;
    }

    static VrmRetargetAsset load(Context context) throws Exception {
        AssetManager assets = context.getAssets();
        JSONObject json = new JSONObject(readText(assets, "vrm/zome-retarget.json"));
        JSONArray namesJson = json.getJSONArray("boneNames");
        String[] boneNames = new String[namesJson.length()];
        for (int i = 0; i < boneNames.length; i++) {
            boneNames[i] = namesJson.getString(i);
        }
        return new VrmRetargetAsset(json.optString("avatarName", "VRM avatar"), json.optString("vrmVersion", "0"), json.optString("modelAsset", "vrm/zome.vrm"), assetLength(assets, json.optString("modelAsset", "vrm/zome.vrm")), boneNames, readIntArray(json.getJSONArray("parents")), readEdges(json.getJSONArray("edges")), readVec3Array(json.getJSONArray("restCentered")), readVec3Array(json.getJSONArray("localPositions")), readVec4Array(json.getJSONArray("localRotations")), readVec4Array(json.getJSONArray("worldRotations")), (float) json.optDouble("hipsHeightM", 0.0d), (float) json.optDouble("floorY", 0.0d));
    }

    int boneCount() {
        return this.boneNames.length;
    }

    float[] restWorldFrame(float rootHeightOffset) {
        float rootY = (-this.floorY) + rootHeightOffset;
        float[] out = new float[this.restCentered.length];
        for (int i = 0; i < this.restCentered.length; i += 3) {
            out[i] = this.restCentered[i];
            out[i + 1] = this.restCentered[i + 1] + rootY;
            out[i + 2] = this.restCentered[i + 2];
        }
        return out;
    }

    String summary() {
        return String.format(Locale.US, "VRM retarget: %s (VRM%s), %d humanoid bones, model %.1f MB, floor %.3fm", this.avatarName, this.vrmVersion, Integer.valueOf(boneCount()), Float.valueOf(this.modelAssetBytes / 1048576.0f), Float.valueOf(this.floorY));
    }

    private static long assetLength(AssetManager assets, String path) throws IOException {
        AssetFileDescriptor descriptor = assets.openFd(path);
        try {
            long length = descriptor.getLength();
            if (descriptor != null) {
                descriptor.close();
            }
            return length;
        } catch (Throwable th) {
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (Throwable th2) {
                    th.addSuppressed(th2);
                }
            }
            throw th;
        }
    }

    private static int[] readIntArray(JSONArray array) throws Exception {
        int[] out = new int[array.length()];
        for (int i = 0; i < out.length; i++) {
            out[i] = array.getInt(i);
        }
        return out;
    }

    private static int[] readEdges(JSONArray array) throws Exception {
        int[] out = new int[array.length() * 2];
        int offset = 0;
        for (int i = 0; i < array.length(); i++) {
            JSONArray pair = array.getJSONArray(i);
            int offset2 = offset + 1;
            out[offset] = pair.getInt(0);
            offset = offset2 + 1;
            out[offset2] = pair.getInt(1);
        }
        return out;
    }

    private static float[] readVec3Array(JSONArray array) throws Exception {
        float[] out = new float[array.length() * 3];
        for (int i = 0; i < array.length(); i++) {
            JSONArray item = array.getJSONArray(i);
            out[i * 3] = (float) item.getDouble(0);
            out[(i * 3) + 1] = (float) item.getDouble(1);
            out[(i * 3) + 2] = (float) item.getDouble(2);
        }
        return out;
    }

    private static float[] readVec4Array(JSONArray array) throws Exception {
        float[] out = new float[array.length() * 4];
        for (int i = 0; i < array.length(); i++) {
            JSONArray item = array.getJSONArray(i);
            out[i * 4] = (float) item.getDouble(0);
            out[(i * 4) + 1] = (float) item.getDouble(1);
            out[(i * 4) + 2] = (float) item.getDouble(2);
            out[(i * 4) + 3] = (float) item.getDouble(3);
        }
        return out;
    }

    /* JADX WARN: Code duplicated, block: B:32:0x003a A[EXC_TOP_SPLITTER, SYNTHETIC] */
    private static String readText(AssetManager assets, String path) throws IOException {
        InputStream input = assets.open(path);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try {
                byte[] buffer = new byte[16384];
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
                String str = new String(output.toByteArray(), StandardCharsets.UTF_8);
                output.close();
                if (input != null) {
                    input.close();
                }
                return str;
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
