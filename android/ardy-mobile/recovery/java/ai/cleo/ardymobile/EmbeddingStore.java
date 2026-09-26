package ai.cleo.ardymobile;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/* JADX INFO: loaded from: classes3.dex */
final class EmbeddingStore {
    private final Context context;
    private final File savedRoot;

    EmbeddingStore(Context context) {
        this.context = context.getApplicationContext();
        this.savedRoot = new File(context.getFilesDir(), "embeddings");
        if (!this.savedRoot.isDirectory()) {
            this.savedRoot.mkdirs();
        }
    }

    ArrayList<EmbeddingRecord> loadBank() throws Exception {
        String text = readAssetText("embedding-bank/ardy-motion-bank.json");
        JSONObject payload = new JSONObject(text);
        JSONArray entries = payload.getJSONArray("entries");
        ArrayList<EmbeddingRecord> result = new ArrayList<>();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject item = entries.getJSONObject(i);
            EmbeddingRecord record = new EmbeddingRecord();
            record.text = item.optString("text", "");
            record.nickname = item.optString("nickname", "");
            record.category = item.optString("category", "bank");
            record.key = key(record.text);
            record.width = 4096;
            record.dtype = "float32";
            record.source = "prompt bank (text only)";
            result.add(record);
        }
        Collections.sort(result, Comparator.comparing(new EmbeddingStore$$ExternalSyntheticLambda0()));
        return result;
    }

    ArrayList<EmbeddingRecord> loadBundledCache() throws Exception {
        AssetManager assets = this.context.getAssets();
        String[] names = assets.list("sample-cache");
        ArrayList<EmbeddingRecord> result = new ArrayList<>();
        if (names == null) {
            return result;
        }
        for (String name : names) {
            if (name.endsWith(".json")) {
                String stem = name.substring(0, name.length() - 5);
                EmbeddingRecord record = readMetadata(readAssetText("sample-cache/" + name));
                InputStream input = assets.open("sample-cache/" + stem + ".npy");
                try {
                    record.vector = NpyFloat32.read(input);
                    if (input != null) {
                        input.close();
                    }
                    record.source = "bundled desktop LLM2Vec cache";
                    result.add(record);
                } catch (Throwable th) {
                    if (input != null) {
                        try {
                            input.close();
                        } catch (Throwable th2) {
                            th.addSuppressed(th2);
                        }
                    }
                    throw th;
                }
            }
        }
        Collections.sort(result, Comparator.comparing(new EmbeddingStore$$ExternalSyntheticLambda0()));
        return result;
    }

    ArrayList<EmbeddingRecord> loadSaved() throws Exception {
        ArrayList<EmbeddingRecord> result = new ArrayList<>();
        File[] files = this.savedRoot.listFiles();
        if (files == null) {
            return result;
        }
        for (File file : files) {
            if (file.getName().endsWith(".json")) {
                String stem = file.getName().substring(0, file.getName().length() - 5);
                File npy = new File(this.savedRoot, stem + ".npy");
                if (npy.isFile()) {
                    EmbeddingRecord record = readMetadata(readFileText(file));
                    if (isTrustedEmbedding(record)) {
                        record.vector = NpyFloat32.read(npy);
                        record.source = "imported LLM2Vec cache";
                        result.add(record);
                    }
                }
            }
        }
        Collections.sort(result, Comparator.comparing(new EmbeddingStore$$ExternalSyntheticLambda0()));
        return result;
    }

    EmbeddingRecord saveGenerated(String text, String nickname, float[] vector, String encoder) throws Exception {
        String strTrim;
        if (vector == null || vector.length != 4096) {
            throw new IOException("Expected a 4096-float ARDY text embedding");
        }
        String clean = text == null ? "" : text.trim();
        if (clean.isEmpty()) {
            throw new IOException("Enter text to embed");
        }
        String key = key(clean);
        File npy = new File(this.savedRoot, key + ".npy");
        File json = new File(this.savedRoot, key + ".json");
        NpyFloat32.write(npy, vector);
        JSONObject metadata = new JSONObject();
        metadata.put("key", key);
        metadata.put("text", clean);
        metadata.put("nickname", nickname != null ? nickname.trim() : "");
        metadata.put("width", 4096);
        metadata.put("dtype", "float32");
        metadata.put("createdAt", System.currentTimeMillis() / 1000.0d);
        if (encoder == null || encoder.trim().isEmpty()) {
            strTrim = "on-device LLM2Vec Meta-Llama-3 8B";
        } else {
            strTrim = encoder.trim();
        }
        metadata.put("encoder", strTrim);
        FileOutputStream output = new FileOutputStream(json);
        try {
            output.write((metadata.toString(2) + "\n").getBytes(StandardCharsets.UTF_8));
            output.close();
            EmbeddingRecord record = readMetadata(metadata.toString());
            record.vector = vector;
            record.source = "on-device LLM2Vec cache";
            return record;
        } catch (Throwable th) {
            try {
                output.close();
            } catch (Throwable th2) {
                th.addSuppressed(th2);
            }
            throw th;
        }
    }

    static String canonical(String text) {
        String clean = text == null ? "" : text.trim();
        while (true) {
            if (clean.endsWith(".") || clean.endsWith("!") || clean.endsWith("?")) {
                clean = clean.substring(0, clean.length() - 1).trim();
            } else {
                return clean.replaceAll("\\s+", " ").toLowerCase(Locale.US);
            }
        }
    }

    static String key(String text) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hashed = digest.digest(canonical(text).getBytes(StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < 12; i++) {
            builder.append(String.format(Locale.US, "%02x", Integer.valueOf(hashed[i] & 255)));
        }
        return builder.toString();
    }

    private static EmbeddingRecord readMetadata(String json) throws Exception {
        JSONObject object = new JSONObject(json);
        EmbeddingRecord record = new EmbeddingRecord();
        record.key = object.optString("key", "");
        record.text = object.optString("text", "");
        record.nickname = object.optString("nickname", "");
        record.width = object.optInt("width", 4096);
        record.dtype = object.optString("dtype", "float32");
        record.source = object.optString("encoder", "cache");
        record.createdAtMillis = (long) (object.optDouble("createdAt", 0.0d) * 1000.0d);
        return record;
    }

    private static boolean isTrustedEmbedding(EmbeddingRecord record) {
        if (record.width != 4096 || !"float32".equals(record.dtype)) {
            return false;
        }
        String source = record.source == null ? "" : record.source.toLowerCase(Locale.US);
        return source.contains("llm2vec") || source.contains("llama-3");
    }

    private String readAssetText(String name) throws IOException {
        InputStream input = this.context.getAssets().open(name);
        try {
            String str = new String(readAll(input), StandardCharsets.UTF_8);
            if (input != null) {
                input.close();
            }
            return str;
        } catch (Throwable th) {
            if (input != null) {
                try {
                    input.close();
                } catch (Throwable th2) {
                    th.addSuppressed(th2);
                }
            }
            throw th;
        }
    }

    private static String readFileText(File file) throws IOException {
        FileInputStream input = new FileInputStream(file);
        try {
            String str = new String(readAll(input), StandardCharsets.UTF_8);
            input.close();
            return str;
        } catch (Throwable th) {
            try {
                input.close();
            } catch (Throwable th2) {
                th.addSuppressed(th2);
            }
            throw th;
        }
    }

    private static byte[] readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        while (true) {
            int read = stream.read(buffer);
            if (read < 0) {
                return output.toByteArray();
            }
            output.write(buffer, 0, read);
        }
    }
}
