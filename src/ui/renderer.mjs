import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import cjkFriendly from 'markdown-it-cjk-friendly';

const surface = new URLSearchParams(location.search).get('surface');
document.body.dataset.surface=surface;
document.querySelector(surface === 'pet' ? '#pet-surface' : '#panel-surface').hidden = false;
let state, catalog = [], lastRequestSignature = '', toastTimer, drag, lastWarning = '', activeTab = 'chat', lastListening = false, modelSignature = '', modelSaving = false, pickerSettingsSignature = '';
let historySignature = '';
let skillsSignature='',usageSignature='';
let bodySearch=null,bodySearchRunning=false,bodySearchRevision=0,renameConversationId=null;
let deletionTarget=null,deleting=false;
let buddyNameSignature='';
let activeCharacter=null;
let characterCatalogDirty=false,submitting=false,createdConversationId=null;
let animationTimer,animationRun=null,animationReady=null,animationLoading=null,animationFailed=null,decodedFrames=[];
const failedImages=new Map(),osReducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let skinCatalog=[],personaCatalog=[],skinSignature='',personaSignature='',editorSignature='',appearanceCatalogVersion=0;
let bubbleState, bubbleTimer, controlsTimer, petPointerInsideCharacter = false, petHovering = false;
let petLayoutSignature = '';
const drafts = new Map(),editorDrafts=new Map();
const attachmentDrafts=new Map();let pickingAttachments=false,queueEditingUI=null,queueEditOpening=null;
let packPreviewUi=null,packOperation=false,packRemoveTarget=null,packManagementSignature='';
let storagePreview=null,storageOperation=false;
const renderAckIds = new Map();
const messageCache=new Map(),messageCards=new Map();
let simpleDisplayAck=null,composerComposing=false,composerProtectionSignature='',resizeGesture=null;
const responseImageObserver=surface==='panel'?new IntersectionObserver(entries=>{
  if(document.hidden||state?.panelVisible===false)return;
  for(const entry of entries){
    if(!entry.isIntersecting)continue;
    const image=entry.target;responseImageObserver.unobserve(image);
    void window.onggi.action(image.dataset.attachmentId?'attachment-preview':'response-image',image.dataset.attachmentId?{messageId:image.dataset.messageId,id:image.dataset.attachmentId}:{messageId:image.dataset.messageId,imageId:image.dataset.imageId}).then(result=>{if(!image.isConnected)return;if(result.ok&&typeof result.source==='string'&&result.source.startsWith('data:image/png;base64,'))image.src=result.source;else{image.dataset.failed='true';image.closest('figure').querySelector('figcaption span').textContent='미리보기를 읽지 못했어요. 원본을 열거나 대화를 다시 열어주세요.';acknowledgeRenderedMessages();}}).catch(()=>{if(image.isConnected){image.dataset.failed='true';image.closest('figure').querySelector('figcaption span').textContent='미리보기를 읽지 못했어요. 원본을 열거나 대화를 다시 열어주세요.';acknowledgeRenderedMessages();}});
  }
},{root:document.querySelector('#messages'),rootMargin:'160px'}):null;
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false }).use(cjkFriendly);
markdown.disable('image');
markdown.validateLink = value => { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } };

async function act(action, payload) {
  try { return await window.onggi.action(action, payload); }
  catch (error) {
    const toast = document.querySelector('#toast');
    toast.textContent = error.message.replace(/^Error invoking remote method 'action': Error: /, ''); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6500);
    return { ok: false };
  }
}

function showTab(tab) {
  if(resizeGesture&&tab!==activeTab){const old=resizeGesture;resizeGesture=null;void act('resize-end',{token:old.token});if(old.target.hasPointerCapture?.(old.pointerId))old.target.releasePointerCapture(old.pointerId);}
  const menu=document.querySelector('#model-popover');if(menu.matches(':popover-open'))menu.hidePopover();
  const composerMenu=document.querySelector('#composer-popover');if(composerMenu.matches(':popover-open'))composerMenu.hidePopover();
  activeTab = ['chat','history','settings'].includes(tab) ? tab : 'chat';
  if(surface==='panel')void act('panel-tab',{tab:activeTab});
  document.querySelector('#chat-tab').hidden = activeTab !== 'chat';
  document.querySelector('#history-tab').hidden = activeTab !== 'history';
  document.querySelector('#settings-tab').hidden = activeTab !== 'settings';
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === activeTab);
    if(button.closest('.tabs')){if(button.dataset.tab===activeTab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  }
  document.querySelector('#open-settings').setAttribute('aria-pressed',String(activeTab === 'settings'));
  document.body.classList.toggle('compact-mode',surface==='panel'&&Boolean(state?.compactMode)&&activeTab==='chat');
  if(surface==='panel'&&state?.compactMode&&activeTab!=='chat')void act('show-panel',{tab:activeTab});
  if (activeTab === 'chat' && surface === 'panel') document.querySelector('#prompt').focus({ preventScroll: true });
  if (activeTab === 'history') renderHistory();
  acknowledgeRenderedMessages();
}

function renderDraftAttachments(){
  const root=document.querySelector('#draft-attachments'),items=attachmentDrafts.get(state?.activeConversationId??'new')??[],locked=Boolean(queueEditOpening)||submitting||pickingAttachments||state?.attachmentPicking||state?.historyLoading||state?.storageBusy;
  const selection=document.querySelector('#task-selection-summary');
  if(selection){const purpose=document.querySelector('#task-purpose'),skill=document.querySelector('#task-skill');selection.hidden=(!purpose.value||purpose.value==='conversation')&&!skill.value;selection.textContent=[purpose.value&&purpose.value!=='conversation'?purpose.selectedOptions[0].textContent:'',skill.value?'스킬: '+skill.selectedOptions[0].textContent:''].filter(Boolean).join(' · ');}
  if(state?.compactMode&&state.panelVisible!==false){
    const protectedInput=Boolean(document.querySelector('#prompt').value.length||items.length||composerComposing||queueEditingUI||queueEditOpening||submitting||pickingAttachments||document.querySelector('#composer-popover').matches(':popover-open')||document.querySelector('#model-popover').matches(':popover-open'));
    const card=messageCards.get(state.simpleReplyId),contentHeight=Math.min(state.settings?.miniSize==='comfortable'?480:410,document.querySelector('.mini-header').offsetHeight+document.querySelector('#composer').offsetHeight+(card?.scrollHeight??0)+['#queue-bar','#requests','#connection-help','#history-warning'].reduce((height,selector)=>height+(document.querySelector(selector)?.offsetHeight??0),0)+64);
    const payload={conversationId:state.activeConversationId,generation:state.simpleDisplayGeneration,replyId:state.simpleReplyId,ready:false,protected:protectedInput,contentHeight},signature=JSON.stringify(payload);
    if(composerProtectionSignature!==signature){composerProtectionSignature=signature;void act('simple-state',payload).then(result=>{if(!result.ok&&composerProtectionSignature===signature)composerProtectionSignature='';});}
  }
  document.querySelector('#queue-edit-banner').hidden=!queueEditingUI&&!queueEditOpening;
  document.querySelector('#queue-edit-label').textContent=queueEditOpening?'대기 질문 편집을 준비하고 있어요…':queueEditingUI?`대기 질문 수정 · ${queueEditingUI.modelName??''} · ${queueEditingUI.personaName??''}`:'';
  document.querySelector('#cancel-queue-edit').disabled=Boolean(locked||state?.queueEdit?.saving);
  document.querySelector('#prompt').disabled=Boolean(queueEditOpening||state?.historyLoading||state?.storageBusy||queueEditingUI&&(submitting||state?.queueEdit?.saving));
  document.querySelector('#send').textContent=queueEditingUI?'저장':'↑';
  for(const id of ['task-purpose','task-skill','refresh-skills'])document.querySelector('#'+id).disabled=Boolean(queueEditOpening||queueEditingUI||state?.skillsLoading);
  document.querySelector('#send').disabled=Boolean(locked||state?.preparing>0);
  for(const id of ['attach-image','attach-file','paste-image'])document.querySelector('#'+id).disabled=Boolean(locked);
  for(const button of document.querySelectorAll('#queue-bar .queue-edit'))button.disabled=Boolean(queueEditOpening||queueEditingUI||state?.queueEdit||submitting||pickingAttachments||state?.attachmentPicking);
  for(const button of document.querySelectorAll('#queue-bar .queue-cancel'))button.disabled=Boolean(queueEditOpening||state?.queueEdit?.saving&&button.dataset.queueId===state.queueEdit.id);
  const cancelAll=document.querySelector('#queue-bar .queue-cancel-all');if(cancelAll)cancelAll.disabled=Boolean(queueEditOpening||state?.queueEdit?.saving||pickingAttachments||state?.attachmentPicking);
  root.hidden=!items.length;
  const signature=JSON.stringify([items,Boolean(locked)]);if(root.dataset.signature===signature)return;root.dataset.signature=signature;root.replaceChildren();
  for(const attachment of items){
    const chip=document.createElement('div');chip.className='attachment-chip';
    if(attachment.kind==='image'){const image=document.createElement('img');image.alt=attachment.name;chip.append(image);void act('attachment-preview',{id:attachment.id}).then(result=>{if(image.isConnected&&result.ok)image.src=result.source;});}
    const label=document.createElement('span');label.textContent=attachment.name;label.title=attachment.name+' · '+Math.ceil(attachment.bytes/1024)+'KiB';chip.append(label);
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.disabled=Boolean(locked);remove.setAttribute('aria-label',attachment.name+' 첨부 제거');
    remove.addEventListener('click',async()=>{
      if(queueEditOpening||submitting||pickingAttachments)return;
      const key=state?.activeConversationId??'new';pickingAttachments=true;renderDraftAttachments();
      try{if((await act('discard-attachment',{id:attachment.id})).ok)attachmentDrafts.set(key,(attachmentDrafts.get(key)??[]).filter(a=>a.id!==attachment.id));}
      finally{pickingAttachments=false;renderDraftAttachments();}
    });chip.append(remove);root.append(chip);
  }
}

function acknowledgeRenderedMessages() {
  if (surface !== 'panel' || !state || activeTab !== 'chat' || document.hidden || state.panelVisible === false) return;
  if(state.unreadReply?.conversationId===state.activeConversationId){
    const card=messageCards.get(state.unreadReply.messageId),message=state.messages.find(item=>item.id===state.unreadReply.messageId),preview=card?.querySelector('.generated-image');
    if(card?.getClientRects().length&&message?.role==='assistant'&&message.status==='completed'&&!message.images?.some(image=>image.status==='pending')&&(!preview||preview.dataset.failed||preview.complete&&preview.naturalWidth>0)){
      const bounds=card.getBoundingClientRect(),viewport=document.querySelector('#messages').getBoundingClientRect();
      if(Math.min(bounds.bottom,viewport.bottom,innerHeight)>Math.max(bounds.top,viewport.top,0)&&Math.min(bounds.right,viewport.right,innerWidth)>Math.max(bounds.left,viewport.left,0))void act('notice-read',{id:state.unreadReply.messageId});
    }
  }
  if(state.compactMode&&state.simpleReplyId){
    const message=messageCache.get(state.simpleReplyId),card=messageCards.get(state.simpleReplyId),viewport=document.querySelector('#messages').getBoundingClientRect();
    let prepared=Boolean(message?.status==='completed'&&!message.error&&!message.images?.some(image=>image.status==='pending')&&card?.getClientRects().length);
    if(prepared)for(const image of card.querySelectorAll('.generated-image')){const bounds=image.getBoundingClientRect();if(bounds.bottom>viewport.top&&bounds.top<viewport.bottom&&bounds.right>viewport.left&&bounds.left<viewport.right&&!image.dataset.failed&&!(image.complete&&image.naturalWidth>0)){prepared=false;break;}}
    if(prepared&&(!simpleDisplayAck||simpleDisplayAck.generation!==state.simpleDisplayGeneration||simpleDisplayAck.card!==card)){
      const token={conversationId:state.activeConversationId,generation:state.simpleDisplayGeneration,replyId:message.id,card};simpleDisplayAck=token;
      requestAnimationFrame(()=>requestAnimationFrame(async()=>{
        if(simpleDisplayAck!==token)return;
        const latest=messageCache.get(token.replyId),currentCard=messageCards.get(token.replyId),area=document.querySelector('#messages').getBoundingClientRect();
        let ready=!document.hidden&&state.panelVisible!==false&&activeTab==='chat'&&state.compactMode&&state.activeConversationId===token.conversationId&&state.simpleDisplayGeneration===token.generation&&state.simpleReplyId===token.replyId&&currentCard===token.card&&latest?.status==='completed'&&!latest.error&&!latest.images?.some(image=>image.status==='pending')&&currentCard.getClientRects().length>0;
        if(ready)for(const image of currentCard.querySelectorAll('.generated-image')){const bounds=image.getBoundingClientRect();if(bounds.bottom>area.top&&bounds.top<area.bottom&&bounds.right>area.left&&bounds.left<area.right&&!image.dataset.failed&&!(image.complete&&image.naturalWidth>0)){ready=false;break;}}
        if(!ready){if(simpleDisplayAck===token)simpleDisplayAck=null;return;}
        const protectedInput=Boolean(document.querySelector('#prompt').value.length||(attachmentDrafts.get(token.conversationId??'new')??[]).length||composerComposing||queueEditingUI||queueEditOpening||submitting||pickingAttachments||document.querySelector('#composer-popover').matches(':popover-open')||document.querySelector('#model-popover').matches(':popover-open'));
        const result=await act('simple-state',{conversationId:token.conversationId,generation:token.generation,replyId:token.replyId,ready:true,protected:protectedInput});
        if((!result.ok||!result.ready)&&simpleDisplayAck===token)simpleDisplayAck=null;
      }));
    }
  }
  const acknowledgements=[];
  for (const message of state.messages) {
    if (message.role !== 'assistant' || !message.timing?.completedAt || message.timing.renderedAt !== undefined || renderAckIds.has(message.id)) continue;
    if (!messageCards.get(message.id)?.getClientRects().length) continue;
    if(message.images?.some(i=>i.status==='pending'))continue;
    const preview=messageCards.get(message.id)?.querySelector('.generated-image');if(preview&&!preview.dataset.failed&&!(preview.complete&&preview.naturalWidth>0))continue;
    const acknowledgement={id:message.id,conversationId:state.activeConversationId,card:messageCards.get(message.id),completedAt:message.timing.completedAt};
    renderAckIds.set(message.id,acknowledgement);
    acknowledgements.push(acknowledgement);
  }
  for(let offset=0;offset<acknowledgements.length;offset+=100){
    const batch=acknowledgements.slice(offset,offset+100);
    requestAnimationFrame(()=>requestAnimationFrame(async()=>{
      const items=[],byId=new Map(state.messages.map(message=>[message.id,message]));
      for(const acknowledgement of batch){
        if(renderAckIds.get(acknowledgement.id)!==acknowledgement)continue;
        const message=byId.get(acknowledgement.id),card=messageCards.get(acknowledgement.id),preview=card?.querySelector('.generated-image');
        if(document.hidden||state.panelVisible===false||activeTab!=='chat'||state.activeConversationId!==acknowledgement.conversationId||message?.role!=='assistant'||message.timing?.completedAt!==acknowledgement.completedAt||message.timing.renderedAt!==undefined||card!==acknowledgement.card||!card.getClientRects().length||message.images?.some(image=>image.status==='pending')||preview&&!preview.dataset.failed&&!(preview.complete&&preview.naturalWidth>0)){renderAckIds.delete(acknowledgement.id);continue;}
        items.push({id:acknowledgement.id,completedAt:acknowledgement.completedAt,renderedAt:performance.timeOrigin+performance.now()});
      }
      if(!items.length)return;
      const result=await act('response-rendered',{conversationId:batch[0].conversationId,items});
      if(!result.ok)for(const acknowledgement of batch)if(renderAckIds.get(acknowledgement.id)===acknowledgement)renderAckIds.delete(acknowledgement.id);
    }));
  }
}

