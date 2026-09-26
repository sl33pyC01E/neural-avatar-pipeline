package ai.cleo.ardymobile;

/** Text preparation used by the January Pocket ONNX reference implementation. */
public final class PocketPrompt {
    private PocketPrompt() {}
    public static String prepare(String input) {
        String text=input==null?"":input.replaceAll("\\s+"," ").trim();
        if(text.isEmpty())throw new IllegalArgumentException("Enter something for Anna to say");
        if(text.length()>2000)throw new IllegalArgumentException("Speech is limited to 2000 characters");
        int first=text.codePointAt(0), last=text.codePointBefore(text.length());
        text=new String(Character.toChars(Character.toUpperCase(first)))+text.substring(Character.charCount(first));
        if(Character.isLetterOrDigit(last))text+=".";
        return text;
    }
}
