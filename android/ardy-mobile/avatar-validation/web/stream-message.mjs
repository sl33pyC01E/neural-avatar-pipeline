// Show only channels explicitly returned by the local model. Never render model HTML.
export function streamMessage(log,role,text='',reasoning='',label='Gemma'){
  const article=document.createElement('article');article.className=`chat-message ${role}`;
  const name=document.createElement('strong');name.textContent=role==='user'?'You':label;
  const trace=document.createElement('details');trace.className='reasoning';
  const summary=document.createElement('summary');summary.textContent='Reasoning';
  const thought=document.createElement('div');trace.append(summary,thought);
  const answer=document.createElement('div');article.append(name,trace,answer);log.append(article);
  function update(text,reasoning){answer.textContent=text||'…';thought.textContent=reasoning||'';trace.hidden=!reasoning;log.scrollTop=log.scrollHeight;}
  update(text,reasoning);
  return {update,article,trace}; // Starts collapsed; retain the user's choice while streaming.
}
