// Show only channels explicitly returned by the local model. Never render model HTML.
export function streamMessage(log,role,text='',reasoning='',label='Gemma'){
  const scrollOwner=()=>log.closest('[data-scroll-owner]')||log;
  const nearEnd=owner=>owner.scrollHeight-owner.clientHeight-owner.scrollTop<100;
  let initial=nearEnd(scrollOwner());
  const article=document.createElement('article');article.className=`chat-message ${role}`;
  const name=document.createElement('strong');name.textContent=role==='user'?'You':label;
  const trace=document.createElement('details');trace.className='reasoning';
  const summary=document.createElement('summary');summary.textContent='Reasoning';
  const thought=document.createElement('div');trace.append(summary,thought);
  const answer=document.createElement('div');article.append(name,trace,answer);log.append(article);
  function update(text,reasoning){
    const owner=log.closest('[data-scroll-owner]')||log;
    const follow=initial??nearEnd(owner);initial=null;
    answer.textContent=text||'…';thought.textContent=reasoning||'';trace.hidden=!reasoning;
    if(follow&&log.getClientRects().length)owner.scrollTop=owner.scrollHeight;
  }
  update(text,reasoning);
  return {update,article,trace}; // Starts collapsed; retain the user's choice while streaming.
}
