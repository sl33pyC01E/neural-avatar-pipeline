package ai.cleo.ardymobile;

// Restored from the installed Ardy Mobile reference; see recovery/installed-app.json.
final class NativeLlm2Vec {
    private static final boolean LOADED;
    private static final String LOAD_ERROR;

    private static native float[] nativeEmbed(String str, String str2, int i, int i2, boolean z, boolean z2);

    static {
        boolean loaded = false;
        String error = "";
        try {
            System.loadLibrary("ardy_llm2vec");
            loaded = true;
        } catch (Throwable failure) {
            error = failure.getClass().getSimpleName() + ": " + failure.getMessage();
        }
        LOADED = loaded;
        LOAD_ERROR = error;
    }

    private NativeLlm2Vec() {
    }

    static boolean available() {
        return LOADED;
    }

    static String unavailableReason() {
        return LOADED ? "loaded" : "missing native library ardy_llm2vec (" + LOAD_ERROR + ")";
    }

    static float[] embed(String modelPath, String text) {
        if (!LOADED) {
            throw new IllegalStateException(unavailableReason());
        }
        return nativeEmbed(modelPath, text, 512, 400, true, false);
    }
}
