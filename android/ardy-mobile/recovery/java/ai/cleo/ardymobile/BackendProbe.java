package ai.cleo.ardymobile;

import android.os.Build;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Set;

/* JADX INFO: loaded from: classes3.dex */
final class BackendProbe {
    private BackendProbe() {
    }

    static String describe() {
        StringBuilder builder = new StringBuilder();
        builder.append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append(" / Android ").append(Build.VERSION.RELEASE).append(" API ").append(Build.VERSION.SDK_INT).append('\n');
        builder.append("ABI ").append(Arrays.toString(Build.SUPPORTED_ABIS)).append('\n');
        builder.append("ONNX Runtime QNN: ").append(onnxStatus()).append('\n');
        builder.append("Direct QNN: diagnostic hook only; no ARDY context staged");
        return builder.toString();
    }

    private static String onnxStatus() {
        try {
            Class<?> envType = Class.forName("ai.onnxruntime.OrtEnvironment");
            Method getEnvironment = envType.getMethod("getEnvironment", String.class);
            Object env = getEnvironment.invoke(null, "ardy-mobile");
            try {
                Method providers = envType.getMethod("getAvailableProviders", new Class[0]);
                Object value = providers.invoke(env, new Object[0]);
                return value instanceof Set ? "loaded, providers=" + value : "loaded, providers=" + String.valueOf(value);
            } catch (NoSuchMethodException e) {
                return "loaded";
            }
        } catch (Throwable error) {
            return "unavailable: " + error.getClass().getSimpleName();
        }
    }
}
