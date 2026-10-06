import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import cjkFriendly from 'markdown-it-cjk-friendly';

const surface = new URLSearchParams(location.search).get('surface');
document.querySelector(surface === 'pet' ? '#pet-surface' : '#panel-surface').hidden = false;
let state, catalog = [], lastRequestSignature = '', toastTimer, drag, replyingTimer, lastState = '', activeTab = 'chat', lastListening = false, modelSignature = '', modelSaving = false;
let historySignature = '';
let deletionTarget=null,deleting=false;
let pickerSettingsSignature = '';
let bubbleState, bubbleTimer;
let petLayoutSignature = '';
const drafts = new Map();
const renderAckIds = new Set();
const messageCache=new Map(),messageCards=new Map();
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false }).use(cjkFriendly);
markdown.disable('image');
markdown.validateLink = value => { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } };
const labels = { idle: '말 걸어주세요', listening: '듣고 있어요', thinking: '생각 중이에요…', replying: '답변이 도착했어요', attention: '확인이 필요해요', error: '잠깐 막혔어요', sleeping: '잠시 쉬는 중…' };

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
  activeTab = ['chat','history','settings'].includes(tab) ? tab : 'chat';
  document.querySelector('#chat-tab').hidden = activeTab !== 'chat';
  document.querySelector('#history-tab').hidden = activeTab !== 'history';
  document.querySelector('#settings-tab').hidden = activeTab !== 'settings';
  for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('active', button.dataset.tab === activeTab);
  document.querySelector('#open-settings').setAttribute('aria-pressed',String(activeTab === 'settings'));
  if (activeTab === 'chat' && surface === 'panel') document.querySelector('#prompt').focus({ preventScroll: true });
  acknowledgeRenderedMessages();
}

function acknowledgeRenderedMessages() {
  if (surface !== 'panel' || !state || activeTab !== 'chat' || document.hidden) return;
  for (const message of state.messages) {
    if (message.role !== 'assistant' || !message.timing?.completedAt || message.timing.renderedAt !== undefined || renderAckIds.has(message.id)) continue;
    renderAckIds.add(message.id);
    requestAnimationFrame(()=>requestAnimationFrame(async()=>{
      if (document.hidden || activeTab !== 'chat' || !state.messages.some(m=>m.id===message.id)) {renderAckIds.delete(message.id);return;}
      const result = await act('response-rendered',{id:message.id,renderedAt:performance.timeOrigin + performance.now()});
      if (!result.ok) renderAckIds.delete(message.id);
    }));
  }
}

