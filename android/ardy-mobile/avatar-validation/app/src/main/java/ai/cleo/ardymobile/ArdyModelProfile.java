package ai.cleo.ardymobile;

import java.util.ArrayList;

// Restored from the installed Ardy Mobile reference; see recovery/installed-app.json.
final class ArdyModelProfile {
    final float fps;
    final int genHorizonFrames;
    final String id;
    final String label;
    final int maxRolloutBatches;
    final int maxTokens;
    final String modelDir;
    final String runtimeAsset;
    static final ArdyModelProfile CORE40 = new ArdyModelProfile("core40", "Core40 Horizon 40", "ardy-models/core40-onnx", "ardy-runtime/core40-runtime.json", 40, 64, 20.0f, 24);
    static final ArdyModelProfile CORE8 = new ArdyModelProfile("core8", "Core8 Horizon 8", "ardy-models/core8-onnx", "ardy-runtime/core8-runtime.json", 8, 16, 20.0f, 64);
    static final ArdyModelProfile[] ALL = {CORE40, CORE8};

    private ArdyModelProfile(String id, String label, String modelDir, String runtimeAsset, int genHorizonFrames, int maxTokens, float fps, int maxRolloutBatches) {
        this.id = id;
        this.label = label;
        this.modelDir = modelDir;
        this.runtimeAsset = runtimeAsset;
        this.genHorizonFrames = genHorizonFrames;
        this.maxTokens = maxTokens;
        this.fps = fps;
        this.maxRolloutBatches = maxRolloutBatches;
    }

    int maxFullBatches() {
        return Math.max(1, this.maxRolloutBatches);
    }

    static ArrayList<String> labels() {
        ArrayList<String> labels = new ArrayList<>();
        for (ArdyModelProfile profile : ALL) {
            labels.add(profile.label);
        }
        return labels;
    }
}