function renderHistory() {
  if (!state || surface !== 'panel' || activeTab !== 'history' || document.hidden || state.panelVisible === false) return;
  const query = document.querySelector('#history-search').value.trim().toLocaleLowerCase();
  const locked = state.busy || state.queue.length > 0 || state.preparing > 0 || state.historyLoading || state.attachmentPicking;
  const signature = JSON.stringify([state.conversationRevision,state.activeConversationId,locked,query,state.pendingDeletionId,bodySearch]);
  if (signature === historySignature) return;
  historySignature = signature;
  const list = document.querySelector('#conversation-list'); list.replaceChildren();
  const conversations = state.conversations.filter(c => bodySearch?bodySearch.matches.some(hit=>hit.id===c.id):`${c.title} ${c.preview}`.toLocaleLowerCase().includes(query));
  for (const conversation of conversations) {
    const button = document.createElement('button'); button.className = 'conversation-card'; button.dataset.conversation = conversation.id; button.disabled = locked||conversation.id===state.pendingDeletionId;
    button.classList.toggle('selected', conversation.id === state.activeConversationId);
    const top = document.createElement('div'); top.className = 'conversation-top';
    const title = document.createElement('strong'); title.textContent = (conversation.pinned?'★ ':'')+conversation.title;
    const badge = document.createElement('span'); badge.textContent = conversation.id===state.pendingDeletionId ? '삭제 확인 필요' : conversation.id === state.activeConversationId ? '현재' : conversation.mode === 'demo' ? '체험' : 'Codex';
    const preview = document.createElement('p');
    const previewContent = DOMPurify.sanitize(markdown.render(conversation.preview || ''),{RETURN_DOM_FRAGMENT:true});
    preview.textContent = previewContent.textContent.replace(/\*\*|`/g,'').replace(/\s+/g,' ').trim() || '이야기를 이어가볼까요?';
    const meta = document.createElement('small'); meta.textContent = `${new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(conversation.updatedAt))} · 메시지 ${conversation.messageCount ?? 0}개`;
    top.append(title,badge); button.append(top,preview,meta);
    if(bodySearch)preview.textContent=bodySearch.matches.find(hit=>hit.id===conversation.id)?.snippet??'';
    button.addEventListener('click', async () => { const result = await act('open-conversation',{id:conversation.id}); if (result.ok) showTab('chat'); });
    const row=document.createElement('div');row.className='conversation-row';
    const remove=document.createElement('button');remove.className='conversation-delete';remove.dataset.deleteConversation=conversation.id;remove.disabled=locked;remove.textContent=conversation.id===state.pendingDeletionId?'재시도':'삭제';remove.setAttribute('aria-label',conversation.title+' 대화 삭제');
    remove.addEventListener('click',()=>{
      deletionTarget={id:conversation.id,title:conversation.title,threadId:conversation.threadId};
      document.querySelector('#delete-title').textContent=conversation.title;
      document.querySelector('#delete-description').textContent=conversation.threadId?'옹기봇의 로컬 기록과 연결된 Codex CLI 세션을 영구 삭제합니다. CLI에서 파생된 하위 세션도 함께 삭제됩니다. 앱에서 되돌릴 수 없습니다. 기존 복구 백업 파일은 삭제 대상에 포함되지 않습니다.':'이 대화의 로컬 기록을 영구 삭제합니다. 연결된 CLI 세션은 없습니다. 앱에서 되돌릴 수 없습니다. 기존 복구 백업 파일은 삭제 대상에 포함되지 않습니다.';
      document.querySelector('#delete-error').textContent='';document.querySelector('#delete-error').hidden=true;
      document.querySelector('#delete-dialog').showModal();document.querySelector('#delete-cancel').focus();
    });
    const controls=document.createElement('div');controls.className='conversation-actions';
    const pin=document.createElement('button');pin.textContent=conversation.pinned?'★':'☆';pin.setAttribute('aria-label',conversation.title+' 즐겨찾기 '+(conversation.pinned?'해제':'추가'));pin.disabled=Boolean(state.pendingDeletionId);pin.addEventListener('click',()=>act('conversation-meta',{id:conversation.id,pinned:!conversation.pinned}));
    const rename=document.createElement('button');rename.textContent='제목';rename.disabled=Boolean(state.pendingDeletionId);rename.addEventListener('click',()=>{renameConversationId=conversation.id;document.querySelector('#conversation-title').value=conversation.title;document.querySelector('#rename-conversation-dialog').showModal();document.querySelector('#conversation-title').focus();});
    const exportButton=document.createElement('button');exportButton.textContent='MD';exportButton.title='Markdown 내보내기';exportButton.disabled=Boolean(state.pendingDeletionId);exportButton.addEventListener('click',async()=>{exportButton.disabled=true;try{const result=await act('export-conversation',{id:conversation.id,includeImages:document.querySelector('#history-export-images').checked});if(result.ok&&!result.canceled){const toast=document.querySelector('#toast');toast.textContent=`대화를 저장했어요. 이미지 ${result.imageCount}개${result.unavailable?' · 읽지 못한 이미지 '+result.unavailable+'개 제외':''}`;toast.hidden=false;}}finally{exportButton.disabled=false;}});
    controls.append(pin,rename,exportButton,remove);row.append(button,controls);list.append(row);
  }
  document.querySelector('#history-empty').hidden = conversations.length > 0;
  document.querySelector('#history-empty h3').textContent = query ? '찾는 이야기가 없어요' : '아직 지난 이야기가 없어요';
  document.querySelector('#history-empty p').textContent = query ? '다른 단어로 찾아보세요.' : '질문을 보내면 이곳에 차곡차곡 남아요.';
  document.querySelector('#history-busy').hidden = !locked;
  document.querySelector('#history-new').disabled = locked;
}

function renderCharacter(characterState) {
  const pack = activeCharacter?.id===state?.settings.characterId?activeCharacter:null;
  if (!pack) return;
  const image = document.querySelector('#pet-image'), character = document.querySelector('#pet-character');
  const source = pack.assets[characterState] ?? pack.assets.idle;
  const failed=failedImages.get(pack.revision);
  if(!animationRun&&image.getAttribute('src')!==source&&!failed?.has(source))image.src=source;
  image.alt = `${state.settings.buddyName} · ${pack.name}`; character.dataset.state = characterState;
  const characterClass = `pet-character motion-${pack.motion}`;
  if (character.className !== characterClass) character.className = characterClass;
  character.style.width = `${pack.size.width * (state.settings.characterScale??.5)}px`; character.style.height = `${pack.size.height * (state.settings.characterScale??.5)}px`; character.style.marginLeft = `${-pack.size.width * (state.settings.characterScale??.5) / 2}px`;
  character.style.transformOrigin=pack.animation?`${pack.animation.pivot.x*100}% ${pack.animation.pivot.y*100}%`:'';
  image.style.imageRendering=pack.animation?.rendering==='pixel'?'pixelated':'auto';
  const bubble = document.querySelector('#pet-bubble');
  if (surface === 'pet' && `${characterState}:${state.settings.appearanceProfile??'custom'}` !== bubbleState) {
    bubbleState = `${characterState}:${state.settings.appearanceProfile??'custom'}`; clearTimeout(bubbleTimer);
    bubble.hidden = characterState === 'sleeping' || (['quiet','daily'].includes(state.settings.appearanceProfile)&&['idle','listening'].includes(characterState));
    if (!['thinking','attention','sleeping'].includes(characterState) && !(characterState === 'idle' && petHovering)) bubbleTimer = setTimeout(() => {
      bubble.hidden = true;
      void syncPetLayout();
    }, characterState === 'idle' || characterState === 'listening' ? 3000 : 5000);
  }
  if (surface === 'pet' && drag) bubble.hidden = true;
  const welcome = document.querySelector('#welcome-image');
  if (welcome.getAttribute('src') !== pack.assets.idle && !failed?.has(pack.assets.idle))welcome.src=pack.assets.idle;
  syncAnimation(characterState);
  if (surface === 'pet') void syncPetLayout();
}

function syncAnimation(characterState=state?.characterState){
  const pack=activeCharacter,image=document.querySelector('#pet-image');
  if(animationRun&&animationRun!==pack?.revision){clearTimeout(animationTimer);animationRun=null;image.src=pack.assets[characterState]??pack.assets.idle;}
  const eligible=surface==='pet'&&pack?.animation&&pack.id===state?.settings.characterId&&characterState==='idle'&&state.settings.appearanceProfile==='lively'&&!state.motionReduced&&state.petVisible!==false&&!document.hidden&&!drag&&!osReducedMotion.matches&&animationFailed!==pack.revision;
  if(!eligible){clearTimeout(animationTimer);animationRun=null;image.dataset.animating='false';if(pack&&image.getAttribute('src')!==pack.assets[characterState]&&!failedImages.get(pack.revision)?.has(pack.assets[characterState]))image.src=pack.assets[characterState]??pack.assets.idle;return;}
  if(animationReady!==pack.revision){
    if(animationLoading===pack.revision)return;
    animationLoading=pack.revision;const frames=pack.animationFrames.map(source=>{const frame=new Image();frame.src=source;return frame;});
    Promise.all(frames.map(frame=>frame.decode())).then(()=>{if(activeCharacter?.revision!==pack.revision)return;decodedFrames=frames;animationReady=pack.revision;animationLoading=null;syncAnimation();}).catch(()=>{if(activeCharacter?.revision!==pack.revision)return;animationFailed=pack.revision;animationLoading=null;decodedFrames=[];syncAnimation();});return;
  }
  if(animationRun===pack.revision)return;
  clearTimeout(animationTimer);animationRun=pack.revision;image.dataset.animating='true';
  let index=0;
  const advance=()=>{
    if(animationRun!==pack.revision)return;
    image.src=decodedFrames[index].src;image.dataset.frameChanges=String(Number(image.dataset.frameChanges??0)+1);
    const duration=pack.animation.blink.frames[index].durationMs;
    index++;if(index===decodedFrames.length){if(!pack.animation.blink.loop){animationTimer=setTimeout(()=>{animationFailed=pack.revision;syncAnimation();},duration);return;}index=0;}
    animationTimer=setTimeout(advance,duration);
  };
  advance();
}
osReducedMotion.addEventListener('change',()=>syncAnimation());

async function syncPetLayout() {
  if (surface !== 'pet' || !state || !catalog.length) return;
  const bubble = document.querySelector('#pet-bubble'), root = document.querySelector('#pet-surface');
  const payload = {bubbleVisible:!bubble.hidden,controlsVisible:root.classList.contains('pet-active')};
  const signature = JSON.stringify([state.settings.characterId,state.settings.characterScale,payload]);
  if (signature === petLayoutSignature) return;
  petLayoutSignature = signature;
  const result = await act('pet-layout',payload);
  if (signature !== petLayoutSignature) return;
  if (!result.ok) { petLayoutSignature = ''; return; }
  root.style.setProperty('--pet-center',`${result.centerX}px`); root.style.setProperty('--pet-bottom',`${result.bottom}px`);
}

window.onggi.onPetLayoutChanged(() => {
  if (surface !== 'pet') return;
  drag = null; document.querySelector('#pet-surface').classList.remove('pet-dragging');
  petLayoutSignature = ''; void syncPetLayout();
});
window.onggi.onBubblePlacement(position=>{if(surface==='panel'){document.body.classList.toggle('bubble-below',position.below);document.body.style.setProperty('--bubble-tail',position.tailX+'px');}});

window.onggi.onState(next => {
  const compactChanged=Boolean(state?.compactMode)!==Boolean(next.compactMode);
  if(state?.simpleDisplayGeneration!==next.simpleDisplayGeneration||compactChanged){simpleDisplayAck=null;composerProtectionSignature='';}
  if(resizeGesture&&(compactChanged||next.panelVisible===false||next.screenLocked)){const old=resizeGesture;resizeGesture=null;void act('resize-end',{token:old.token});if(old.target.hasPointerCapture?.(old.pointerId))old.target.releasePointerCapture(old.pointerId);}
  if(next.characterPack){if(activeCharacter?.revision!==next.characterPack.revision){clearTimeout(animationTimer);animationRun=null;animationReady=null;animationLoading=null;animationFailed=null;decodedFrames=[];failedImages.clear();}activeCharacter=next.characterPack;}
  if(next.packs){catalog=next.packs;characterCatalogDirty=true;}
  if(next.skins)skinCatalog=next.skins;
  if(next.personas)personaCatalog=next.personas;
  if(next.skins||next.personas)appearanceCatalogVersion++;
  const previousMessages=state?.messages??[];
  if (surface==='panel') {
    next.conversations ??= state?.conversations ?? [];
    if (next.messagePatch?.reset) messageCache.clear();
    for (const message of next.messagePatch?.upsert??[]) messageCache.set(message.id,message);
    const ids=next.messagePatch?.ids??previousMessages.map(m=>m.id),keep=new Set(ids);
    for (const id of messageCache.keys()) if(!keep.has(id))messageCache.delete(id);
    next.messages=ids.map(id=>messageCache.get(id)).filter(Boolean);
  }
  const prepended=previousMessages.length>0&&next.messages?.length>previousMessages.length&&next.messages.at(-1)?.id===previousMessages.at(-1)?.id&&next.messages.some(m=>m.id===previousMessages[0].id);
  const changedConversation = state && state.activeConversationId !== next.activeConversationId;
  if(queueEditOpening){
    if(changedConversation||next.screenLocked||!next.queue?.some(item=>item.id===queueEditOpening.id))queueEditOpening.invalidated=true;
    if(next.queueEdit?.id===queueEditOpening.id)queueEditOpening.token=next.queueEdit.token;
    else if(queueEditOpening.token)queueEditOpening.invalidated=true;
  }
  const panelRestored=state?.panelVisible===false&&next.panelVisible!==false;
  if (changedConversation || next.messagePatch?.reset) {
    renderAckIds.clear();
    for(const card of messageCards.values()){for(const image of card.querySelectorAll('.generated-image'))responseImageObserver?.unobserve(image);card.remove();}
    messageCards.clear();
  }
  if (changedConversation && surface === 'panel') {
    const input=document.querySelector('#prompt');
    if(state.activeConversationId===null||next.conversations.some(c=>c.id===state.activeConversationId))drafts.set(state.activeConversationId ?? 'new',input.value);else drafts.delete(state.activeConversationId);
    if(state.activeConversationId===null&&next.activeConversationId&&(submitting||createdConversationId===next.activeConversationId)){
      drafts.set(next.activeConversationId,input.value);drafts.delete('new');
      attachmentDrafts.set(next.activeConversationId,attachmentDrafts.get('new')??[]);attachmentDrafts.delete('new');
    }
    createdConversationId=null;
    input.value=drafts.get(next.activeConversationId ?? 'new') ?? '';input.style.height='auto';
    input.style.height=Math.min(parseFloat(getComputedStyle(input).maxHeight),Math.max(parseFloat(getComputedStyle(input).minHeight),input.scrollHeight))+'px';
  }
  state = next;
  if(surface==='panel'){
    document.querySelector('#storage-inspect').disabled=Boolean(storageOperation||state.storageBusy||state.busy||state.queue.length||state.preparing||state.historyLoading||state.attachmentPicking);
    document.querySelector('#storage-cancel').disabled=!state.storageBusy;
  }
  if (surface === 'panel') document.body.classList.toggle('page-hidden',document.hidden || state.panelVisible === false);
  if (surface === 'panel' && (document.hidden || state.panelVisible === false)) return;
  document.body.classList.toggle('compact-mode',surface==='panel'&&Boolean(state.compactMode)&&activeTab==='chat');
  document.body.classList.toggle('bubble-below',Boolean(state.bubbleBelow));document.body.style.setProperty('--bubble-tail',state.bubbleTailX+'px');
  const skin=skinCatalog.find(s=>s.id===state.settings.skinId),skinKey=state.settings.skinId+':'+appearanceCatalogVersion;
  if(skin&&skinKey!==skinSignature){skinSignature=skinKey;for(const [key,color]of Object.entries(skin.colors))document.body.style.setProperty('--'+key,color);document.body.dataset.skin=skin.id;}
  if(compactChanged){const input=document.querySelector('#prompt');input.style.height='auto';input.style.height=Math.min(parseFloat(getComputedStyle(input).maxHeight),Math.max(parseFloat(getComputedStyle(input).minHeight),input.scrollHeight))+'px';}
  const buddyName=state.settings.buddyName||'옹기봇';
  if(buddyName!==buddyNameSignature){
    buddyNameSignature=buddyName;
    document.title=buddyName==='옹기봇'?buddyName:`${buddyName} · 옹기봇`;
    document.querySelector('#buddy-title').textContent=buddyName;document.querySelector('#buddy-title').title=buddyName;
    document.querySelector('#mini-buddy-title').textContent=buddyName;
    document.querySelector('#buddy-name').value=buddyName;
    document.querySelector('#prompt').placeholder=`${buddyName}에게 말 걸기…`;
    document.querySelector('#pet-character').setAttribute('aria-label',`${buddyName}: 클릭하면 대화, 드래그하면 이동`);
    document.querySelector('#welcome-image').alt=`반기는 ${buddyName}`;
    document.querySelector('#history-description').textContent=`${buddyName}과 나눈 대화만 모았어요.`;
    document.querySelector('#conversation-list').setAttribute('aria-label',`${buddyName} 이전 대화 목록`);
  }
  document.body.classList.toggle('reduced-motion', Boolean(state.motionReduced??state.settings.reducedMotion));
  document.querySelector('#appearance-profile').value=state.settings.appearanceProfile??'custom';
  document.querySelector('#battery-saver').checked=Boolean(state.settings.batterySaver);
  document.querySelector('#character-scale').value=String(state.settings.characterScale??.5);
  let characterState = state.characterState;
  if (surface === 'panel' && document.activeElement === document.querySelector('#prompt') && document.querySelector('#prompt').value && !state.busy && !state.sleeping) characterState = 'listening';
  renderCharacter(characterState);
  if (characterCatalogDirty) {
    characterCatalogDirty=false;
    if (surface === 'panel') {
    const cards = document.querySelector('#character-cards'); cards.replaceChildren();
    for (const pack of catalog) {
      const card = document.createElement('button'); card.className = 'character-card'; card.dataset.character = pack.id;card.disabled=Boolean(pack.temporary);
      const image = document.createElement('img'); image.src = pack.thumbnail??''; image.alt = pack.name;
      const name = document.createElement('strong'); name.textContent = pack.name;
      const description = document.createElement('small'); description.textContent = pack.description;
      const check = document.createElement('span'); check.className = 'check'; check.textContent = '✓';
      card.append(image, name, description, check); card.addEventListener('click', () => act('select-character', { id: pack.id })); cards.append(card);
    }
    }
  }
  for (const card of document.querySelectorAll('.character-card')) {
    card.classList.toggle('selected', card.dataset.character === state.settings.characterId);
    card.querySelector('.check').hidden = card.dataset.character !== state.settings.characterId;
  }
  if (surface === 'pet') return;
  document.querySelector('#mini-connection').textContent=state.connection==='demo'?'체험':state.connection==='connected'?'Codex':'연결 대기';
  document.querySelector('#mini-welcome').hidden=!state.compactMode||state.messages.length>0;
  const preferences=JSON.stringify([appearanceCatalogVersion,state.settings.characterId,state.settings.personaModes]);
  if(preferences!==personaSignature){
    personaSignature=preferences;
    const skinSelect=document.querySelector('#skin-select');skinSelect.replaceChildren();for(const entry of skinCatalog){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;skinSelect.append(option);}
    const selected=personaCatalog.find(p=>p.characterId===state.settings.characterId),selector=document.querySelector('#persona-select');selector.replaceChildren();
    for(const entry of selected?.entries.filter(e=>e.id!=='base'&&!e.archived&&!e.error)??[]){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;option.title=entry.description;selector.append(option);}
    selector.disabled=!selected;selector.value=state.settings.personaModes?.[state.settings.characterId]??'';document.querySelector('.persona-quick').hidden=!selected;
    const characterSelect=document.querySelector('#persona-character'),previous=characterSelect.value;characterSelect.replaceChildren();
    for(const entry of personaCatalog){const option=document.createElement('option');option.value=entry.characterId;option.textContent=catalog.find(p=>p.id===entry.characterId)?.name??entry.characterId;characterSelect.append(option);}
    characterSelect.value=personaCatalog.some(p=>p.characterId===previous)?previous:state.settings.characterId;
    characterSelect.dispatchEvent(new Event('change'));
  }
  const packSignature=JSON.stringify([catalog.map(p=>[p.id,p.version,p.revision]),state.packArchives]);
  if(packSignature!==packManagementSignature){
    packManagementSignature=packSignature;const select=document.querySelector('#pack-manage-select'),old=select.value;select.replaceChildren();
    for(const entry of catalog){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;select.append(option);}select.value=catalog.some(p=>p.id===old)?old:state.settings.characterId;select.dispatchEvent(new Event('change'));
    const archives=document.querySelector('#pack-archive-select');archives.replaceChildren();for(const entry of state.packArchives??[]){const option=document.createElement('option');option.value=entry.token;option.textContent=entry.name+' · '+entry.version;archives.append(option);}document.querySelector('#pack-restore').disabled=!archives.options.length;
  }
  document.querySelector('#skin-select').value=state.settings.skinId;document.querySelector('#chat-mode').value=state.settings.chatMode;
  const connectionLabels = { disconnected: 'Codex · 연결 대기', connecting: 'Codex · 연결 중', connected: 'Codex · 연결됨', demo: '체험 모드' };
  document.querySelector('#connection-label').lastChild.textContent = connectionLabels[state.connection] ?? '연결 대기';
  document.querySelector('.connection-bar').dataset.connection = state.connection;
  const help=state.connectionHelp??{phase:state.connection==='connected'?'ready':'idle',message:'연결을 확인해주세요.'},demo=state.connection==='demo',pending=help.phase==='login-pending';
  const checking=help.phase==='checking'||state.modelsStatus==='loading',connectionLocked=state.busy||state.preparing>0||state.historyLoading||state.queue.length&&!state.queuePaused;
  document.querySelector('#connection-help').hidden=demo||help.phase==='ready'&&state.connection==='connected';
  document.querySelector('#connection-help-title').textContent=({checking:'연결을 확인하고 있어요',ready:'연결을 다시 확인해요','login-required':'ChatGPT 로그인이 필요해요','login-pending':'브라우저에서 로그인해주세요','missing-cli':'Codex를 찾지 못했어요','workspace-missing':'작업 폴더를 선택해주세요',error:'연결을 복구해요'})[help.phase]??'대화 연결을 준비해요';
  document.querySelector('#connection-help-message').textContent=help.message??'다시 연결을 누르면 설치와 로그인 상태를 확인해요.';
  for(const id of ['reconnect','connection-retry','check-connection'])document.querySelector('#'+id).disabled=demo||checking||pending||connectionLocked;
  document.querySelector('#reconnect').hidden=demo||help.phase==='ready'&&state.connection==='connected';
  document.querySelector('#refresh-conversation').hidden=demo||!state.activeConversationId;document.querySelector('#refresh-conversation').disabled=connectionLocked||checking||pending;
  document.querySelector('#connection-retry').hidden=pending||help.phase==='login-required';
  document.querySelector('#login-chatgpt').hidden=help.phase!=='login-required';document.querySelector('#login-chatgpt').disabled=connectionLocked||checking;
  document.querySelector('#find-cli').hidden=help.phase!=='missing-cli'&&help.phase!=='error';document.querySelector('#find-cli').disabled=connectionLocked||checking;
  document.querySelector('#install-cli').hidden=help.phase!=='missing-cli';document.querySelector('#connection-workspace').hidden=help.phase!=='workspace-missing';document.querySelector('#connection-workspace').disabled=connectionLocked||checking;
  document.querySelector('#cancel-login').hidden=!pending;
  if(help.phase==='login-required')document.querySelector('#connection-label').lastChild.textContent='Codex · 로그인 필요';
  document.querySelector('#connection-label').title = state.connection === 'demo' ? '체험 응답 · 실제 Codex 호출 없음' : '로컬 Codex · 읽기 전용으로 시작';
  document.querySelector('#stop').hidden = !state.busy;
  document.documentElement.style.setProperty('--chat-font-scale',String((state.settings.fontScale??100)/100));
  for(const [id,key,fallback]of [['font-scale','fontScale',100],['mini-size','miniSize','small'],['send-key','sendKey','enter'],['hotkey','hotkey','CommandOrControl+Shift+Space']])document.querySelector('#'+id).value=String(state.settings[key]??fallback);
  document.querySelector('#shortcut-status').textContent=state.shortcut?`현재 단축키: ${state.activeShortcut.replace('CommandOrControl','⌘/Ctrl').replaceAll('+',' + ')}`:'단축키를 등록하지 못했어요. 트레이나 버디에서 대화를 열어주세요.';
  document.querySelector('#retry-shortcut').hidden=Boolean(state.shortcut&&state.settings.hotkey===state.activeShortcut);
  document.querySelector('#new-chat').disabled = state.busy || state.storageBusy || state.queue.length > 0 || state.historyLoading || state.preparing > 0;
  document.querySelector('#prompt').disabled = state.historyLoading||state.storageBusy;
  if(queueEditingUI&&!state.queueEdit&&!submitting){const input=document.querySelector('#prompt');input.value=queueEditingUI.draft;attachmentDrafts.set(queueEditingUI.conversationId??'new',queueEditingUI.attachments);queueEditingUI=null;input.dispatchEvent(new Event('input'));}
  document.querySelector('#pause-queue').textContent=state.queuePaused?'대기 계속':'대기 보류';
  document.querySelector('#send').title=queueEditingUI?'대기 질문 수정 저장':state.busy?'대기열에 추가 · 앞 작업이 끝나면 차례대로 실행':`${state.settings.sendKey==='modifier-enter'?'⌘/Ctrl+Enter':'Enter'} 보내기 · Shift+Enter 줄바꿈`;document.querySelector('#send').setAttribute('aria-label',queueEditingUI?'대기 질문 수정 저장':state.busy?'대기열에 질문 추가':'질문 보내기');renderDraftAttachments();
  document.querySelector('#history-warning').textContent = state.historyWarning ?? '';
  document.querySelector('#history-warning').hidden = !state.historyWarning;
  renderHistory();
  document.querySelector('#demo-mode').checked = state.connection === 'demo';
  document.querySelector('#measure-response-time').checked = Boolean(state.settings.measureResponseTime);
  for(const [id,key]of [['notify-completed','notifyCompleted'],['notify-approval','notifyApproval'],['notify-failed','notifyFailed'],['notify-preview','notifyPreview'],['notify-sound','notifySound'],['quiet-hours','quietHoursEnabled']])document.querySelector('#'+id).checked=Boolean(state.settings[key]);
  document.querySelector('#approval-display').value=state.settings.approvalDisplay??'panel';
  for(const [id,key,fallback]of [['quiet-start','quietStart',1320],['quiet-end','quietEnd',480]])if(document.activeElement!==document.querySelector('#'+id)){const minutes=state.settings[key]??fallback;document.querySelector('#'+id).value=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}
  document.querySelector('#notification-status').textContent=state.notificationIssue??'OS 알림과 소리는 시스템 설정을 따라요.';
  document.querySelector('#cli-version').textContent=`Codex CLI ${state.cliDiagnostics?.cliVersion??'버전 확인 불가'} · 인증 확인 ${state.cliDiagnostics?.features.auth==='supported'?'지원':state.cliDiagnostics?.features.auth==='unsupported'?'미지원':'미확인'}`;
  const nextSkillsSignature=JSON.stringify(state.skills??[]);if(nextSkillsSignature!==skillsSignature){skillsSignature=nextSkillsSignature;const selector=document.querySelector('#task-skill'),previous=selector.value;selector.replaceChildren();const option=document.createElement('option');option.value='';option.textContent='자동 선택';selector.append(option);for(const skill of state.skills??[]){const item=document.createElement('option');item.value=skill.token;item.textContent=skill.name;item.title=skill.description+'\n'+skill.path;selector.append(item);}if([...selector.options].some(item=>item.value===previous))selector.value=previous;}
  document.querySelector('#task-status').textContent=state.skillsError??'목적과 스킬은 질문마다 고정돼요. 스킬 원문이 바뀌면 실행 전에 확인해요.';
  const usage=state.accountUsage??{status:'idle',buckets:[]},nextUsageSignature=JSON.stringify(usage);document.querySelector('#refresh-usage').disabled=Boolean(state.usageLoading);
  document.querySelector('#usage-status').textContent=({idle:'아직 조회하지 않았어요.',loading:'계정 한도를 확인하고 있어요.',unsupported:'이 CLI는 계정 한도 조회를 지원하지 않아요.',unavailable:'현재 연결의 계정 한도를 확인할 수 없어요.',stale:'이전 값을 표시해요. 최신 한도를 다시 확인해주세요.',ready:'계정 전체의 사용 비율이에요.'}[usage.status]??'확인 불가')+(usage.checkedAt?' · 조회 '+new Date(usage.checkedAt).toLocaleTimeString('ko-KR')+(Date.now()-usage.checkedAt>600000?' · 오래된 값':''):'');
  if(nextUsageSignature!==usageSignature){usageSignature=nextUsageSignature;const root=document.querySelector('#usage-buckets');root.replaceChildren();for(const bucket of usage.buckets??[]){const row=document.createElement('p');row.className='settings-note';row.textContent=bucket.name+' · '+['primary','secondary'].map(slot=>{const value=bucket[slot];return value?`${value.windowDurationMins?value.windowDurationMins+'분':'시간 범위 미확인'}: ${value.usedPercent}% 사용 / ${Math.max(0,100-value.usedPercent)}% 남음${value.resetsAt?' · 초기화 '+new Date(value.resetsAt*1000).toLocaleString('ko-KR'):''}`:'확인 불가';}).join(' | ');root.append(row);}}
  document.querySelector('#demo-mode').disabled = state.busy || state.demoLocked;
  document.querySelector('#demo-mode').parentElement.querySelector('small').textContent = state.demoLocked ? '이 실행은 체험 전용이에요. 일반 실행으로 전환하세요.' : '실제 Codex 호출 없이 둘러보기';
  const signatureModels = JSON.stringify([state.models, state.modelDefaults, state.settings.model, state.settings.effort,state.settings.serviceTier]);
  const currentPickerSettings = JSON.stringify([state.settings.model,state.settings.effort,state.settings.serviceTier]);
  const modelSelect = document.querySelector('#model-select'), effortSelect = document.querySelector('#effort-select'), speedSelect = document.querySelector('#speed-select');
  const chosenModel = state.settings.model || state.modelDefaults.model;
  const model = state.models.find(m => m.model === chosenModel);
  const effectiveEffort = state.settings.effort || (!state.settings.model && state.modelDefaults.effort) || model?.defaultEffort;
  const serviceTier = state.settings.serviceTier ?? 'default', speed = model?.serviceTiers.find(t => t.id === serviceTier);
  const pickerFocused = [modelSelect,effortSelect,speedSelect].includes(document.activeElement);
  if (signatureModels !== modelSignature && (!pickerFocused || modelSaving || !modelSignature || currentPickerSettings !== pickerSettingsSignature)) {
    modelSignature = signatureModels;
    pickerSettingsSignature = currentPickerSettings;
    modelSelect.replaceChildren(); effortSelect.replaceChildren(); speedSelect.replaceChildren();
    const inherited = document.createElement('option'); inherited.value = ''; inherited.textContent = 'CLI 기본값'; modelSelect.append(inherited);
    for (const entry of state.models) { const option = document.createElement('option'); option.value = entry.model; option.textContent = entry.name; option.title = entry.description; modelSelect.append(option); }
    if (state.settings.model && !model) { const missing = document.createElement('option'); missing.value = state.settings.model; missing.textContent = `목록에 없음 · ${state.settings.model}`; modelSelect.append(missing); }
    modelSelect.value = state.settings.model || '';
    const defaultEffort = document.createElement('option'); defaultEffort.value = ''; defaultEffort.textContent = '기본 추론'; effortSelect.append(defaultEffort);
    for (const entry of model?.efforts ?? []) { const option = document.createElement('option'); option.value = entry.value; option.textContent = entry.value; option.title = entry.description; effortSelect.append(option); }
    effortSelect.value = state.settings.effort || '';
    const standard = document.createElement('option'); standard.value = 'default'; standard.textContent = 'Standard'; speedSelect.append(standard);
    for (const tier of model?.serviceTiers ?? []) { const option = document.createElement('option'); option.value = tier.id; option.textContent = tier.name; option.title = tier.description; speedSelect.append(option); }
    if (serviceTier !== 'default' && !speed) { const missing = document.createElement('option'); missing.value = serviceTier; missing.textContent = `미지원 · ${serviceTier}`; speedSelect.append(missing); }
    speedSelect.value = serviceTier;
  }
  for (const select of [modelSelect, effortSelect,speedSelect]) select.disabled = state.connection === 'demo' || state.modelsStatus !== 'ready' || modelSaving;
  speedSelect.title = serviceTier === 'default' ? '일반 속도 · 다음 질문부터 적용' : `${speed?.description ?? '현재 CLI 목록에서 지원 정보를 확인할 수 없어요'} · Fast는 사용량이 증가할 수 있어요`;
  document.querySelector('#refresh-models').disabled = state.modelsStatus === 'loading' || state.connection === 'demo';
  const modelInfo = document.querySelector('#model-info');
  modelInfo.textContent = state.connection === 'demo' ? '체험 모드에서는 모델을 호출하지 않아요' : state.modelsError ? `모델 조회 실패 · ${state.modelsError}` : state.modelsStatus === 'loading' ? '모델 목록 확인 중…' : model ? `다음 질문 · ${model.name} / ${effectiveEffort} · ${serviceTier === 'default' ? 'Standard' : `${speed?.name ?? '미지원 속도'} · 사용량 증가`}${state.busy || state.queue.length ? ' · 기존 요청은 유지' : ''}` : '모델 목록을 새로고침해주세요';
  modelInfo.hidden = state.connection === 'demo' || (!state.modelsError && state.modelsStatus !== 'loading' && Boolean(model));
  document.querySelector('.model-controls').title = modelInfo.textContent;
  const modelToggle=document.querySelector('#model-menu-toggle');
  document.querySelector('#model-menu-label').textContent=state.connection==='demo'?'체험 모드':model?.name??chosenModel??'모델 선택';
  document.querySelector('#model-menu-effort').textContent=state.connection==='demo'?'':effectiveEffort??'';
  document.querySelector('#model-fast-icon').hidden=serviceTier==='default';
  modelToggle.disabled=state.connection==='demo';modelToggle.title=modelInfo.textContent;modelToggle.setAttribute('aria-label','모델 설정 열기 · '+modelInfo.textContent);
  modelInfo.classList.toggle('model-error', Boolean(state.modelsError));
  document.querySelector('#reduced-motion').checked = state.settings.reducedMotion;
  document.querySelector('#always-on-top').checked = state.settings.alwaysOnTop;
  for (const [id, value] of [['workspace-path',state.settings.workspace],['codex-path',state.settings.codexPath]]) { document.querySelector('#' + id).textContent = value; document.querySelector('#' + id).title = value; }
  document.querySelector('#pack-errors').hidden = state.packErrors.length === 0;
  document.querySelector('#pack-errors').textContent = state.packErrors.join('\n');
  const messages = document.querySelector('#messages');
  const previousHeight=messages.scrollHeight,previousTop=messages.scrollTop;
  const atBottom = previousHeight - previousTop - messages.clientHeight < 90;
  const older=document.querySelector('#load-older'),localRemaining=Math.max(0,state.messageTotal-state.messages.length);older.hidden=!localRemaining&&!state.remoteHistoryAvailable;older.disabled=Boolean(state.historyLoading);older.textContent=state.remoteHistoryLoading?'이전 내용을 불러오는 중…':localRemaining?`이전 내용 더 보기 · ${localRemaining}개 남음`:'이전 Codex 기록 더 보기';
  const cancelHistory=document.querySelector('#cancel-history');cancelHistory.hidden=!state.remoteHistoryLoading;cancelHistory.disabled=!state.historyCancelable;cancelHistory.textContent=state.historyCancelable?'기록 조회 취소':'기록 처리 중…';
  document.querySelector('#welcome').hidden = state.messages.length > 0;
  const renderedMessages = state.compactMode ? state.messages.filter(message=>message.id===state.simpleReplyId&&message.role==='assistant') : state.messages;
  document.body.classList.toggle('simple-empty',Boolean(state.compactMode&&!renderedMessages.length));
  const ids = new Set(renderedMessages.map(m => m.id));
  for (const [id,element] of messageCards) if (!ids.has(id)) {for(const image of element.querySelectorAll('.generated-image'))responseImageObserver?.unobserve(image);element.remove();messageCards.delete(id);}
  let previousCard=null;
  const quickIds=new Set(state.compactMode?renderedMessages.map(message=>message.id):state.messages.slice(-2).map(message=>message.id));
  for (const message of renderedMessages) {
    let card = messageCards.get(message.id);
    if (!card) {
      card = document.createElement('article'); card.dataset.id = message.id; card.className = `message ${message.role}`;
      const label = document.createElement('div'); label.className = 'message-label';
      const body = document.createElement('div'); body.className = 'message-body';
      const error = document.createElement('div'); error.className = 'message-error';
      const images=document.createElement('div');images.className='message-images';
      const tools = document.createElement('div'); tools.className = 'message-tools';
      const progress=document.createElement('details');progress.className='message-progress';progress.hidden=true;const summary=document.createElement('summary');summary.textContent='작업 정보';const detail=document.createElement('div');progress.append(summary,detail);
      const status = document.createElement('span'); const copy = document.createElement('button'); copy.textContent = '복사';
      copy.addEventListener('click', async () => { const value = state.messages.find(m => m.id === message.id); if (value && (await act('copy', { text: value.text })).ok) {copy.textContent='복사됨';setTimeout(()=>{copy.textContent='복사';},1600);} });
      tools.append(status,copy); card.append(label,body,images,error,progress,tools); messageCards.set(message.id,card);
      if(previousCard)previousCard.after(card);else messages.insertBefore(card,messages.querySelector('.message'));
    }
    if(previousCard && card.previousElementSibling!==previousCard)previousCard.after(card);
    previousCard=card;
    card.classList.toggle('quick-visible',quickIds.has(message.id));
    // 메시지 캐시는 IPC upsert에서 객체를 교체하므로 같은 객체의 본문·메타데이터는 변하지 않는다.
    if (card.renderedMessage===message&&card.renderedMeasure===state.settings.measureResponseTime&&card.renderedBuddyName===buddyName) continue;
    const metadata=JSON.stringify({...message,text:undefined});
    card.renderedMessage=message;
    if (card.renderedText===message.text&&card.renderedMetadata===metadata&&card.renderedMeasure===state.settings.measureResponseTime&&card.renderedBuddyName===buddyName) continue;
    card.renderedBuddyName=buddyName;
    card.renderedText=message.text;card.renderedMetadata=metadata;card.renderedMeasure=state.settings.measureResponseTime;
    card.dataset.status = message.status;
    const messageLabel = message.role === 'user' ? '나' : `${buddyName}${message.mode === 'demo' ? ' · 체험' : message.purpose==='review'?' · 전용 리뷰 · 모델은 CLI 설정': message.model ? ` · ${message.modelName || message.model} / ${message.effort}${message.serviceTier && message.serviceTier !== 'default' ? ` · ${message.serviceTierName || message.serviceTier}` : ''}` : ''}${message.persona?' · '+message.persona.name:''}`;
    card.querySelector('.message-label').title=messageLabel;
    if (card.querySelector('.message-label').textContent !== messageLabel) card.querySelector('.message-label').textContent = messageLabel;
    const body = card.querySelector('.message-body');
    if (body.renderedSource !== message.text) {
      body.renderedSource = message.text;
      // macOS 시스템 글꼴에서 긴 ASCII 단어의 배치가 수초 걸려 고정폭으로 표시한다.
      let longToken=false;
      for(let index=0,run=0;index<message.text.length;index++){const code=message.text.charCodeAt(index);run=code>=33&&code<=126?run+1:0;if(run>=4096){longToken=true;break;}}
      body.classList.toggle('long-token-text',longToken);
      body.classList.toggle('markdown-body', message.role === 'assistant');
      if (message.role === 'assistant') {
        const fragment = DOMPurify.sanitize(markdown.render(message.text), {
          ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','h5','h6','strong','em','s','blockquote','ul','ol','li','pre','code','hr','table','thead','tbody','tr','th','td','a'],
          ALLOWED_ATTR: ['href','title','start','align','class'], ALLOW_DATA_ATTR: false, RETURN_DOM_FRAGMENT: true
        });
        for (const table of [...fragment.querySelectorAll('table')]) { const wrapper = document.createElement('div'); wrapper.className = 'markdown-table'; table.replaceWith(wrapper); wrapper.append(table); }
        for (const pre of fragment.querySelectorAll('pre')) {
          const code = pre.querySelector('code'); if (!code) continue;
          const value = code.textContent, copyCode = document.createElement('button'); copyCode.type = 'button'; copyCode.className = 'copy-code'; copyCode.textContent = '코드 복사'; copyCode.addEventListener('click', async () => {if((await act('copy', { text: value })).ok){copyCode.textContent='복사됨';setTimeout(()=>{copyCode.textContent='코드 복사';},1600);}}); pre.append(copyCode);
        }
        body.replaceChildren(fragment);
      } else body.textContent = message.text;
    }
    let timingBlock = body.querySelector('.response-timing');
    if (state.settings.measureResponseTime && message.timing && ['completed','failed','interrupted'].includes(message.status)) {
      if (!timingBlock) {timingBlock = document.createElement('div');timingBlock.className='response-timing';body.append(timingBlock);}
      const t = message.timing;
      const rows = [['입력 → 앱 수신',t.inputMs],['앱 수신 → CLI 전송',t.dispatchMs],['CLI 전송 → 응답 완료',t.cliMs],['응답 완료 → 화면 반영',t.renderMs],['첫 응답 대기',t.firstReplyMs],['큐 대기',t.queueMs],['전체',t.totalMs]].map(([label,ms])=>{
        if (!Number.isFinite(ms)) return `${label}: —`;
        const ticks=Math.max(0,Math.round(ms*10));
        return `${label}: ${String(Math.floor(ticks/600000)).padStart(2,'0')}:${String(Math.floor(ticks/10000)%60).padStart(2,'0')}.${String(ticks%10000).padStart(4,'0')}`;
      });
      const value = `수신 대답속도 측정${message.mode==='demo'?' · 체험(CLI 측정 없음)':''}\n${rows.join('\n')}`;
      if (timingBlock.textContent !== value) timingBlock.textContent = value;
    } else timingBlock?.remove();
    const imageRoot=card.querySelector('.message-images');let attachmentRoot=card.querySelector('.message-attachments');
    if(!attachmentRoot){attachmentRoot=document.createElement('div');attachmentRoot.className='message-attachments';imageRoot.before(attachmentRoot);}
    const attachmentSignature=JSON.stringify(message.attachments??[]);
    if(attachmentRoot.dataset.signature!==attachmentSignature){
      for(const image of attachmentRoot.querySelectorAll('.generated-image'))responseImageObserver.unobserve(image);attachmentRoot.replaceChildren();attachmentRoot.dataset.signature=attachmentSignature;
      for(const attachment of message.attachments??[]){
        const figure=document.createElement('figure'),caption=document.createElement('figcaption'),label=document.createElement('span');label.textContent=attachment.name+' · '+Math.ceil(attachment.bytes/1024)+'KiB';
        if(attachment.kind==='image'){const image=document.createElement('img');image.className='generated-image attachment-image';image.alt=attachment.name;image.loading='lazy';image.dataset.messageId=message.id;image.dataset.attachmentId=attachment.id;figure.append(image);responseImageObserver.observe(image);}
        const open=document.createElement('button');open.type='button';open.className='text-button';open.textContent=attachment.kind==='image'?'원본 열기 ↗':'저장본 위치 ↗';open.addEventListener('click',()=>act('open-attachment',{messageId:message.id,id:attachment.id}));caption.append(label,open);figure.append(caption);attachmentRoot.append(figure);
      }
    }
    const imageSignature=JSON.stringify(message.images??[]);
    if(imageRoot.dataset.signature!==imageSignature){
      imageRoot.dataset.signature=imageSignature;for(const image of imageRoot.querySelectorAll('.generated-image'))responseImageObserver?.unobserve(image);imageRoot.replaceChildren();
      for(const result of message.images??[]){
        const figure=document.createElement('figure'),caption=document.createElement('figcaption');let controls;
        if(result.status==='ready'){
          const image=document.createElement('img');image.className='generated-image';image.alt='생성된 이미지';image.loading='lazy';image.dataset.messageId=message.id;image.dataset.imageId=result.id;image.width=Math.min(result.width,512);image.height=Math.round(image.width*result.height/result.width);
          image.addEventListener('load',()=>{delete image.dataset.failed;caption.querySelector('span').textContent=`${result.width} × ${result.height}`;acknowledgeRenderedMessages();});image.addEventListener('error',()=>{image.dataset.failed='true';caption.querySelector('span').textContent='미리보기를 표시하지 못했어요. 원본을 열어 확인해주세요.';acknowledgeRenderedMessages();});figure.append(image);responseImageObserver.observe(image);
          const description=document.createElement('span');description.textContent=`${result.width} × ${result.height}`;const open=document.createElement('button');open.type='button';open.className='text-button';open.textContent='원본 열기 ↗';open.addEventListener('click',()=>act('open-response-image',{messageId:message.id,imageId:result.id}));caption.append(description,open);
          controls=document.createElement('div');controls.className='image-actions';
          for(const [action,label]of [['copy-response-image','이미지 복사'],['save-response-image','다른 이름으로 저장'],['attach-response-image','다시 첨부']]){
            const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=label;
            button.addEventListener('click',async()=>{
              if(action==='attach-response-image'&&(queueEditOpening||submitting||pickingAttachments))return;button.disabled=true;
              if(action==='attach-response-image'){pickingAttachments=true;renderDraftAttachments();}
              try{
                const value=await act(action,{messageId:message.id,imageId:result.id});if(!value.ok||value.canceled)return;
                if(action==='attach-response-image'){
                  const key=value.conversationId??'new',next=[...(attachmentDrafts.get(key)??[]),...value.attachments];
                  if(next.length>8||next.reduce((sum,item)=>sum+item.bytes,0)>32*1024*1024){for(const item of value.attachments)await act('discard-attachment',{id:item.id});const toast=document.querySelector('#toast');toast.textContent='첨부는 최대 8개, 합계 32MiB까지 가능해요.';toast.hidden=false;return;}
                  attachmentDrafts.set(key,next);
                }else{button.textContent=action==='copy-response-image'?'복사됨':'저장됨';setTimeout(()=>{button.textContent=label;},1600);}
              }finally{button.disabled=false;if(action==='attach-response-image'){pickingAttachments=false;renderDraftAttachments();}}
            });controls.append(button);
          }
        }else caption.textContent=result.status==='pending'?'이미지를 준비하고 있어요…':result.error??'이미지 생성을 완료하지 못했어요.';
        figure.append(caption);if(controls)figure.append(controls);imageRoot.append(figure);
      }
    }
    const messageError = [message.error, message.displayTruncated ? '표시·복사 범위는 100,000자까지입니다. 가져온 원문은 로컬 파일에 보존합니다.' : message.textTruncated ? '응답이 100,000자 표시·보관 한도에 도달했습니다. 전체 원문은 CLI 세션에서 확인해주세요.' : null].filter(Boolean).join('\n');
    card.querySelector('.message-error').textContent = messageError; card.querySelector('.message-error').hidden = !messageError;
    const progress=card.querySelector('.message-progress'),progressSignature=JSON.stringify([message.purpose,message.skill,message.reviewSettings,message.reviewThreadModel,message.progress,message.tokenUsage]);
    if(progress.dataset.signature!==progressSignature){
      progress.dataset.signature=progressSignature;
      progress.hidden=!message.progress?.plan?.length&&!message.progress?.tools?.length&&!message.tokenUsage&&!message.reviewSettings&&!message.skill&&(!message.purpose||message.purpose==='conversation');
      const lines=[];
      if(message.purpose&&message.purpose!=='conversation')lines.push('목적: '+{summary:'요약',analyze:'분석',plan:'계획 모드',review:'전용 리뷰'}[message.purpose]);
      if(message.skill)lines.push('스킬: '+message.skill.name+' · 접수 원문 변경 여부를 실행 전에 확인');
      if(message.reviewSettings)lines.push(message.reviewSettings+(message.reviewThreadModel?' · CLI 대화 모델 '+message.reviewThreadModel:''));
      for(const item of message.progress?.plan??[])lines.push(({pending:'○',inProgress:'◉',completed:'✓'}[item.status])+' '+item.step);
      for(const item of message.progress?.tools??[])lines.push(({running:'진행',completed:'완료',failed:'실패',stopped:'종료 · 결과 미확인',declined:'승인 거절 · 실행하지 않음'}[item.status])+' · '+item.label);
      if(message.tokenUsage?.total)lines.push(`대화 누적 토큰: ${message.tokenUsage.total.totalTokens} (입력 ${message.tokenUsage.total.inputTokens} / 출력 ${message.tokenUsage.total.outputTokens})`);
      if(message.tokenUsage?.last)lines.push('최근 턴 토큰: '+message.tokenUsage.last.totalTokens);
      if(message.tokenUsage?.modelContextWindow)lines.push('모델 문맥 한도: '+message.tokenUsage.modelContextWindow+' · 현재 점유율은 확인 불가');
      progress.querySelector('div').textContent=lines.join('\n');
    }
    card.querySelector('.message-tools span').textContent = { queued: '대기 중', running: '답변 중', completed: '', interrupted: '중단됨 · 자동 재실행하지 않아요', failed: '연결 또는 작업 실패' }[message.status] ?? '';
    card.querySelector('.message-tools button').hidden = !message.text;
  }
  if (!state.messages.length) messages.scrollTop = 0;
  else if (prepended && !changedConversation) messages.scrollTop=previousTop+messages.scrollHeight-previousHeight;
  else if (atBottom || changedConversation || next.messagePatch?.reset || compactChanged) messages.scrollTop = messages.scrollHeight;
  document.querySelector('#jump-latest').hidden = !state.messages.length || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  if(panelRestored)for(const image of document.querySelectorAll('.generated-image:not([src])')){responseImageObserver.unobserve(image);responseImageObserver.observe(image);}
  const queueBar=document.querySelector('#queue-bar'),queueSignature=JSON.stringify([state.queue,state.queuePaused]);queueBar.hidden=state.queue.length===0;
  if(queueBar.dataset.signature!==queueSignature){
    queueBar.dataset.signature=queueSignature;queueBar.replaceChildren();
    if (state.queue.length) {
      const text = document.createElement('span'); text.textContent = `${state.queuePaused?'일시 정지된':'차례대로 기다리는'} 질문 ${state.queue.length}개 `; queueBar.append(text);
      if(state.queuePaused){const resume=document.createElement('button');resume.textContent='계속';resume.addEventListener('click',()=>act('continue-queue'));queueBar.append(resume);}
      for (const [i,item] of state.queue.entries()) {
        const row=document.createElement('div'),label=document.createElement('span'),edit=document.createElement('button'),cancel=document.createElement('button');row.className='queue-entry';label.textContent=`${i+1}. ${item.text.slice(0,45)}${item.attachmentCount?' · 첨부 '+item.attachmentCount+'개':''}${item.editing?' · 수정 중':''}`;label.title=`${item.text}\n${item.modelName??''} · ${item.personaName??''}`;
        edit.textContent='수정';edit.className='queue-edit';edit.disabled=Boolean(queueEditOpening||queueEditingUI||state.queueEdit||submitting||pickingAttachments||state.attachmentPicking);edit.addEventListener('click',async()=>{
          if(queueEditOpening||queueEditingUI||submitting||pickingAttachments||state.attachmentPicking)return;
          const input=document.querySelector('#prompt'),conversationId=state.activeConversationId,opening={id:item.id,token:null,invalidated:false};queueEditOpening=opening;renderDraftAttachments();
          try{
            const result=await act('edit-queued',{id:item.id});if(!result.ok)return;
            if(queueEditOpening!==opening||opening.invalidated||state.activeConversationId!==conversationId||!state.queue.some(entry=>entry.id===item.id)||state.queueEdit&&state.queueEdit.token!==result.token){
              await window.onggi.action('cancel-queue-edit',{token:result.token}).catch(()=>{});return;
            }
            queueEditingUI={...result,conversationId,draft:input.value,attachments:attachmentDrafts.get(conversationId??'new')??[]};input.value=result.text;attachmentDrafts.set(conversationId??'new',result.attachments);input.dispatchEvent(new Event('input'));
            if(activeTab==='chat'&&state.panelVisible!==false)input.focus();
          }finally{if(queueEditOpening===opening)queueEditOpening=null;renderDraftAttachments();}
        });
        cancel.textContent='취소';cancel.className='queue-cancel';cancel.dataset.queueId=item.id;cancel.disabled=Boolean(queueEditOpening||state.queueEdit?.saving&&item.editing);cancel.addEventListener('click',()=>act('cancel',{id:item.id}));row.append(label,edit,cancel);queueBar.append(row);
      }
      const all=document.createElement('button');all.textContent='대기 질문 모두 취소';all.className='queue-cancel-all';all.disabled=Boolean(queueEditOpening||state.queueEdit?.saving||pickingAttachments||state.attachmentPicking);all.addEventListener('click',()=>act('cancel-all-queued'));queueBar.append(all);
    }
  }
  const signature = JSON.stringify(state.requests.map(r => r.id));
  if (signature !== lastRequestSignature) {
    lastRequestSignature = signature;
    const requestRoot = document.querySelector('#requests'); requestRoot.hidden = !state.requests.length; requestRoot.replaceChildren();
    for (const request of state.requests) {
      const card = document.createElement('div'); card.className = 'request-card';
      const title = document.createElement('h3'); title.textContent = request.method === 'item/tool/requestUserInput' ? '옹기봇이 더 알고 싶어요' : '추가 권한을 확인해주세요'; card.append(title);
      if (request.method === 'item/tool/requestUserInput') {
        const fields = [];
        for (const question of request.params.questions) {
          const fieldId='request-'+requestRoot.children.length+'-'+fields.length;
          const label = document.createElement('label'); label.id=fieldId+'-label';label.htmlFor=fieldId;label.textContent = question.question; card.append(label);
          const input = document.createElement('input'); input.id=fieldId;input.maxLength = 8000; input.placeholder = '답변 입력';
          if (question.options?.length) { const options = document.createElement('select'); options.setAttribute('aria-labelledby',label.id);const empty = document.createElement('option'); empty.textContent = '직접 입력하거나 선택'; empty.value = ''; options.append(empty); for (const option of question.options) { const element = document.createElement('option'); element.value = option.label; element.textContent = option.label; options.append(element); } options.addEventListener('change', () => { input.value = options.value; }); card.append(options); }
          card.append(input); fields.push({ id: question.id, input });
        }
        const answer = document.createElement('button'); answer.textContent = '답변 보내기'; answer.addEventListener('click', () => act('respond', { id: request.id, answers: Object.fromEntries(fields.map(f => [f.id,f.input.value])) })); card.append(answer);
      } else {
        const description = document.createElement('pre'); description.textContent = [request.params.networkApprovalContext?'네트워크 접근 승인 · '+JSON.stringify(request.params.networkApprovalContext,null,2):null,request.params.command ?? request.details?.command,request.params.cwd,request.params.reason,request.details?.changes ? JSON.stringify(request.details.changes,null,2) : null,request.params.permissions ? JSON.stringify(request.params.permissions) : null].filter(Boolean).join('\n') || '작업에 추가 권한이 필요해요.'; card.append(description);
        if (request.details?.truncated) {const note=document.createElement('p');note.textContent='변경 내용이 너무 커 미리보기를 생략했습니다. 전체 내용을 확인할 수 없어 이 창에서는 허용하지 않습니다.';card.append(note);}
        if (request.method === 'item/permissions/requestApproval') {
          const note = document.createElement('p'); note.textContent = '알파에서는 추가 권한 프로필을 부여하지 않아요.'; card.append(note);
          const deny = document.createElement('button'); deny.textContent = '추가 권한 없이 진행'; deny.addEventListener('click', () => act('respond', { id: request.id })); card.append(deny);
        } else {
          for (const [decision, label] of [['accept','이번 작업 허용'],['decline','거절'],['cancel','취소']]) { const button = document.createElement('button'); button.textContent = label; button.disabled=decision==='accept'&&Boolean(request.details?.truncated||request.method==='item/fileChange/requestApproval'&&(!Array.isArray(request.details?.changes)||!request.details.changes.length)); button.addEventListener('click', () => act('respond', { id: request.id, decision })); card.append(button); }
        }
      }
      requestRoot.append(card);
    }
  }
  if (state.warning && state.warning !== lastWarning) { lastWarning = state.warning; document.querySelector('#toast').textContent = state.warning; document.querySelector('#toast').hidden = false; }
  acknowledgeRenderedMessages();
});

document.querySelector('#delete-cancel').addEventListener('click',()=>{document.querySelector('#delete-dialog').close();deletionTarget=null;});
document.querySelector('#delete-dialog').addEventListener('cancel',event=>{if(deleting)event.preventDefault();else deletionTarget=null;});
document.querySelector('#delete-confirm').addEventListener('click',async()=>{
  if(!deletionTarget||deleting)return;
  deleting=true;document.querySelector('#delete-confirm').disabled=true;document.querySelector('#delete-cancel').disabled=true;
  const result=await act('delete-conversation',{id:deletionTarget.id,confirmed:true});
  deleting=false;document.querySelector('#delete-confirm').disabled=false;document.querySelector('#delete-cancel').disabled=false;
  if(result.ok){document.querySelector('#toast').hidden=true;clearTimeout(toastTimer);for(const id of result.deletedIds){drafts.delete(id);renderAckIds.clear();}document.querySelector('#delete-dialog').close();deletionTarget=null;}
  else {const error=document.querySelector('#delete-error');error.textContent=document.querySelector('#toast').textContent;error.hidden=false;}
});

document.querySelector('#storage-cancel').addEventListener('click',async()=>{if((await act('storage-cancel')).ok)document.querySelector('#storage-notice').textContent='중단을 요청했어요. 이미 보관·복원한 파일과 복구본은 유지해요.';});
document.querySelector('#storage-inspect').addEventListener('click',async()=>{
  if(storageOperation)return;storageOperation=true;const button=document.querySelector('#storage-inspect');button.disabled=true;
  document.querySelector('#storage-quarantine').disabled=true;storagePreview=null;
  try{
    const result=await act('storage-inspect');if(!result.ok)return;storagePreview=result;
    const candidates=result.items.filter(item=>item.eligible),items=[...candidates,...result.items.filter(item=>!item.eligible)].slice(0,128);
    document.querySelector('#storage-status').textContent=`캐시 ${(result.bytes/1048576).toFixed(2)}MiB · 참조 중 ${(result.referencedBytes/1048576).toFixed(2)}MiB · 복구 보관 가능 ${candidates.length}개 · ${items.length}/${result.items.length}개 표시\n${result.warnings.join('\n')}\n${result.preserved}\n${result.preservedGroups.map(group=>group.name+': '+(group.bytes/1048576).toFixed(2)+'MiB'+(group.limited?' · 일부 조회':'')).join('\n')}`;
    const list=document.querySelector('#storage-files');list.replaceChildren();
    for(const [index,item]of items.entries()){
      const row=document.createElement('label');row.className='storage-file';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='storage-item-'+index;checkbox.dataset.storageId=item.id;checkbox.disabled=!item.eligible;row.htmlFor=checkbox.id;
      const text=document.createElement('span');text.textContent=item.name+' · '+Math.ceil(item.bytes/1024)+'KiB\n'+item.reason;row.append(checkbox,text);list.append(row);
      checkbox.addEventListener('change',()=>{document.querySelector('#storage-quarantine').disabled=storageOperation||!list.querySelector('input:checked');});
    }
    const batches=document.querySelector('#storage-batches');batches.replaceChildren();
    for(const batch of result.batches){
      const restore=document.createElement('button');restore.type='button';restore.className='text-button';restore.textContent='보관본 복원 · '+batch.id.slice(0,8);
      restore.addEventListener('click',async()=>{
        if(storageOperation)return;storageOperation=true;restore.disabled=true;
        let refresh=false;
        try{const restored=await act('storage-restore',{id:batch.id});if(restored.ok){document.querySelector('#storage-notice').textContent=`${restored.restored.length}개 복원 · 기존 파일과 복구본 보존\n${restored.warnings.join('\n')}`;refresh=true;}}
        finally{storageOperation=false;restore.disabled=false;}
        if(refresh){button.disabled=false;button.click();}
      });batches.append(restore);
    }
  }finally{storageOperation=false;button.disabled=false;}
});
document.querySelector('#storage-quarantine').addEventListener('click',async()=>{
  if(storageOperation||!storagePreview)return;storageOperation=true;const button=document.querySelector('#storage-quarantine');button.disabled=true;
  let refresh=false;
  try{
    const ids=[...document.querySelectorAll('#storage-files input:checked')].map(input=>input.dataset.storageId);
    const result=await act('storage-quarantine',{token:storagePreview.token,ids});
    if(result.ok){document.querySelector('#storage-notice').textContent=`${result.moved.length}개 복구 보관${result.partial?' · 일부만 처리':''} · 영구 삭제 없음\n${result.warnings.join('\n')}`;refresh=true;}
  }finally{storageOperation=false;}
  if(refresh){const inspect=document.querySelector('#storage-inspect');inspect.disabled=false;inspect.click();}
});
window.onggi.onTab(showTab);
document.querySelector('#rename-conversation-cancel').addEventListener('click',()=>document.querySelector('#rename-conversation-dialog').close());
document.querySelector('#rename-conversation-form').addEventListener('submit',async event=>{event.preventDefault();const button=document.querySelector('#rename-conversation-save');button.disabled=true;try{if((await act('conversation-meta',{id:renameConversationId,title:document.querySelector('#conversation-title').value})).ok)document.querySelector('#rename-conversation-dialog').close();}finally{button.disabled=false;}});
document.querySelector('#history-body-search').addEventListener('click',async()=>{
  if(bodySearchRunning)return;bodySearchRunning=true;
  const button=document.querySelector('#history-body-search'),query=document.querySelector('#history-search').value,revision=bodySearchRevision;button.disabled=true;
  try{
    const result=await act('search-conversations',{query});
    if(result.ok&&revision===bodySearchRevision){
      bodySearch=result;document.querySelector('#history-reset-search').hidden=false;
      const status=document.querySelector('#history-search-status');status.hidden=false;
      status.textContent=`본문 검색 ${result.matches.length}개 · 최근 기록 ${result.scanned}개 확인${result.limited?' · 최대 100개/32MiB/결과 50개로 제한':''}`;historySignature='';renderHistory();
    }
  }finally{bodySearchRunning=false;button.disabled=false;}
});
document.querySelector('#history-reset-search').addEventListener('click',()=>{bodySearchRevision++;if(bodySearchRunning)void act('cancel-search');bodySearch=null;document.querySelector('#history-reset-search').hidden=true;document.querySelector('#history-search-status').hidden=true;historySignature='';renderHistory();});
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => showTab(button.dataset.tab));
document.querySelector('#close-panel').addEventListener('click', () => act('hide-panel'));
document.querySelector('#close-mini').addEventListener('click',()=>act('hide-panel'));
document.querySelector('#expand-chat').addEventListener('click',()=>act('show-panel',{tab:'chat',full:true}));
document.querySelector('#mini-settings').addEventListener('click',()=>act('show-panel',{tab:'settings'}));
for(const [id,key]of [['skin-select','skinId'],['chat-mode','chatMode']])document.querySelector('#'+id).addEventListener('change',async event=>{const result=await act('settings',{[key]:event.target.value});if(!result.ok)void act('sync');});
document.querySelector('#persona-select').addEventListener('change',async event=>{const result=await act('persona-settings',{characterId:state.settings.characterId,mode:event.target.value});if(!result.ok)void act('sync');});
document.querySelector('#persona-character').addEventListener('change',()=>{
  const character=document.querySelector('#persona-character').value,selector=document.querySelector('#persona-edit-mode'),previous=selector.value;selector.replaceChildren();
  for(const entry of personaCatalog.find(p=>p.characterId===character)?.entries??[]){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name+(entry.archived?' · 보관':'');selector.append(option);}
  if([...selector.options].some(o=>o.value===previous))selector.value=previous;
  selector.dispatchEvent(new Event('change'));
});
document.querySelector('#persona-edit-mode').addEventListener('change',()=>{
  const character=document.querySelector('#persona-character').value,id=document.querySelector('#persona-edit-mode').value,group=personaCatalog.find(p=>p.characterId===character),entry=group?.entries.find(e=>e.id===id);
  const signature=JSON.stringify([character,id,entry?.text]);if(signature===editorSignature)return;editorSignature=signature;
  document.querySelector('#persona-text').value=editorDrafts.get(character+':'+id)??entry?.text??'';
  document.querySelector('#persona-mode-name').value=entry?.name??'';
  document.querySelector('#save-persona').disabled=Boolean(entry?.archived||group?.warning);
  document.querySelector('#persona-rename').disabled=entry?.kind!=='user';document.querySelector('#persona-archive').disabled=entry?.kind!=='user'||Boolean(entry?.archived);document.querySelector('#persona-unarchive').disabled=!entry?.archived;document.querySelector('#persona-reset').disabled=entry?.kind==='user';
  const status=document.querySelector('#persona-editor-status');status.hidden=!entry?.error&&!group?.warning;if(group?.warning)status.textContent='말투 목록 복구가 필요해요. '+group.warning+' MD 폴더에서 원본을 확인한 뒤 파일 다시 읽기를 눌러주세요.';else if(entry?.error)status.textContent=entry.error+' 내용을 다시 입력해서 저장할 수 있어요.';
});
document.querySelector('#persona-editor-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=document.querySelector('#save-persona'),status=document.querySelector('#persona-editor-status');if(button.disabled)return;button.disabled=true;
  const characterId=document.querySelector('#persona-character').value,id=document.querySelector('#persona-edit-mode').value,text=document.querySelector('#persona-text').value,key=characterId+':'+id;
  const result=await act('persona-save',{characterId,id,text});
  if(result.ok&&(!editorDrafts.has(key)||editorDrafts.get(key)===text))editorDrafts.delete(key);
  if(document.querySelector('#persona-character').value===characterId&&document.querySelector('#persona-edit-mode').value===id){if(result.ok)editorSignature=JSON.stringify([characterId,id,text]);status.textContent=result.ok?'Markdown을 저장했어요. 다음 질문부터 적용돼요.':'저장하지 못했어요. 내용을 확인해주세요.';status.hidden=false;}
  button.disabled=Boolean(personaCatalog.find(p=>p.characterId===document.querySelector('#persona-character').value)?.entries.find(e=>e.id===document.querySelector('#persona-edit-mode').value)?.archived);
});
document.querySelector('#reload-personas').addEventListener('click',async()=>{editorSignature='';personaSignature='';await act('persona-reload');});
document.querySelector('#persona-text').addEventListener('input',event=>{editorDrafts.set(document.querySelector('#persona-character').value+':'+document.querySelector('#persona-edit-mode').value,event.target.value);});
document.querySelector('#open-personas').addEventListener('click',()=>act('open-personas'));
document.querySelector('#load-older').addEventListener('click',async event=>{event.currentTarget.disabled=true;const result=await act('load-older');if(!result.ok)document.querySelector('#load-older').disabled=false;});
document.querySelector('#cancel-history').addEventListener('click',()=>act('cancel-history'));
document.querySelector('#new-chat').addEventListener('click', () => act('new-chat'));
document.querySelector('#history-search').addEventListener('input',()=>{bodySearchRevision++;if(bodySearchRunning)void act('cancel-search');bodySearch=null;document.querySelector('#history-reset-search').hidden=true;document.querySelector('#history-search-status').hidden=true;renderHistory();});
document.querySelector('#refresh-skills').addEventListener('click',()=>act('skills-list'));
document.querySelector('#refresh-usage').addEventListener('click',()=>act('usage-refresh'));
document.querySelector('#task-purpose').addEventListener('change',event=>{document.querySelector('#task-options-label').textContent='목적: '+event.target.selectedOptions[0].textContent+' · 스킬';renderDraftAttachments();});
document.querySelector('#task-skill').addEventListener('change',()=>renderDraftAttachments());
document.querySelector('#history-new').addEventListener('click',async()=>{const result=await act('new-chat');if(result.ok)showTab('chat');});
document.querySelector('#stop').addEventListener('click', () => act('cancel'));
document.querySelector('#refresh-models').addEventListener('click', () => act('refresh-models'));
for(const id of ['reconnect','connection-retry','check-connection'])document.querySelector('#'+id).addEventListener('click',()=>{if(id==='check-connection')showTab('chat');void act('recover-connection');});
document.querySelector('#login-chatgpt').addEventListener('click',async()=>{const button=document.querySelector('#login-chatgpt');button.disabled=true;try{await act('login-chatgpt');}finally{button.disabled=false;}});
document.querySelector('#cancel-login').addEventListener('click',()=>act('cancel-login'));
document.querySelector('#refresh-conversation').addEventListener('click',()=>{if(state?.activeConversationId)void act('open-conversation',{id:state.activeConversationId});});
document.querySelector('#find-cli').addEventListener('click',()=>act('find-cli'));
document.querySelector('#connection-workspace').addEventListener('click',()=>act('pick-workspace'));
document.querySelector('#install-cli').addEventListener('click',()=>act('open-url',{url:'https://learn.chatgpt.com/docs/codex/cli'}));
document.querySelector('#model-popover').addEventListener('toggle',event=>{
  if(event.newState!=='open'){renderDraftAttachments();return;}
  const composerMenu=document.querySelector('#composer-popover');if(composerMenu.matches(':popover-open'))composerMenu.hidePopover();
  const menu=event.currentTarget,trigger=document.querySelector('#model-menu-toggle').getBoundingClientRect();
  menu.style.left=Math.max(12,Math.min(innerWidth-menu.offsetWidth-12,trigger.right-menu.offsetWidth))+'px';
  menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,trigger.top-menu.offsetHeight-8))+'px';
  renderDraftAttachments();
});
document.querySelector('#composer-popover').addEventListener('toggle',event=>{
  const menu=event.currentTarget,button=document.querySelector('#composer-menu-toggle');button.setAttribute('aria-expanded',String(event.newState==='open'));
  if(event.newState==='open'){
    const modelMenu=document.querySelector('#model-popover');if(modelMenu.matches(':popover-open'))modelMenu.hidePopover();
    const trigger=button.getBoundingClientRect();menu.style.left=Math.max(12,Math.min(innerWidth-menu.offsetWidth-12,trigger.left))+'px';menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,trigger.top-menu.offsetHeight-8))+'px';
  }
  renderDraftAttachments();
});
for(const id of ['attach-image','attach-file','paste-image'])document.querySelector('#'+id).addEventListener('click',()=>{const menu=document.querySelector('#composer-popover');if(menu.matches(':popover-open'))menu.hidePopover();});
document.querySelector('#composer-popover').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('select'))event.stopPropagation();});
window.addEventListener('resize',()=>{
  for(const [id,buttonId,rightAligned]of [['model-popover','model-menu-toggle',true],['composer-popover','composer-menu-toggle',false]]){
    const menu=document.querySelector('#'+id);if(!menu.matches(':popover-open'))continue;
    const trigger=document.querySelector('#'+buttonId).getBoundingClientRect();
    menu.style.left=Math.max(12,Math.min(innerWidth-menu.offsetWidth-12,rightAligned?trigger.right-menu.offsetWidth:trigger.left))+'px';
    menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,trigger.top-menu.offsetHeight-8))+'px';
  }
});
window.addEventListener('blur',()=>{if(resizeGesture){const old=resizeGesture;resizeGesture=null;void act('resize-end',{token:old.token});if(old.target.hasPointerCapture?.(old.pointerId))old.target.releasePointerCapture(old.pointerId);}});
for (const id of ['model-select','effort-select','speed-select']) document.querySelector('#' + id).addEventListener('change', async () => {
  if (modelSaving) return;
  modelSaving = true;
  const model = document.querySelector('#model-select').value;
  const effort = id === 'model-select' ? '' : document.querySelector('#effort-select').value;
  let serviceTier = document.querySelector('#speed-select').value;
  if (id === 'model-select' && serviceTier !== 'default' && !state.models.find(m => m.model === (model || state.modelDefaults.model))?.serviceTiers.some(t => t.id === serviceTier)) serviceTier = 'default';
  for (const control of ['model-select','effort-select','speed-select']) document.querySelector('#'+control).disabled = true;
  await act('model-settings', { model, effort, serviceTier }); modelSaving = false; modelSignature = ''; await act('sync');
});
for (const event of ['pointerenter','focusin']) document.querySelector('.model-bar').addEventListener(event,()=>{if(state && state.connection!=='demo' && !modelSaving)void act('refresh-models',{ifStale:true});});
for(const control of ['model-select','effort-select','speed-select'])document.querySelector('#'+control).addEventListener('blur',()=>void act('sync',{includeCatalog:false}));
document.querySelector('#messages').addEventListener('click', event => {
  const link = event.target.closest('.markdown-body a');
  if (link) { event.preventDefault(); void act('open-url', { url: link.getAttribute('href') }); }
});
document.querySelector('#messages').addEventListener('scroll',event=>{const messages=event.currentTarget;document.querySelector('#jump-latest').hidden=!state?.messages.length||messages.scrollHeight-messages.scrollTop-messages.clientHeight<90;if(state?.unreadReply)acknowledgeRenderedMessages();},{passive:true});
document.querySelector('#jump-latest').addEventListener('click',()=>{const messages=document.querySelector('#messages');messages.scrollTop=messages.scrollHeight;document.querySelector('#jump-latest').hidden=true;});
for(const id of ['import-pack','pack-restore'])document.querySelector('#'+id).addEventListener('click',async()=>{
  if(packOperation)return;packOperation=true;
  try{const result=await act('pack-preview',id==='pack-restore'?{archiveToken:document.querySelector('#pack-archive-select').value}:{});if(!result.ok||result.canceled)return;
    packPreviewUi=result;document.querySelector('#pack-preview-image').src=result.pack.thumbnail;document.querySelector('#pack-preview-error-image').src=result.pack.errorThumbnail;
    document.querySelector('#pack-preview-description').textContent=[result.pack.name+' · '+result.pack.version,result.pack.description,result.installedVersion?'기존 버전: '+result.installedVersion:null,result.pack.author?'제작: '+result.pack.author:null,result.pack.license?'이용 조건: '+result.pack.license:null,result.pack.source?'출처: '+result.pack.source:null,result.pack.hasPoster?'자동 재생 이미지는 정적 대표 프레임으로 표시해요.':null].filter(Boolean).join('\n');
    document.querySelector('#pack-replace-row').hidden=!result.installedVersion;document.querySelector('#pack-replace').checked=false;document.querySelector('#pack-select-after').checked=false;document.querySelector('#pack-preview-status').hidden=true;document.querySelector('#pack-preview-dialog').showModal();document.querySelector('#pack-preview-cancel').focus();
  }finally{packOperation=false;}
});
document.querySelector('#pack-preview-apply').addEventListener('click',async()=>{
  if(!packPreviewUi||packOperation)return;packOperation=true;const button=document.querySelector('#pack-preview-apply');button.disabled=true;
  try{const result=await act('pack-apply',{token:packPreviewUi.token,replace:document.querySelector('#pack-replace').checked,select:document.querySelector('#pack-select-after').checked});if(result.ok)document.querySelector('#pack-preview-dialog').close();else{document.querySelector('#pack-preview-status').hidden=false;document.querySelector('#pack-preview-status').textContent='적용하지 못했어요. 안내를 확인하고 다시 시도해주세요.';}}finally{packOperation=false;button.disabled=false;}
});
document.querySelector('#pack-preview-cancel').addEventListener('click',()=>{if(!packOperation)document.querySelector('#pack-preview-dialog').close();});
document.querySelector('#pack-preview-dialog').addEventListener('cancel',event=>{if(packOperation)event.preventDefault();});
document.querySelector('#pack-preview-dialog').addEventListener('close',()=>{if(packPreviewUi)void act('pack-discard-preview',{token:packPreviewUi.token});packPreviewUi=null;});
document.querySelector('#pack-manage-select').addEventListener('change',event=>{const pack=catalog.find(p=>p.id===event.target.value);document.querySelector('#pack-metadata').textContent=pack?[pack.name+' · '+pack.version,pack.author,pack.license,pack.source].filter(Boolean).join(' · '):'';document.querySelector('#pack-remove').disabled=!pack||pack.builtin;});
document.querySelector('#pack-export').addEventListener('click',async()=>{const result=await act('pack-export',{id:document.querySelector('#pack-manage-select').value,includeEdited:document.querySelector('#pack-export-edited').checked});const status=document.querySelector('#pack-manage-status');if(result.ok&&!result.canceled){status.hidden=false;status.textContent='내보냈어요: '+result.destination;}});
document.querySelector('#pack-remove').addEventListener('click',()=>{packRemoveTarget=document.querySelector('#pack-manage-select').value;document.querySelector('#pack-remove-description').textContent=catalog.find(p=>p.id===packRemoveTarget)?.name??'';document.querySelector('#pack-remove-dialog').showModal();document.querySelector('#pack-remove-cancel').focus();});
document.querySelector('#pack-remove-cancel').addEventListener('click',()=>{if(!packOperation)document.querySelector('#pack-remove-dialog').close();});
document.querySelector('#pack-remove-dialog').addEventListener('cancel',event=>{if(packOperation)event.preventDefault();});
document.querySelector('#pack-remove-confirm').addEventListener('click',async()=>{if(packOperation)return;packOperation=true;const button=document.querySelector('#pack-remove-confirm');button.disabled=true;try{const result=await act('pack-remove',{id:packRemoveTarget,confirmed:true});if(result.ok)document.querySelector('#pack-remove-dialog').close();}finally{packOperation=false;button.disabled=false;}});
document.querySelector('#pick-workspace').addEventListener('click', () => act('pick-workspace'));
document.querySelector('#pick-codex').addEventListener('click', () => act('pick-codex'));
document.querySelector('#open-data').addEventListener('click', () => act('open-data'));
document.querySelector('#export-diagnostics').addEventListener('click',()=>act('export-diagnostics'));
document.querySelector('#buddy-name').addEventListener('input',()=>{document.querySelector('#buddy-name-status').hidden=true;document.querySelector('#buddy-name').removeAttribute('aria-invalid');});
document.querySelector('#buddy-name-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const input=document.querySelector('#buddy-name'),button=document.querySelector('#save-buddy-name'),status=document.querySelector('#buddy-name-status');
  if(button.disabled)return;
  button.disabled=true;status.hidden=true;input.removeAttribute('aria-invalid');
  try{
    const result=await window.onggi.action('rename-buddy',{name:input.value});
    if(!result.ok)throw new Error('이름을 저장하지 못했어요. 다시 시도해주세요.');
    input.value=result.name;status.textContent='이름을 저장했어요.';status.classList.remove('name-error');status.hidden=false;
  }catch(error){
    status.textContent=error.message.replace(/^Error invoking remote method 'action': Error: /,'');status.classList.add('name-error');status.hidden=false;input.setAttribute('aria-invalid','true');input.focus();
  }finally{button.disabled=false;}
});
for (const [id,key] of [['demo-mode','demo'],['reduced-motion','reducedMotion'],['always-on-top','alwaysOnTop'],['measure-response-time','measureResponseTime'],['battery-saver','batterySaver'],['notify-completed','notifyCompleted'],['notify-approval','notifyApproval'],['notify-failed','notifyFailed'],['notify-preview','notifyPreview'],['notify-sound','notifySound'],['quiet-hours','quietHoursEnabled']]) document.querySelector('#' + id).addEventListener('change', event => { void act('settings', { [key]: event.target.checked }).then(result => { if (!result.ok) void act('sync'); }); });
document.querySelector('#approval-display').addEventListener('change',event=>void act('settings',{approvalDisplay:event.target.value}));
for(const [id,key]of [['quiet-start','quietStart'],['quiet-end','quietEnd']])document.querySelector('#'+id).addEventListener('change',event=>{const parts=event.target.value.split(':').map(Number);if(parts.length===2&&parts.every(Number.isInteger))void act('settings',{[key]:parts[0]*60+parts[1]}).then(result=>{if(!result.ok)void act('sync');});});
document.querySelector('#composer').addEventListener('submit', async event => {
  event.preventDefault(); const input = document.querySelector('#prompt'), text = input.value,conversationId=state?.activeConversationId,attachmentIds=(attachmentDrafts.get(conversationId??'new')??[]).map(a=>a.id);
  if(queueEditOpening||submitting||pickingAttachments||state?.attachmentPicking||!text.trim()&&!attachmentIds.length)return;
  submitting=true;document.querySelector('#send').disabled=true;
  try{
    if(queueEditingUI){
      const edit=queueEditingUI;const result=await act('save-queued',{id:edit.id,token:edit.token,text,attachmentIds});
      if(result.ok){queueEditingUI=null;input.value=edit.draft;attachmentDrafts.set(edit.conversationId??'new',edit.attachments);input.dispatchEvent(new Event('input'));}return;
    }
    const result=await act('send',{text,attachmentIds,purpose:document.querySelector('#task-purpose').value,skillToken:document.querySelector('#task-skill').value,submittedAt:performance.timeOrigin+performance.now()});
    if(result.ok){for(const key of [conversationId??'new',result.conversationId])attachmentDrafts.set(key,(attachmentDrafts.get(key)??[]).filter(a=>!attachmentIds.includes(a.id)));}
    if(result.ok&&input.value===text){input.value='';input.dispatchEvent(new Event('input'));}
    if(result.ok&&!conversationId&&result.conversationId){drafts.set(result.conversationId,input.value);if(!state?.activeConversationId)createdConversationId=result.conversationId;drafts.delete('new');}
  }finally{submitting=false;renderDraftAttachments();}
});
document.querySelector('#pause-queue').addEventListener('click',()=>act(state?.queuePaused?'continue-queue':'pause-queue'));
document.querySelector('#cancel-queue-edit').addEventListener('click',async()=>{
  const edit=queueEditingUI;if(!edit)return;const result=await act('cancel-queue-edit',{token:edit.token});
  if(result.ok&&queueEditingUI===edit){const input=document.querySelector('#prompt');queueEditingUI=null;input.value=edit.draft;attachmentDrafts.set(edit.conversationId??'new',edit.attachments);input.dispatchEvent(new Event('input'));renderDraftAttachments();}
});
for(const [id,kind]of [['attach-image','image'],['attach-file','file']])document.querySelector('#'+id).addEventListener('click',async()=>{
  if(queueEditOpening||submitting||pickingAttachments)return;pickingAttachments=true;renderDraftAttachments();
  try{
    const result=await act('pick-attachments',{kind});if(!result.ok)return;const key=state?.activeConversationId??'new',previous=attachmentDrafts.get(key)??[],next=[...previous,...result.attachments];
    if(next.length>8||next.reduce((sum,a)=>sum+a.bytes,0)>32*1024*1024){for(const attachment of result.attachments)await act('discard-attachment',{id:attachment.id});const toast=document.querySelector('#toast');toast.textContent='첨부는 최대 8개, 합계 32MiB까지 가능해요.';toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},6500);return;}
    attachmentDrafts.set(key,next);
  }finally{pickingAttachments=false;renderDraftAttachments();}
});
for(const [id,key]of [['font-scale','fontScale'],['mini-size','miniSize'],['send-key','sendKey'],['hotkey','hotkey']])document.querySelector('#'+id).addEventListener('change',event=>void act('settings',{[key]:key==='fontScale'?Number(event.target.value):event.target.value}).then(result=>{if(!result.ok)void act('sync');}));
document.querySelector('#retry-shortcut').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await act('settings',{hotkey:document.querySelector('#hotkey').value});}finally{button.disabled=false;}});
document.querySelector('#prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229 && (state?.settings.sendKey==='modifier-enter'?(event.metaKey||event.ctrlKey):!event.metaKey&&!event.ctrlKey)) { event.preventDefault(); document.querySelector('#composer').requestSubmit(); } });
document.querySelector('#prompt').addEventListener('compositionstart',()=>{composerComposing=true;renderDraftAttachments();});
document.querySelector('#prompt').addEventListener('compositionend',()=>{composerComposing=false;renderDraftAttachments();});
window.onggi.onAttachments(async result=>{
  if(result.pending){pickingAttachments=true;renderDraftAttachments();return;}
  try{
    if(!result.ok){const toast=document.querySelector('#toast');toast.textContent=String(result.error??'첨부를 가져오지 못했어요.');toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},6500);return;}
    const key=result.conversationId??'new',previous=attachmentDrafts.get(key)??[],next=[...previous,...result.attachments];
    if(next.length>8||next.reduce((sum,item)=>sum+item.bytes,0)>32*1024*1024){for(const item of result.attachments)await act('discard-attachment',{id:item.id});const toast=document.querySelector('#toast');toast.textContent='첨부는 최대 8개, 합계 32MiB까지 가능해요.';toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},6500);return;}
    attachmentDrafts.set(key,next);
  }finally{pickingAttachments=false;renderDraftAttachments();}
});
window.onggi.onNotificationOpen(async({conversationId})=>{if(!state||state.busy||state.preparing||state.queue.length)return;const result=await act('open-conversation',{id:conversationId});if(result.ok)showTab('chat');});
document.querySelector('#prompt').addEventListener('input', event => {
  const input=event.target;input.style.height='auto';input.style.height=Math.min(parseFloat(getComputedStyle(input).maxHeight),Math.max(parseFloat(getComputedStyle(input).minHeight),input.scrollHeight))+'px';
  if (state && !state.busy && !state.sleeping) renderCharacter(event.target.value ? 'listening' : state.characterState);
  const listening = Boolean(event.target.value); if (listening !== lastListening) { lastListening = listening; void act('activity', { listening }); }
  renderDraftAttachments();
});
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => { const input=document.querySelector('#prompt');input.value = button.dataset.prompt;input.dispatchEvent(new Event('input'));input.focus(); });
for (const id of ['pet-bubble','pet-chat']) document.querySelector('#' + id).addEventListener('click', () => act('show-panel', { tab: 'chat' }));
document.querySelector('#pet-settings').addEventListener('click', () => act('show-panel', { tab: 'settings' }));
document.querySelector('#pet-sleep').addEventListener('click', () => act('sleep'));
const petCharacter = document.querySelector('#pet-character');
petCharacter.addEventListener('pointerenter', () => {
  if (surface === 'pet' && state && !drag) {
    const root=document.querySelector('#pet-surface');
    if(!petPointerInsideCharacter&&!root.classList.contains('pet-active')){
      root.classList.add('pet-active');clearTimeout(controlsTimer);
      controlsTimer=setTimeout(()=>{root.classList.remove('pet-active');void syncPetLayout();},3000);
    }
    petHovering = true;
    if (petCharacter.dataset.state === 'idle') { clearTimeout(bubbleTimer); document.querySelector('#pet-bubble').hidden = false; void syncPetLayout(); }
    else void syncPetLayout();
  }
});
petCharacter.addEventListener('pointerleave', () => {
  petHovering = false;
  if (surface === 'pet' && !drag && petCharacter.dataset.state === 'idle') {
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { document.querySelector('#pet-bubble').hidden = true; void syncPetLayout(); },3000);
  }
});
petCharacter.addEventListener('pointerdown', async event => {
  if (event.button !== 0) return;
  const gesture = {x:event.screenX,y:event.screenY,lastX:event.screenX,lastY:event.screenY,moved:false,ready:false}; drag = gesture;
  clearTimeout(controlsTimer);document.querySelector('#pet-surface').classList.remove('pet-active');
  document.querySelector('#pet-surface').classList.add('pet-dragging');
  syncAnimation();
  petCharacter.setPointerCapture(event.pointerId); clearTimeout(bubbleTimer); document.querySelector('#pet-bubble').hidden = true;
  await syncPetLayout();
  if (drag !== gesture) return;
  await act('drag-start',{x:gesture.x,y:gesture.y});
  if (drag !== gesture) { void act('drag-end'); return; }
  gesture.ready = true;
  if (gesture.moved) void act('drag-move',{x:gesture.lastX,y:gesture.lastY});
});
petCharacter.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.screenX - drag.x, dy = event.screenY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3 || drag.moved) { drag.moved = true; drag.lastX = event.screenX; drag.lastY = event.screenY; if (drag.ready) void act('drag-move', {x:event.screenX,y:event.screenY}); }
});
petCharacter.addEventListener('pointerup', () => { if (drag && !drag.moved) void act('show-panel', { tab: 'chat' }); void act('drag-end').then(()=>{petLayoutSignature='';void syncPetLayout();}); drag = null; document.querySelector('#pet-surface').classList.remove('pet-dragging'); });
petCharacter.addEventListener('pointercancel', () => { void act('drag-end').then(()=>{petLayoutSignature='';void syncPetLayout();}); drag = null; document.querySelector('#pet-surface').classList.remove('pet-dragging'); });
petCharacter.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void act('show-panel', { tab: 'chat' }); } });
for(const corner of ['nw','ne','sw','se']){
  const handle=document.querySelector('#resize-'+corner);
  handle.addEventListener('pointerdown',async event=>{
    if(surface!=='panel'||state?.compactMode||resizeGesture||event.button!==0||document.querySelector('dialog[open]'))return;
    event.preventDefault();handle.setPointerCapture(event.pointerId);
    const gesture={target:handle,pointerId:event.pointerId,token:null,latest:null,sending:false,frame:false,finalPoint:null};resizeGesture=gesture;
    gesture.flush=async()=>{
      gesture.frame=false;if(resizeGesture!==gesture||!gesture.token||gesture.sending||!gesture.latest)return;
      const point=gesture.latest;gesture.latest=null;gesture.sending=true;
      try{const result=await act('resize-move',{token:gesture.token,...point});if(!result.ok&&resizeGesture===gesture){resizeGesture=null;if(handle.hasPointerCapture(gesture.pointerId))handle.releasePointerCapture(gesture.pointerId);}}
      finally{gesture.sending=false;if(resizeGesture===gesture&&gesture.latest&&!gesture.frame){gesture.frame=true;requestAnimationFrame(gesture.flush);}}
    };
    const result=await act('resize-start',{corner,x:event.screenX,y:event.screenY});
    if(resizeGesture!==gesture){if(result.ok){if(gesture.finalPoint)await act('resize-move',{token:result.token,...gesture.finalPoint});await act('resize-end',{token:result.token});}return;}
    if(!result.ok){resizeGesture=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);return;}
    gesture.token=result.token;if(gesture.latest&&!gesture.frame){gesture.frame=true;requestAnimationFrame(gesture.flush);}
  });
  handle.addEventListener('keydown',async event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||state?.compactMode||resizeGesture||document.querySelector('dialog[open]'))return;
    event.preventDefault();const step=event.shiftKey?32:8,bounds=handle.getBoundingClientRect(),x=window.screenX+bounds.left,y=window.screenY+bounds.top;
    const result=await act('resize-start',{corner,x,y});if(!result.ok)return;
    try{await act('resize-move',{token:result.token,x:x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)});}finally{await act('resize-end',{token:result.token});}
  });
}
document.addEventListener('pointermove',event=>{
  const gesture=resizeGesture;if(!gesture||gesture.pointerId!==event.pointerId)return;
  gesture.latest={x:event.screenX,y:event.screenY};if(gesture.token&&!gesture.frame&&!gesture.sending){gesture.frame=true;requestAnimationFrame(gesture.flush);}
},true);
for(const eventName of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(eventName,event=>{
  const gesture=resizeGesture;if(!gesture||gesture.pointerId!==event.pointerId)return;resizeGesture=null;
  if(eventName==='pointerup')gesture.finalPoint={x:event.screenX,y:event.screenY};
  if(gesture.token)void(async()=>{if(gesture.finalPoint)await act('resize-move',{token:gesture.token,...gesture.finalPoint});await act('resize-end',{token:gesture.token});})();if(gesture.target.hasPointerCapture(event.pointerId))gesture.target.releasePointerCapture(event.pointerId);
},true);
document.addEventListener('keydown', event => {
  if(event.key!=='Escape'||surface!=='panel'||event.defaultPrevented)return;
  const dialog=document.querySelector('dialog[open]');
  if(dialog){if(dialog.id==='delete-dialog'&&deleting||['pack-preview-dialog','pack-remove-dialog'].includes(dialog.id)&&packOperation)event.preventDefault();return;}
  const menu=document.querySelector('#model-popover'),composerMenu=document.querySelector('#composer-popover');
  if(composerMenu.matches(':popover-open')){event.preventDefault();composerMenu.hidePopover();document.querySelector('#composer-menu-toggle').focus();}
  else if(menu.matches(':popover-open')){event.preventDefault();menu.hidePopover();document.querySelector('#model-menu-toggle').focus();}else void act('hide-panel');
});
document.addEventListener('visibilitychange', () => { document.body.classList.toggle('page-hidden', document.hidden);syncAnimation();if(!document.hidden)void act('sync'); });
if (surface === 'pet') window.onggi.onPetPointer(pointer => {
  const root = document.querySelector('#pet-surface');
  const entering=pointer.insideCharacter&&!petPointerInsideCharacter, leaving=!pointer.insideCharacter&&petPointerInsideCharacter;petPointerInsideCharacter=pointer.insideCharacter;
  petHovering = pointer.insideCharacter;
  if (!drag && petCharacter.dataset.state === 'idle' && (entering || leaving)) {
    clearTimeout(bubbleTimer);
    if (entering) document.querySelector('#pet-bubble').hidden = false;
    else bubbleTimer = setTimeout(() => { document.querySelector('#pet-bubble').hidden = true; void syncPetLayout(); },3000);
  }
  if (!drag && !pointer.insideWindow) {clearTimeout(controlsTimer);root.classList.remove('pet-active');}
  if (!drag && entering) {
    root.classList.add('pet-active');clearTimeout(controlsTimer);
    controlsTimer=setTimeout(()=>{root.classList.remove('pet-active');void syncPetLayout();},3000);
  }
  void syncPetLayout();
});
if (surface === 'pet') document.addEventListener('mousemove',event=>void act('pet-pointer-sync',{x:event.screenX,y:event.screenY}));
if (surface === 'pet') document.querySelector('#pet-surface').addEventListener('focusin',event=>{
  if(drag)return;const root=event.currentTarget;root.classList.add('pet-active');clearTimeout(controlsTimer);
  controlsTimer=setTimeout(()=>{root.classList.remove('pet-active');void syncPetLayout();},3000);void syncPetLayout();
});
document.querySelector('#toast').addEventListener('click',()=>{document.querySelector('#toast').hidden=true;clearTimeout(toastTimer);});
void act('sync');

for(const id of ['pet-image','welcome-image'])document.querySelector('#'+id).addEventListener('error',event=>{
  const image=event.currentTarget,pack=activeCharacter;
  if(!pack)return;
  if(image.currentSrc&&image.currentSrc!==image.getAttribute('src'))return;
  const source=image.getAttribute('src');if(![...Object.values(pack.assets),...pack.animationFrames].includes(source))return;
  const failed=failedImages.get(pack.revision)??new Set();failed.add(source);failedImages.set(pack.revision,failed);
  if(image===document.querySelector('#pet-image')){animationFailed=pack.revision;clearTimeout(animationTimer);animationRun=null;image.dataset.animating='false';}
  if(!failed.has(pack.assets.idle)){image.src=pack.assets.idle;return;}
  image.src='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="36" fill="#48644c"/><circle cx="38" cy="44" r="4" fill="white"/><circle cx="62" cy="44" r="4" fill="white"/><path d="M35 62Q50 74 65 62" fill="none" stroke="white" stroke-width="4"/></svg>');
});

for(const [id,key]of [['appearance-profile','appearanceProfile'],['character-scale','characterScale']])document.querySelector('#'+id).addEventListener('change',event=>void act('settings',{[key]:key==='characterScale'?Number(event.target.value):event.target.value}).then(()=>act('sync')));

for(const [id,operation]of [['persona-clone','clone'],['persona-rename','rename'],['persona-reset','reset'],['persona-archive','archive'],['persona-unarchive','unarchive']])document.querySelector('#'+id).addEventListener('click',async event=>{
  const characterId=document.querySelector('#persona-character').value,mode=document.querySelector('#persona-edit-mode').value,key=characterId+':'+mode,entry=personaCatalog.find(p=>p.characterId===characterId)?.entries.find(e=>e.id===mode),status=document.querySelector('#persona-editor-status');
  if(operation==='clone'&&editorDrafts.has(key)&&editorDrafts.get(key)!==entry?.text){status.hidden=false;status.textContent='현재 편집 내용을 먼저 저장해주세요. 복제는 저장된 MD를 사용해요.';return;}
  const button=event.currentTarget;button.disabled=true;
  try{const result=await act('persona-manage',{characterId,id:mode,operation,name:document.querySelector('#persona-mode-name').value});if(result.ok){if(operation==='reset')editorDrafts.delete(key);editorSignature='';personaSignature='';await act('sync');status.textContent=operation==='reset'?'현재 MD를 백업하고 기본 내용으로 복원했어요.':'말투 목록을 변경했어요. 기존 질문은 유지돼요.';status.hidden=false;}}finally{button.disabled=false;}
});
