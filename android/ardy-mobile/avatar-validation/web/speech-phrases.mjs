// Gemma supplies cumulative text; Pocket accepts complete strings, not token appends.
// Keep short sentences together and bound latency/memory for unusually long sentences.
export class SpeechPhrases {
  constructor(){this.text='';this.offset=0;this.finished=false;}
  append(text,final=false){
    if(this.finished)throw new Error('Speech text already finished');
    if(!text.startsWith(this.text))throw new Error('Gemma revised text already queued for speech');
    if(text.length>2000)throw new Error('Reply displayed; speech requires at most 2,000 characters. Ask for a shorter reply.');
    this.text=text;const phrases=[];
    while(this.offset<text.length){
      const remaining=text.slice(this.offset);let length=0;
      if(final&&remaining.length<=360)length=remaining.length;
      else{
        for(const match of remaining.matchAll(/[.!?]["”’')\]]*(?:\s+|$)/gu)){
          const end=match.index+match[0].length;
          if(end>360)break;
          // Wait for a following token so a period in a streamed decimal isn't an early boundary.
          if(end>=160&&(final||end<remaining.length))length=end;
        }
        if(!length&&remaining.length>360){length=remaining.lastIndexOf(' ',360);if(length<120)length=360;}
      }
      if(!length)break;
      const phrase=remaining.slice(0,length);this.offset+=length;if(phrase.trim())phrases.push(phrase);
    }
    this.finished=final;return phrases;
  }
}
