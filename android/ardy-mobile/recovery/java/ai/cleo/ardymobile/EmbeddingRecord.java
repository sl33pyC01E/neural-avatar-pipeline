package ai.cleo.ardymobile;

/* JADX INFO: loaded from: classes3.dex */
final class EmbeddingRecord {
    String category;
    long createdAtMillis;
    String dtype;
    String key;
    String nickname;
    String source;
    String text;
    float[] vector;
    int width;

    EmbeddingRecord() {
    }

    String label() {
        String name = (this.nickname == null || this.nickname.trim().isEmpty()) ? this.text : this.nickname;
        if (name == null || name.trim().isEmpty()) {
            return this.key;
        }
        return name;
    }

    boolean hasVector() {
        return this.vector != null && this.vector.length == 4096;
    }
}
