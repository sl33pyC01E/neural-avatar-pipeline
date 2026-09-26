package ai.cleo.ardymobile;

import android.content.Context;
import java.io.File;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;

/* JADX INFO: loaded from: classes3.dex */
final class OnDeviceTextEmbedder {
    static final String MODEL_DIR_NAME = "embedding-models";
    private final Context context;
    private final File modelRoot;

    OnDeviceTextEmbedder(Context context) {
        this.context = context.getApplicationContext();
        this.modelRoot = new File(this.context.getFilesDir(), MODEL_DIR_NAME);
        if (!this.modelRoot.isDirectory()) {
            this.modelRoot.mkdirs();
        }
    }

    String modelDirectory() {
        return this.modelRoot.getAbsolutePath();
    }

    String status() {
        File gguf = findFirstModel(".gguf");
        if (gguf != null) {
            return "On-phone ARDY LLM2Vec GGUF found: " + gguf.getName() + "\nFolder: " + this.modelRoot.getAbsolutePath() + "\nNative llama.cpp embedding backend: " + (NativeLlm2Vec.available() ? "loaded" : NativeLlm2Vec.unavailableReason());
        }
        File litert = findFirstModel(".tflite", ".litert");
        if (litert != null) {
            return "On-phone LiteRT candidate found: " + litert.getName() + "\nFolder: " + this.modelRoot.getAbsolutePath() + "\nLiteRT LLM2Vec embedding backend is not wired yet.";
        }
        return "No on-phone ARDY LLM2Vec model found.\nPut a compatible GGUF or LiteRT embedding model in:\n" + this.modelRoot.getAbsolutePath();
    }

    EmbeddingResult embed(String text) throws Exception {
        String clean = text == null ? "" : text.trim();
        if (clean.isEmpty()) {
            throw new IllegalArgumentException("Enter text to embed.");
        }
        File gguf = findFirstModel(".gguf");
        if (gguf != null) {
            float[] vector = NativeLlm2Vec.embed(gguf.getAbsolutePath(), clean);
            validate(vector);
            return new EmbeddingResult(vector, "on-device ARDY LLM2Vec GGUF: " + gguf.getName());
        }
        File litert = findFirstModel(".tflite", ".litert");
        if (litert != null) {
            throw new IllegalStateException("LiteRT model is present, but the LiteRT LLM2Vec backend is not implemented yet.");
        }
        throw new IllegalStateException("No on-phone ARDY LLM2Vec GGUF or LiteRT model is installed in " + this.modelRoot.getAbsolutePath());
    }

    private File findFirstModel(String... suffixes) {
        File[] files = this.modelRoot.listFiles();
        if (files == null) {
            return null;
        }
        Arrays.sort(files, new Comparator() { // from class: ai.cleo.ardymobile.OnDeviceTextEmbedder$$ExternalSyntheticLambda0
            @Override // java.util.Comparator
            public final int compare(Object obj, Object obj2) {
                return ((File) obj).getName().compareToIgnoreCase(((File) obj2).getName());
            }
        });
        return findFirstModel(files, suffixes);
    }

    private File findFirstModel(File[] files, String... suffixes) {
        for (File file : files) {
            if (file.isDirectory()) {
                File[] childFiles = file.listFiles();
                if (childFiles != null) {
                    Arrays.sort(childFiles, new Comparator() { // from class: ai.cleo.ardymobile.OnDeviceTextEmbedder$$ExternalSyntheticLambda1
                        @Override // java.util.Comparator
                        public final int compare(Object obj, Object obj2) {
                            return ((File) obj).getName().compareToIgnoreCase(((File) obj2).getName());
                        }
                    });
                    File found = findFirstModel(childFiles, suffixes);
                    if (found != null) {
                        return found;
                    }
                } else {
                    continue;
                }
            } else {
                String name = file.getName().toLowerCase(Locale.US);
                for (String suffix : suffixes) {
                    if (name.endsWith(suffix)) {
                        return file;
                    }
                }
            }
        }
        return null;
    }

    private static void validate(float[] vector) {
        if (vector == null || vector.length != 4096) {
            throw new IllegalStateException("Expected 4096 floats from ARDY LLM2Vec, got " + (vector != null ? vector.length : 0));
        }
        double norm = 0.0d;
        for (float value : vector) {
            if (!Float.isFinite(value)) {
                throw new IllegalStateException("Embedding contains NaN or infinity.");
            }
            norm += (double) (value * value);
        }
        if (norm < 1.0E-12d) {
            throw new IllegalStateException("Embedding norm is zero.");
        }
    }

    static final class EmbeddingResult {
        final String encoder;
        final float[] vector;

        EmbeddingResult(float[] vector, String encoder) {
            this.vector = vector;
            this.encoder = encoder;
        }
    }
}
