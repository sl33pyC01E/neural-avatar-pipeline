package ai.cleo.ardyavatarvalidation;

/** Preserve useful nested errors without displaying native parser dumps as chat text. */
final class GemmaFailure {
    static String message(Throwable failure){
        Throwable root=failure;
        for(int depth=0;depth<8&&root!=null;depth++){
            String text=root.getMessage();
            if(text!=null&&(text.contains("Failed to parse tool calls")||text.contains("Failed to parse FC tool calls")))
                return "Gemma generated an invalid avatar control. Start a new chat and resend; the models can stay loaded.";
            if(root instanceof java.util.concurrent.CancellationException||root instanceof java.io.InterruptedIOException)
                return "Response stopped.";
            if(root.getCause()==null||root.getCause()==root)break;
            root=root.getCause();
        }
        if(root==null)return "Gemma response failed; start a new chat and resend.";
        String text=root.getMessage();if(text==null||text.isBlank())text=root.getClass().getSimpleName();
        text=text.split("\\R",2)[0];if(text.length()>240)text=text.substring(0,240)+"…";
        return root==failure?text:"Gemma response failed: "+text;
    }
}
