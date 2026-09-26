package ai.cleo.ardymobile;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/* JADX INFO: loaded from: classes3.dex */
final class ArdyMeshAsset {
    final String engine;
    final int faceCount;
    final short[] indices;
    final String[] jointNames;
    final int[] jointParents;
    final float maxX;
    final float maxY;
    final float maxZ;
    final float minX;
    final float minY;
    final float minZ;
    final float[] positions;
    final float[] restJoints;
    final String source;
    final int vertexCount;

    private ArdyMeshAsset(String engine, String source, int vertexCount, int faceCount, float[] positions, short[] indices, String[] jointNames, int[] jointParents, float[] restJoints) {
        this.engine = engine;
        this.source = source;
        this.vertexCount = vertexCount;
        this.faceCount = faceCount;
        this.positions = positions;
        this.indices = indices;
        this.jointNames = jointNames;
        this.jointParents = jointParents;
        this.restJoints = restJoints;
        float minXValue = Float.POSITIVE_INFINITY;
        float minYValue = Float.POSITIVE_INFINITY;
        float minZValue = Float.POSITIVE_INFINITY;
        float maxXValue = Float.NEGATIVE_INFINITY;
        float maxYValue = Float.NEGATIVE_INFINITY;
        float maxZValue = Float.NEGATIVE_INFINITY;
        for (int i = 0; i < positions.length; i += 3) {
            float x = positions[i];
            float y = positions[i + 1];
            float z = positions[i + 2];
            minXValue = Math.min(minXValue, x);
            minYValue = Math.min(minYValue, y);
            minZValue = Math.min(minZValue, z);
            maxXValue = Math.max(maxXValue, x);
            maxYValue = Math.max(maxYValue, y);
            maxZValue = Math.max(maxZValue, z);
        }
        this.minX = minXValue;
        this.minY = minYValue;
        this.minZ = minZValue;
        this.maxX = maxXValue;
        this.maxY = maxYValue;
        this.maxZ = maxZValue;
    }

    static ArdyMeshAsset load(Context context) throws JSONException, IOException {
        AssetManager assets = context.getAssets();
        JSONObject meta = new JSONObject(readText(assets, "motion-assets/ardy.mesh.json"));
        int vertexCount = meta.getInt("vertexCount");
        int faceCount = meta.getInt("faceCount");
        int positionBytes = meta.getInt("positionByteLength");
        int indexOffset = meta.getInt("indexByteOffset");
        int indexBytes = meta.getInt("indexByteLength");
        String binaryPath = meta.optString("binary", "/motion-assets/ardy.meshbin");
        while (binaryPath.startsWith("/")) {
            binaryPath = binaryPath.substring(1);
        }
        byte[] bytes = readBytes(assets, binaryPath);
        int expectedBytes = positionBytes + indexBytes;
        if (bytes.length < expectedBytes || indexOffset != positionBytes) {
            throw new IOException("ARDY mesh binary does not match metadata");
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] positions = new float[vertexCount * 3];
        for (int i = 0; i < positions.length; i++) {
            positions[i] = buffer.getFloat(i * 4);
        }
        int i2 = faceCount * 3;
        short[] indices = new short[i2];
        buffer.position(indexOffset);
        for (int i3 = 0; i3 < indices.length; i3++) {
            int index = buffer.getInt();
            if (index < 0 || index >= vertexCount) {
                throw new IOException("ARDY mesh index out of range: " + index);
            }
            indices[i3] = (short) index;
        }
        JSONArray namesJson = meta.getJSONArray("jointNames");
        String[] jointNames = new String[namesJson.length()];
        for (int i4 = 0; i4 < jointNames.length; i4++) {
            jointNames[i4] = namesJson.getString(i4);
        }
        JSONArray parentsJson = meta.getJSONArray("jointParents");
        int[] jointParents = new int[parentsJson.length()];
        int i5 = 0;
        while (true) {
            JSONArray namesJson2 = namesJson;
            if (i5 >= jointParents.length) {
                break;
            }
            jointParents[i5] = parentsJson.getInt(i5);
            i5++;
            namesJson = namesJson2;
        }
        JSONArray jointsJson = meta.getJSONArray("restJoints");
        float[] restJoints = new float[jointsJson.length() * 3];
        int i6 = 0;
        while (true) {
            JSONArray parentsJson2 = parentsJson;
            if (i6 < jointsJson.length()) {
                JSONArray joint = jointsJson.getJSONArray(i6);
                restJoints[i6 * 3] = (float) joint.getDouble(0);
                restJoints[(i6 * 3) + 1] = (float) joint.getDouble(1);
                restJoints[(i6 * 3) + 2] = (float) joint.getDouble(2);
                i6++;
                positions = positions;
                parentsJson = parentsJson2;
                jointsJson = jointsJson;
                indices = indices;
                jointNames = jointNames;
            } else {
                return new ArdyMeshAsset(meta.optString("engine", "ardy"), meta.optString("source", "ARDY Core skin_standard"), vertexCount, faceCount, positions, indices, jointNames, jointParents, restJoints);
            }
        }
    }

    String summary() {
        return String.format(Locale.US, "ARDY Core skin_standard: %,d vertices, %,d faces, %d joints", Integer.valueOf(this.vertexCount), Integer.valueOf(this.faceCount), Integer.valueOf(this.jointNames.length));
    }

    float centerX() {
        return (this.minX + this.maxX) * 0.5f;
    }

    float centerY() {
        return (this.minY + this.maxY) * 0.5f;
    }

    float centerZ() {
        return (this.minZ + this.maxZ) * 0.5f;
    }

    float spanX() {
        return Math.max(0.001f, this.maxX - this.minX);
    }

    float spanY() {
        return Math.max(0.001f, this.maxY - this.minY);
    }

    private static String readText(AssetManager assets, String path) throws IOException {
        return new String(readBytes(assets, path), StandardCharsets.UTF_8);
    }

    /* JADX WARN: Code duplicated, block: B:30:0x0033 A[EXC_TOP_SPLITTER, SYNTHETIC] */
    private static byte[] readBytes(AssetManager assets, String path) throws IOException {
        InputStream input = assets.open(path);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try {
                byte[] chunk = new byte[16384];
                while (true) {
                    int read = input.read(chunk);
                    if (read < 0) {
                        break;
                    }
                    output.write(chunk, 0, read);
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