function renderHistory() {
  if (!state || surface !== 'panel') return;
  const query = document.querySelector('#history-search').value.trim().toLocaleLowerCase();
  const locked = state.busy || state.queue.length > 0 || state.preparing > 0 || state.historyLoading;
  const signature = JSON.stringify([state.conversations,state.activeConversationId,locked,query,state.pendingDeletionId]);
  if (signature === historySignature) return;
  historySignature = signature;
  const list = document.querySelector('#conversation-list'); list.replaceChildren();
  const conversations = state.conversations.filter(c => `${c.title} ${c.preview}`.toLocaleLowerCase().includes(query));
  for (const conversation of conversations) {
    const button = document.createElement('button'); button.className = 'conversation-card'; button.dataset.conversation = conversation.id; button.disabled = locked||conversation.id===state.pendingDeletionId;
    button.classList.toggle('selected', conversation.id === state.activeConversationId);
    const top = document.createElement('div'); top.className = 'conversation-top';
    const title = document.createElement('strong'); title.textContent = conversation.title;
    const badge = document.createElement('span'); badge.textContent = conversation.id===state.pendingDeletionId ? '삭제 확인 필요' : conversation.id === state.activeConversationId ? '현재' : conversation.mode === 'demo' ? '체험' : 'Codex';
    const preview = document.createElement('p');
    const previewContent = DOMPurify.sanitize(markdown.render(conversation.preview || ''),{RETURN_DOM_FRAGMENT:true});
    preview.textContent = previewContent.textContent.replace(/\*\*|`/g,'').replace(/\s+/g,' ').trim() || '이야기를 이어가볼까요?';
    const meta = document.createElement('small'); meta.textContent = `${new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(conversation.updatedAt))} · 메시지 ${conversation.messageCount ?? 0}개`;
    top.append(title,badge); button.append(top,preview,meta);
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
    row.append(button,remove);list.append(row);
  }
  document.querySelector('#history-empty').hidden = conversations.length > 0;
  document.querySelector('#history-empty h3').textContent = query ? '찾는 이야기가 없어요' : '아직 지난 이야기가 없어요';
  document.querySelector('#history-empty p').textContent = query ? '다른 단어로 찾아보세요.' : '질문을 보내면 이곳에 차곡차곡 남아요.';
  document.querySelector('#history-busy').hidden = !locked;
  document.querySelector('#history-new').disabled = locked;
}

function renderCharacter(characterState) {
  const pack = catalog.find(p => p.id === state?.settings.characterId) ?? catalog[0];
  if (!pack) return;
  const image = document.querySelector('#pet-image'), character = document.querySelector('#pet-character');
  const source = pack.assets[characterState] ?? pack.assets.idle;
  if (image.getAttribute('src') !== source) image.src = source;
  image.alt = pack.name; character.dataset.state = characterState;
  const characterClass = `pet-character motion-${pack.motion}`;
  if (character.className !== characterClass) character.className = characterClass;
  character.style.width = `${pack.size.width / 2}px`; character.style.height = `${pack.size.height / 2}px`; character.style.marginLeft = `${-pack.size.width / 4}px`;
  const bubble = document.querySelector('#pet-bubble');
  bubble.firstChild.textContent = labels[characterState] + ' ';
  bubble.style.setProperty('--tail', `${20 + pack.bubbleAnchor.x * 60}%`);
  if (surface === 'pet' && characterState !== bubbleState) {
    bubbleState = characterState; clearTimeout(bubbleTimer);
    bubble.hidden = characterState === 'sleeping';
    if (!['thinking','attention','sleeping'].includes(characterState)) bubbleTimer = setTimeout(() => {
      bubble.hidden = true;
      void syncPetLayout();
    }, characterState === 'idle' || characterState === 'listening' ? 3000 : 5000);
  }
  if (surface === 'pet' && drag) bubble.hidden = true;
  const welcome = document.querySelector('#welcome-image');
  if (welcome.getAttribute('src') !== pack.assets.idle) welcome.src = pack.assets.idle;
  if (surface === 'pet') void syncPetLayout();
}

async function syncPetLayout() {
  if (surface !== 'pet' || !state || !catalog.length) return;
  const bubble = document.querySelector('#pet-bubble'), root = document.querySelector('#pet-surface');
  const payload = {bubbleVisible:!bubble.hidden,controlsVisible:root.classList.contains('pet-active') || root.matches(':focus-within')};
  const signature = JSON.stringify([state.settings.characterId,payload]);
  if (signature === petLayoutSignature) return;
  petLayoutSignature = signature;
  const result = await act('pet-layout',payload);
  if (signature !== petLayoutSignature) return;
  if (!result.ok) { petLayoutSignature = ''; return; }
  root.style.setProperty('--pet-center',`${result.centerX}px`); root.style.setProperty('--pet-bottom',`${result.bottom}px`);
  const pack = catalog.find(p => p.id === state.settings.characterId) ?? catalog[0];
  const characterBottom = result.bounds.height - result.bottom, characterTop = characterBottom - pack.size.height / 2;
  bubble.style.top = `${Math.min(result.bounds.height - 44,Math.max(8,characterTop < 48 ? characterBottom + 39 : characterTop + pack.bubbleAnchor.y * pack.size.height / 2 - 44))}px`;
}

window.onggi.onPetLayoutChanged(() => {
  if (surface !== 'pet') return;
  drag = null; document.querySelector('#pet-surface').classList.remove('pet-dragging');
  petLayoutSignature = ''; void syncPetLayout();
});

window.onggi.onState(next => {
  const previousMessages=state?.messages??[];
  if (surface==='panel') {
    if (next.messagePatch?.reset) messageCache.clear();
    for (const message of next.messagePatch?.upsert??[]) messageCache.set(message.id,message);
    const ids=next.messagePatch?.ids??previousMessages.map(m=>m.id),keep=new Set(ids);
    for (const id of messageCache.keys()) if(!keep.has(id))messageCache.delete(id);
    next.messages=ids.map(id=>messageCache.get(id)).filter(Boolean);
  }
  const prepended=previousMessages.length>0&&next.messages?.length>previousMessages.length&&next.messages.at(-1)?.id===previousMessages.at(-1)?.id&&next.messages.some(m=>m.id===previousMessages[0].id);
  const wasBusy = state?.busy;
  const changedConversation = state && state.activeConversationId !== next.activeConversationId;
  if (changedConversation || next.messagePatch?.reset) renderAckIds.clear();
  if (changedConversation && surface === 'panel') { if(state.activeConversationId===null||next.conversations.some(c=>c.id===state.activeConversationId))drafts.set(state.activeConversationId ?? 'new',document.querySelector('#prompt').value);else drafts.delete(state.activeConversationId);document.querySelector('#prompt').value = drafts.get(next.activeConversationId ?? 'new') ?? ''; }
  state = next;
  document.body.classList.toggle('reduced-motion', state.settings.reducedMotion);
  let characterState = state.characterState;
  if (surface === 'panel' && document.activeElement === document.querySelector('#prompt') && document.querySelector('#prompt').value && !state.busy && !state.sleeping) characterState = 'listening';
  if (wasBusy && !state.busy && state.lastMessageStatus === 'completed') {
    characterState = 'replying'; clearTimeout(replyingTimer); replyingTimer = setTimeout(() => renderCharacter(state.characterState), 3500);
  }
  renderCharacter(characterState);
  if (state.packs) {
    catalog = state.packs;
    renderCharacter(characterState);
    if (surface === 'panel') {
    const cards = document.querySelector('#character-cards'); cards.replaceChildren();
    for (const pack of catalog) {
      const card = document.createElement('button'); card.className = 'character-card'; card.dataset.character = pack.id;
      const image = document.createElement('img'); image.src = pack.assets.idle; image.alt = pack.name;
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
  const connectionLabels = { disconnected: 'Codex · 연결 대기', connecting: 'Codex · 연결 중', connected: 'Codex · 연결됨', demo: '체험 모드' };
  document.querySelector('#connection-label').lastChild.textContent = connectionLabels[state.connection] ?? '연결 대기';
  document.querySelector('.connection-bar').dataset.connection = state.connection;
  document.querySelector('#connection-label').title = state.connection === 'demo' ? '체험 응답 · 실제 Codex 호출 없음' : '로컬 Codex · 읽기 전용으로 시작';
  document.querySelector('#stop').hidden = !state.busy;
  document.querySelector('#new-chat').disabled = state.busy || state.queue.length > 0 || state.historyLoading || state.preparing > 0;
  document.querySelector('#prompt').disabled = state.historyLoading;
  document.querySelector('#send').disabled = state.historyLoading || state.preparing > 0;
  document.querySelector('#history-warning').textContent = state.historyWarning ?? '';
  document.querySelector('#history-warning').hidden = !state.historyWarning;
  renderHistory();
  document.querySelector('#demo-mode').checked = state.connection === 'demo';
  document.querySelector('#measure-response-time').checked = Boolean(state.settings.measureResponseTime);
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
  modelInfo.classList.toggle('model-error', Boolean(state.modelsError));
  document.querySelector('#reduced-motion').checked = state.settings.reducedMotion;
  document.querySelector('#always-on-top').checked = state.settings.alwaysOnTop;
  for (const [id, value] of [['workspace-path',state.settings.workspace],['codex-path',state.settings.codexPath]]) { document.querySelector('#' + id).textContent = value; document.querySelector('#' + id).title = value; }
  document.querySelector('#pack-errors').hidden = state.packErrors.length === 0;
  document.querySelector('#pack-errors').textContent = state.packErrors.join('\n');
  const messages = document.querySelector('#messages');
  const previousHeight=messages.scrollHeight,previousTop=messages.scrollTop;
  const atBottom = previousHeight - previousTop - messages.clientHeight < 90;
  const older=document.querySelector('#load-older');older.hidden=state.messages.length>=state.messageTotal;older.disabled=false;older.textContent=`이전 내용 더 보기 · ${Math.max(0,state.messageTotal-state.messages.length)}개 남음`;
  document.querySelector('#welcome').hidden = state.messages.length > 0;
  const ids = new Set(state.messages.map(m => m.id));
  for (const [id,element] of messageCards) if (!ids.has(id)) {element.remove();messageCards.delete(id);}
  let previousCard=null;
  for (const message of state.messages) {
    let card = messageCards.get(message.id);
    if (!card) {
      card = document.createElement('article'); card.dataset.id = message.id; card.className = `message ${message.role}`;
      const label = document.createElement('div'); label.className = 'message-label';
      const body = document.createElement('div'); body.className = 'message-body';
      const error = document.createElement('div'); error.className = 'message-error';
      const tools = document.createElement('div'); tools.className = 'message-tools';
      const status = document.createElement('span'); const copy = document.createElement('button'); copy.textContent = '복사';
      copy.addEventListener('click', () => { const value = state.messages.find(m => m.id === message.id); if (value) void act('copy', { text: value.text }); });
      tools.append(status,copy); card.append(label,body,error,tools); messageCards.set(message.id,card);
      if(previousCard)previousCard.after(card);else messages.insertBefore(card,messages.querySelector('.message'));
    }
    if(previousCard && card.previousElementSibling!==previousCard)previousCard.after(card);
    previousCard=card;
    const metadata=JSON.stringify({...message,text:undefined});
    if (card.renderedText===message.text&&card.renderedMetadata===metadata&&card.renderedMeasure===state.settings.measureResponseTime) continue;
    card.renderedText=message.text;card.renderedMetadata=metadata;card.renderedMeasure=state.settings.measureResponseTime;
    card.dataset.status = message.status;
    const messageLabel = message.role === 'user' ? '나' : `옹기봇${message.mode === 'demo' ? ' · 체험' : message.model ? ` · ${message.modelName || message.model} / ${message.effort}${message.serviceTier && message.serviceTier !== 'default' ? ` · ${message.serviceTierName || message.serviceTier}` : ''}` : ''}`;
    if (card.querySelector('.message-label').textContent !== messageLabel) card.querySelector('.message-label').textContent = messageLabel;
    const body = card.querySelector('.message-body');
    if (body.renderedSource !== message.text) {
      body.renderedSource = message.text;
      body.classList.toggle('markdown-body', message.role === 'assistant');
      if (message.role === 'assistant') {
        const fragment = DOMPurify.sanitize(markdown.render(message.text), {
          ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','h5','h6','strong','em','s','blockquote','ul','ol','li','pre','code','hr','table','thead','tbody','tr','th','td','a'],
          ALLOWED_ATTR: ['href','title','start','align','class'], ALLOW_DATA_ATTR: false, RETURN_DOM_FRAGMENT: true
        });
        for (const table of [...fragment.querySelectorAll('table')]) { const wrapper = document.createElement('div'); wrapper.className = 'markdown-table'; table.replaceWith(wrapper); wrapper.append(table); }
        for (const pre of fragment.querySelectorAll('pre')) {
          const code = pre.querySelector('code'); if (!code) continue;
          const value = code.textContent, copyCode = document.createElement('button'); copyCode.type = 'button'; copyCode.className = 'copy-code'; copyCode.textContent = '코드 복사'; copyCode.addEventListener('click', () => act('copy', { text: value })); pre.append(copyCode);
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
    card.querySelector('.message-error').textContent = message.error ?? ''; card.querySelector('.message-error').hidden = !message.error;
    card.querySelector('.message-tools span').textContent = { queued: '대기 중', running: '답변 중', completed: '', interrupted: '중단됨 · 자동 재실행하지 않아요', failed: '연결 또는 작업 실패' }[message.status] ?? '';
    card.querySelector('.message-tools button').hidden = !message.text;
  }
  if (!state.messages.length) messages.scrollTop = 0;
  else if (prepended && !changedConversation) messages.scrollTop=previousTop+messages.scrollHeight-previousHeight;
  else if (atBottom || changedConversation || next.messagePatch?.reset) messages.scrollTop = messages.scrollHeight;
  const queueBar = document.querySelector('#queue-bar'); queueBar.hidden = state.queue.length === 0; queueBar.replaceChildren();
  if (state.queue.length) {
    const text = document.createElement('span'); text.textContent = `차례대로 기다리는 질문 ${state.queue.length}개 `; queueBar.append(text);
    for (let i = 0; i < state.queue.length; i++) { const cancel = document.createElement('button'); cancel.textContent = `${i + 1}번 취소`; cancel.addEventListener('click', () => act('cancel', { id: state.queue[i].id })); queueBar.append(cancel); }
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
          const label = document.createElement('label'); label.textContent = question.question; card.append(label);
          const input = document.createElement('input'); input.maxLength = 8000; input.placeholder = '답변 입력';
          if (question.options?.length) { const options = document.createElement('select'); const empty = document.createElement('option'); empty.textContent = '직접 입력하거나 선택'; empty.value = ''; options.append(empty); for (const option of question.options) { const element = document.createElement('option'); element.value = option.label; element.textContent = option.label; options.append(element); } options.addEventListener('change', () => { input.value = options.value; }); card.append(options); }
          card.append(input); fields.push({ id: question.id, input });
        }
        const answer = document.createElement('button'); answer.textContent = '답변 보내기'; answer.addEventListener('click', () => act('respond', { id: request.id, answers: Object.fromEntries(fields.map(f => [f.id,f.input.value])) })); card.append(answer);
      } else {
        const description = document.createElement('pre'); description.textContent = [request.params.command ?? request.details?.command,request.params.cwd,request.params.reason,request.details?.changes ? JSON.stringify(request.details.changes,null,2) : null,request.params.permissions ? JSON.stringify(request.params.permissions) : null].filter(Boolean).join('\n') || '작업에 추가 권한이 필요해요.'; card.append(description);
        if (request.method === 'item/permissions/requestApproval') {
          const note = document.createElement('p'); note.textContent = '알파에서는 추가 권한 프로필을 부여하지 않아요.'; card.append(note);
          const deny = document.createElement('button'); deny.textContent = '추가 권한 없이 진행'; deny.addEventListener('click', () => act('respond', { id: request.id })); card.append(deny);
        } else {
          for (const [decision, label] of [['accept','이번 작업 허용'],['decline','거절'],['cancel','취소']]) { const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => act('respond', { id: request.id, decision })); card.append(button); }
        }
      }
      requestRoot.append(card);
    }
  }
  if (state.warning && state.warning !== lastState) { lastState = state.warning; document.querySelector('#toast').textContent = state.warning; document.querySelector('#toast').hidden = false; }
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

window.onggi.onTab(showTab);
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => showTab(button.dataset.tab));
document.querySelector('#close-panel').addEventListener('click', () => act('hide-panel'));
document.querySelector('#load-older').addEventListener('click',async event=>{event.currentTarget.disabled=true;const result=await act('load-older');if(!result.ok)document.querySelector('#load-older').disabled=false;});
document.querySelector('#new-chat').addEventListener('click', () => act('new-chat'));
document.querySelector('#history-search').addEventListener('input',renderHistory);
document.querySelector('#history-new').addEventListener('click',async()=>{const result=await act('new-chat');if(result.ok)showTab('chat');});
document.querySelector('#stop').addEventListener('click', () => act('cancel'));
document.querySelector('#refresh-models').addEventListener('click', () => act('refresh-models'));
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
document.querySelector('#import-pack').addEventListener('click', () => act('import-pack'));
document.querySelector('#pick-workspace').addEventListener('click', () => act('pick-workspace'));
document.querySelector('#pick-codex').addEventListener('click', () => act('pick-codex'));
document.querySelector('#open-data').addEventListener('click', () => act('open-data'));
for (const [id,key] of [['demo-mode','demo'],['reduced-motion','reducedMotion'],['always-on-top','alwaysOnTop'],['measure-response-time','measureResponseTime']]) document.querySelector('#' + id).addEventListener('change', event => { void act('settings', { [key]: event.target.checked }).then(result => { if (!result.ok) void act('sync'); }); });
document.querySelector('#composer').addEventListener('submit', async event => {
  event.preventDefault(); const input = document.querySelector('#prompt'), text = input.value;
  if (!text.trim()) return;
  const result = await act('send', { text,submittedAt:performance.timeOrigin + performance.now() }); if (result.ok && input.value === text) input.value = '';
});
document.querySelector('#prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('#composer').requestSubmit(); } });
document.querySelector('#prompt').addEventListener('input', event => {
  if (state && !state.busy && !state.sleeping) renderCharacter(event.target.value ? 'listening' : state.characterState);
  const listening = Boolean(event.target.value); if (listening !== lastListening) { lastListening = listening; void act('activity', { listening }); }
});
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => { document.querySelector('#prompt').value = button.dataset.prompt; document.querySelector('#prompt').focus(); });
for (const id of ['pet-bubble','pet-chat']) document.querySelector('#' + id).addEventListener('click', () => act('show-panel', { tab: 'chat' }));
document.querySelector('#pet-settings').addEventListener('click', () => act('show-panel', { tab: 'settings' }));
document.querySelector('#pet-sleep').addEventListener('click', () => act('sleep'));
const petCharacter = document.querySelector('#pet-character');
petCharacter.addEventListener('pointerenter', () => {
  if (surface === 'pet' && state && !drag && petCharacter.dataset.state === 'idle') {
    document.querySelector('#pet-surface').classList.add('pet-active');
    if (document.querySelector('#pet-bubble').hidden) { bubbleState = null; renderCharacter('idle'); }
    else void syncPetLayout();
  }
});
petCharacter.addEventListener('pointerdown', async event => {
  if (event.button !== 0) return;
  const gesture = {x:event.screenX,y:event.screenY,lastX:event.screenX,lastY:event.screenY,moved:false,ready:false}; drag = gesture;
  document.querySelector('#pet-surface').classList.add('pet-dragging');
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
document.addEventListener('keydown', event => { if (event.key === 'Escape' && surface === 'panel') void act('hide-panel'); });
document.addEventListener('visibilitychange', () => {document.body.classList.toggle('page-hidden', document.hidden);acknowledgeRenderedMessages();});
if (surface === 'pet') window.onggi.onPetPointer(pointer => {
  const root = document.querySelector('#pet-surface');
  if (!drag && !pointer.insideWindow) root.classList.remove('pet-active');
  if (pointer.insideCharacter) root.classList.add('pet-active');
  void syncPetLayout();
});
if (surface === 'pet') document.addEventListener('mousemove',event=>void act('pet-pointer-sync',{x:event.screenX,y:event.screenY}));
if (surface === 'pet') for (const event of ['focusin','focusout']) document.querySelector('#pet-surface').addEventListener(event,()=>void syncPetLayout());
void act('sync');
