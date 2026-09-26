package ai.cleo.ardymobile;

/** Shared Android/JVM model selection. Mixed quantizes only the autoregressive LM. */
public final class PocketModels {
    private PocketModels() {}
    public static String file(String component,String precision) {
        if(!precision.equals("fp32")&&!precision.equals("mixed")&&!precision.equals("int8"))
            throw new IllegalArgumentException("Invalid Pocket precision");
        if(!component.equals("lm_main")&&!component.equals("lm_flow")&&!component.equals("decoder"))
            throw new IllegalArgumentException("Invalid Pocket component");
        boolean quantized=precision.equals("int8")||(precision.equals("mixed")&&component.equals("lm_main"));
        return component+(quantized?".int8.onnx":".onnx");
    }
}
