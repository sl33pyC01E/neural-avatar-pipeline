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
final class ArdyMotionAsset {
    final String cacheKey;
    final float constraintErrorMaxM;
    final float duration;
    final float fps;
    final int frames;
    final float generationSeconds;
    final float maxX;
    final float maxY;
    final float maxZ;
    final String meshFramesAsset;
    final float minX;
    final float minY;
    final float minZ;
    final String name;
    final float[] positions;
    final String prompt;
    final float realtimeFactor;
    final float[] routeXz;
    final String source;
    final int vertexCount;

    private ArdyMotionAsset(String name, String source, String cacheKey, String prompt, String meshFramesAsset, int frames, int vertexCount, float fps, float duration, float generationSeconds, float realtimeFactor, float constraintErrorMaxM, float[] positions, float[] routeXz) {
        this.name = name;
        this.source = source;
        this.cacheKey = cacheKey;
        this.prompt = prompt;
        this.meshFramesAsset = meshFramesAsset;
        this.frames = frames;
        this.vertexCount = vertexCount;
        this.fps = fps;
        this.duration = duration;
        this.generationSeconds = generationSeconds;
        this.realtimeFactor = realtimeFactor;
        this.constraintErrorMaxM = constraintErrorMaxM;
        this.positions = positions;
        this.routeXz = routeXz;
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

    static ArdyMotionAsset load(Context context, String metadataAsset) throws JSONException, IOException {
        AssetManager assets = context.getAssets();
        JSONObject meta = new JSONObject(readText(assets, metadataAsset));
        int frames = meta.getInt("frames");
        int vertexCount = meta.getInt("meshVertexCount");
        String meshFramesAsset = meta.getString("meshFramesAsset");
        byte[] bytes = readBytes(assets, meshFramesAsset);
        int expectedBytes = frames * vertexCount * 3 * 4;
        if (bytes.length != expectedBytes) {
            throw new IOException(String.format(Locale.US, "Unexpected ARDY meshframe byte count: %,d vs %,d", Integer.valueOf(bytes.length), Integer.valueOf(expectedBytes)));
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] positions = new float[frames * vertexCount * 3];
        for (int i = 0; i < positions.length; i++) {
            positions[i] = buffer.getFloat(i * 4);
        }
        return new ArdyMotionAsset(meta.optString("name", "generated-ardy"), meta.optString("source", "ARDY Core"), meta.optString("cacheKey", ""), meta.optString("prompt", ""), meshFramesAsset, frames, vertexCount, (float) meta.optDouble("fps", 20.0d), (float) meta.optDouble("duration", ((double) frames) / 20.0d), (float) meta.optDouble("generationSeconds", 0.0d), (float) meta.optDouble("realtimeFactor", 0.0d), (float) meta.optDouble("constraintErrorMaxM", 0.0d), positions, readRoute(meta.optJSONArray("routeXZ")));
    }

    String summary() {
        return String.format(Locale.US, "%s: %,d reference frames at %.1f fps, %,d vertices/frame", this.name, Integer.valueOf(this.frames), Float.valueOf(this.fps), Integer.valueOf(this.vertexCount));
    }

    int frameOffset(int frame) {
        return Math.max(0, Math.min(this.frames - 1, frame)) * this.vertexCount * 3;
    }

    float centerX() {
        return (this.minX + this.maxX) * 0.5f;
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

    float spanZ() {
        return Math.max(0.001f, this.maxZ - this.minZ);
    }

    private static float[] readRoute(JSONArray array) throws JSONException {
        if (array == null) {
            return new float[0];
        }
        float[] route = new float[array.length() * 2];
        for (int i = 0; i < array.length(); i++) {
            JSONArray point = array.getJSONArray(i);
            route[i * 2] = (float) point.getDouble(0);
            route[(i * 2) + 1] = (float) point.getDouble(1);
        }
        return route;
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
                byte[] chunk = new byte[65536];
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
