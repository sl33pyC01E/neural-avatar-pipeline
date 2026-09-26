package ai.cleo.ardymobile;

/* JADX INFO: loaded from: classes3.dex */
final class VrmRetargetSettings {
    static final int LEG_FEET_LOCKED = 1;
    static final int LEG_LOCKED = 0;
    static final int LEG_UNLOCKED = 2;
    final boolean enabled;
    final int legMode;
    final float rootHeightOffset;
    final float rootXzScale;
    final float sleeveBarrierStrength;
    final float sleeveBarrierWidth;
    final float strength;

    VrmRetargetSettings(boolean enabled, int legMode, float strength, float rootXzScale, float rootHeightOffset, float sleeveBarrierStrength, float sleeveBarrierWidth) {
        this.enabled = enabled;
        this.legMode = legMode;
        this.strength = Math.max(0.0f, strength);
        this.rootXzScale = Math.max(0.0f, rootXzScale);
        this.rootHeightOffset = rootHeightOffset;
        this.sleeveBarrierStrength = Math.max(0.0f, sleeveBarrierStrength);
        this.sleeveBarrierWidth = Math.max(0.01f, sleeveBarrierWidth);
    }

    static VrmRetargetSettings defaults() {
        return new VrmRetargetSettings(true, LEG_UNLOCKED, 1.0f, 1.0f, 0.0f, 0.65f, 0.16f);
    }

    String legModeName() {
        if (this.legMode == LEG_FEET_LOCKED) {
            return "feet-locked";
        }
        return this.legMode == LEG_UNLOCKED ? "unlocked" : "locked";
    }
}
