const labels={idle:'말 걸어주세요',listening:'듣고 있어요',thinking:'생각 중이에요…',replying:'답변이 도착했어요',attention:'확인이 필요해요',error:'잠깐 막혔어요',sleeping:'잠시 쉬는 중…'};
let skins=[],lastHit='',pendingHit='',currentRevision=-1,registration=0;
const bubble=document.querySelector('#notice-bubble');
window.onggi.onState(state=>{
  if(state.skins)skins=state.skins;
  if(currentRevision!==state.noticeHitRevision){currentRevision=state.noticeHitRevision;lastHit='';pendingHit='';registration++;}
  const revision=currentRevision;
  const skin=skins.find(s=>s.id===state.settings.skinId);
  if(skin)for(const [key,color]of Object.entries(skin.colors))document.body.style.setProperty('--'+key,color);
  document.title=state.settings.buddyName+' 안내';bubble.setAttribute('aria-label',state.settings.buddyName+'과 대화');
  bubble.firstChild.textContent=(state.activityLabel??labels[state.characterState]??labels.idle)+' ';bubble.hidden=!state.bubbleVisible;
  document.body.classList.toggle('notice-below',state.noticeBelow);
  if(!bubble.hidden)requestAnimationFrame(()=>{
    const r=bubble.getBoundingClientRect();if(!r.width||revision!==currentRevision||bubble.hidden)return;
    bubble.style.setProperty('--tail',Math.max(12,Math.min(r.width-12,state.noticeAnchorX-r.x))+'px');
    const hit={x:r.x,y:r.y,width:r.width,height:r.height,revision},signature=JSON.stringify(hit);
    if(signature!==lastHit&&signature!==pendingHit){pendingHit=signature;const attempt=++registration;void window.onggi.action('notice-hit',hit).then(result=>{if(attempt!==registration||revision!==currentRevision)return;pendingHit='';if(result.ok&&result.revision===revision)lastHit=signature;else{lastHit='';void window.onggi.action('sync',{includeCatalog:false}).catch(()=>{bubble.hidden=true;});}}).catch(()=>{if(attempt===registration){pendingHit='';lastHit='';bubble.hidden=true;}});}
  });
});
bubble.addEventListener('click',()=>void window.onggi.action('show-panel',{tab:'chat'}).catch(()=>{bubble.firstChild.textContent='대화창을 다시 열어주세요 ';}));
document.addEventListener('mousemove',event=>void window.onggi.action('pet-pointer-sync',{x:event.screenX,y:event.screenY}).catch(()=>{}));
void window.onggi.action('sync').catch(()=>{bubble.hidden=true;});
