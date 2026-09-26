package ai.cleo.ardymobile;

/* JADX INFO: loaded from: classes3.dex */
final class ArdySampleSettings {
    final EmbeddingRecord[] batchEmbeddings;
    final float constraintGuidance;
    final String embeddingSummary;
    final boolean qnn;
    final int rolloutBatches;
    final ArdyRoute route;
    final int seed;
    final int steps;
    final float textGuidance;
    final VrmRetargetSettings vrmRetarget;

    ArdySampleSettings(int steps, int seed, int rolloutBatches, float textGuidance, float constraintGuidance, boolean qnn, ArdyRoute route, EmbeddingRecord[] batchEmbeddings, String embeddingSummary, VrmRetargetSettings vrmRetarget) {
        this.steps = steps;
        this.seed = seed;
        this.rolloutBatches = rolloutBatches;
        this.textGuidance = textGuidance;
        this.constraintGuidance = constraintGuidance;
        this.qnn = qnn;
        this.route = route;
        this.batchEmbeddings = batchEmbeddings;
        this.embeddingSummary = embeddingSummary;
        this.vrmRetarget = vrmRetarget == null ? VrmRetargetSettings.defaults() : vrmRetarget;
    }

    EmbeddingRecord primaryEmbedding() {
        if (this.batchEmbeddings == null || this.batchEmbeddings.length == 0) {
            return null;
        }
        return this.batchEmbeddings[0];
    }
}
