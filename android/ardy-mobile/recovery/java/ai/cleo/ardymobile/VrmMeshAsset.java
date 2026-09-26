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
import org.json.JSONObject;

/* JADX INFO: loaded from: classes3.dex */
final class VrmMeshAsset {
    final byte[] boneIndices;
    final String[] boneNames;
    final float[] boneWeights;
    final int indexCount;
    final short[] indices;
    final Material[] materials;
    final float maxX;
    final float maxY;
    final float maxZ;
    final float minX;
    final float minY;
    final float minZ;
    final Primitive[] primitives;
    final int strideFloats;
    final int vertexCount;
    final float[] vertices;

    private VrmMeshAsset(int vertexCount, int indexCount, int strideFloats, String[] boneNames, float[] vertices, short[] indices, byte[] boneIndices, float[] boneWeights, Material[] materials, Primitive[] primitives, float minX, float minY, float minZ, float maxX, float maxY, float maxZ) {
        this.vertexCount = vertexCount;
        this.indexCount = indexCount;
        this.strideFloats = strideFloats;
        this.boneNames = boneNames;
        this.vertices = vertices;
        this.indices = indices;
        this.boneIndices = boneIndices;
        this.boneWeights = boneWeights;
        this.materials = materials;
        this.primitives = primitives;
        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.maxX = maxX;
        this.maxY = maxY;
        this.maxZ = maxZ;
    }

    static VrmMeshAsset load(Context context) throws Exception {
        byte[] boneIndices;
        AssetManager assets = context.getAssets();
        JSONObject json = new JSONObject(readText(assets, "vrm/zome-render.json"));
        int vertexCount = json.getInt("vertexCount");
        int indexCount = json.getInt("indexCount");
        int strideFloats = json.optInt("strideFloats", 8);
        JSONArray boneNamesJson = json.optJSONArray("boneNames");
        String[] boneNames = new String[boneNamesJson == null ? 0 : boneNamesJson.length()];
        for (int i = 0; i < boneNames.length; i++) {
            boneNames[i] = boneNamesJson.getString(i);
        }
        float[] vertices = readF32(assets, json.getString("vertexAsset"));
        short[] indices = readU16(assets, json.getString("indexAsset"));
        byte[] boneIndices2 = readBytes(assets, json.getString("boneIndexAsset"));
        float[] boneWeights = readF32(assets, json.getString("boneWeightAsset"));
        if (vertices.length != vertexCount * strideFloats) {
            throw new IOException("VRM vertex buffer length mismatch");
        }
        if (indices.length != indexCount) {
            throw new IOException("VRM index buffer length mismatch");
        }
        if (boneIndices2.length != vertexCount * 4) {
            throw new IOException("VRM bone index buffer length mismatch");
        }
        if (boneWeights.length != vertexCount * 4) {
            throw new IOException("VRM bone weight buffer length mismatch");
        }
        JSONArray materialsJson = json.getJSONArray("materials");
        Material[] materials = new Material[materialsJson.length()];
        int i2 = 0;
        while (i2 < materials.length) {
            JSONObject material = materialsJson.getJSONObject(i2);
            AssetManager assets2 = assets;
            JSONArray colorJson = material.optJSONArray("color");
            JSONArray materialsJson2 = materialsJson;
            int c = 4;
            float[] boneWeights2 = boneWeights;
            float[] boneWeights3 = {1.0f, 1.0f, 1.0f, 1.0f};
            if (colorJson == null) {
                boneIndices = boneIndices2;
            } else {
                int c2 = 0;
                while (true) {
                    boneIndices = boneIndices2;
                    int iMin = Math.min(c, colorJson.length());
                    int c3 = c2;
                    if (c3 < iMin) {
                        boneWeights3[c3] = (float) colorJson.getDouble(c3);
                        indices = indices;
                        boneIndices2 = boneIndices;
                        c2 = c3 + 1;
                        c = 4;
                    }
                }
            }
            materials[i2] = new Material(material.optString("name", "material_" + i2), boneWeights3, material.optString("texture", ""), material.optString("alphaMode", "OPAQUE"));
            i2++;
            assets = assets2;
            materialsJson = materialsJson2;
            boneWeights = boneWeights2;
            indices = indices;
            boneIndices2 = boneIndices;
        }
        float[] boneWeights4 = boneWeights;
        byte[] boneIndices3 = boneIndices2;
        short[] indices2 = indices;
        JSONArray primitivesJson = json.getJSONArray("primitives");
        Primitive[] primitives = new Primitive[primitivesJson.length()];
        for (int i3 = 0; i3 < primitives.length; i3++) {
            JSONObject primitive = primitivesJson.getJSONObject(i3);
            primitives[i3] = new Primitive(primitive.optString("name", "primitive_" + i3), primitive.getInt("vertexOffset"), primitive.getInt("vertexCount"), primitive.getInt("indexOffset"), primitive.getInt("indexCount"), primitive.optInt("material", -1));
        }
        JSONArray minJson = json.getJSONArray("boundsMin");
        JSONArray maxJson = json.getJSONArray("boundsMax");
        return new VrmMeshAsset(vertexCount, indexCount, strideFloats, boneNames, vertices, indices2, boneIndices3, boneWeights4, materials, primitives, (float) minJson.getDouble(0), (float) minJson.getDouble(1), (float) minJson.getDouble(2), (float) maxJson.getDouble(0), (float) maxJson.getDouble(1), (float) maxJson.getDouble(2));
    }

    String summary() {
        return String.format(Locale.US, "VRM render mesh: %,d vertices, %,d triangles, %d primitive(s), %d material(s)", Integer.valueOf(this.vertexCount), Integer.valueOf(this.indexCount / 3), Integer.valueOf(this.primitives.length), Integer.valueOf(this.materials.length));
    }

    float centerX() {
        return (this.minX + this.maxX) * 0.5f;
    }

    float centerZ() {
        return (this.minZ + this.maxZ) * 0.5f;
    }

    static final class Material {
        final boolean alphaBlend;
        final float[] color;
        final String name;
        final String textureAsset;

        Material(String name, float[] color, String textureAsset, String alphaMode) {
            this.name = name;
            this.color = color;
            this.textureAsset = textureAsset;
            this.alphaBlend = "BLEND".equalsIgnoreCase(alphaMode);
        }
    }

    static final class Primitive {
        final int indexCount;
        final int indexOffset;
        final int material;
        final String name;
        final int vertexCount;
        final int vertexOffset;

        Primitive(String name, int vertexOffset, int vertexCount, int indexOffset, int indexCount, int material) {
            this.name = name;
            this.vertexOffset = vertexOffset;
            this.vertexCount = vertexCount;
            this.indexOffset = indexOffset;
            this.indexCount = indexCount;
            this.material = material;
        }
    }

    private static String readText(AssetManager assets, String path) throws IOException {
        return new String(readBytes(assets, path), StandardCharsets.UTF_8);
    }

    private static float[] readF32(AssetManager assets, String path) throws IOException {
        byte[] bytes = readBytes(assets, path);
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] values = new float[bytes.length / 4];
        for (int i = 0; i < values.length; i++) {
            values[i] = buffer.getFloat(i * 4);
        }
        return values;
    }

    private static short[] readU16(AssetManager assets, String path) throws IOException {
        byte[] bytes = readBytes(assets, path);
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        short[] values = new short[bytes.length / 2];
        for (int i = 0; i < values.length; i++) {
            values[i] = buffer.getShort(i * 2);
        }
        return values;
    }

    /* JADX WARN: Code duplicated, block: B:30:0x0033 A[EXC_TOP_SPLITTER, SYNTHETIC] */
    private static byte[] readBytes(AssetManager assets, String path) throws IOException {
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
