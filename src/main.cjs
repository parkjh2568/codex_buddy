const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, clipboard, shell, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { loadPack } = require('./packs.cjs');
const { AssetValidator } = require('./asset-validator.cjs');
const { PackLibrary } = require('./pack-library.cjs');
const { CodexConnection } = require('./codex.cjs');
const { ModelCatalog } = require('./models.cjs');
const {PersonaLibrary}=require('./personas.cjs');
const {loadSkins}=require('./skins.cjs');
const {ConnectionSetup}=require('./connection-setup.cjs');
const {ResponseImages}=require('./response-images.cjs');
const {AttachmentStore}=require('./attachments.cjs');

const smoke = !app.isPackaged && process.argv.includes('--smoke');
const realSmoke = !app.isPackaged && process.argv.includes('--real-smoke');
const attachmentSmoke=!app.isPackaged&&process.argv.includes('--attachments-smoke');
const modelSmoke = !app.isPackaged && (process.argv.includes('--model-smoke')||attachmentSmoke);
const timingSmoke = !app.isPackaged && process.argv.includes('--timing-smoke');
const performanceSmoke = !app.isPackaged && process.argv.includes('--performance-smoke');
const deleteSmoke = !app.isPackaged && process.argv.includes('--delete-smoke');
const historySmoke = !app.isPackaged && process.argv.includes('--history-smoke');
const petPointerSmoke = !app.isPackaged && process.argv.includes('--pet-pointer-smoke');
const buddyFeatureSmoke = !app.isPackaged && process.argv.includes('--buddy-features-smoke');
const floatingSmoke = !app.isPackaged && process.argv.includes('--floating-smoke');
const stabilitySmoke = !app.isPackaged && process.argv.includes('--stability-smoke');
const resourceSmoke = !app.isPackaged && process.argv.includes('--resource-smoke');
const lifecycleSmoke = !app.isPackaged && process.argv.includes('--buddy-lifecycle-smoke');
const connectionImageSmoke=!app.isPackaged&&process.argv.includes('--connection-image-smoke');
if(connectionImageSmoke)app.setPath('userData',path.join(__dirname,'..','artifacts','connection-image-profile'));
if(lifecycleSmoke)app.setPath('userData',path.join(__dirname,'..','artifacts','buddy-lifecycle-profile'));
if (smoke || realSmoke || modelSmoke || historySmoke || petPointerSmoke || timingSmoke || performanceSmoke || deleteSmoke || floatingSmoke || buddyFeatureSmoke || stabilitySmoke || resourceSmoke) app.setPath('userData', path.join(__dirname, '..', 'artifacts', resourceSmoke ? 'resource-smoke-profile' : stabilitySmoke ? 'stability-smoke-profile' : buddyFeatureSmoke ? 'buddy-features-profile' : floatingSmoke ? 'floating-smoke-profile' : deleteSmoke ? 'delete-smoke-profile' : performanceSmoke ? 'performance-smoke-profile' : timingSmoke ? 'timing-smoke-profile' : petPointerSmoke ? 'pet-pointer-smoke-profile' : historySmoke ? 'history-smoke-profile' : modelSmoke ? 'model-smoke-profile' : realSmoke ? 'real-smoke-profile' : 'smoke-profile'));
if(attachmentSmoke)app.setPath('userData',path.join(__dirname,'..','artifacts','attachments-profile'));
if(!app.isPackaged&&process.env.ONGGI_SMOKE_ROOT&&(smoke||realSmoke||modelSmoke||historySmoke||petPointerSmoke||timingSmoke||performanceSmoke||deleteSmoke||floatingSmoke||buddyFeatureSmoke||stabilitySmoke||resourceSmoke||lifecycleSmoke||connectionImageSmoke))app.setPath('userData',path.join(path.resolve(process.env.ONGGI_SMOKE_ROOT),path.basename(app.getPath('userData'))));
app.setName('OnggiBot');
if (!app.requestSingleInstanceLock()) app.quit();

let pet, petNotice, panel, tray, store, packs = [], packErrors = [], queue = [], current = null, requests = [], connectionState = 'disconnected', resumed = false, sleeping = false, listening = false, quitting = false, publishTimer, catalogVersion = 1;
const codex = new CodexConnection({experimentalApi:true});
const assetValidator = new AssetValidator();
const modelCatalog = new ModelCatalog(codex);
const connectionSetup=new ConnectionSetup(codex,{openExternal:url=>shell.openExternal(url)});
let connectionIssue=null,reconnectTimer,reconnectAttempted=false,connectionProbe,responseImages;
let attachmentStore,attachmentPicking=false;
const pendingAttachments=new Map(),reservedAttachments=new Set();
connectionSetup.on('change',()=>{if(connectionSetup.state.phase==='login-required'&&queue.length)queuePaused=true;publish(true);});
connectionSetup.on('authenticated',()=>{void refreshModels(false).catch(()=>{});});
let modelsStatus = 'idle', modelsError = null, modelRefresh = null;
let cliFileIdentity = null;
let historyLoading = false, historyWarning = null, preparing = 0, packImporting = false;
let personaLibrary,personaCatalog=[],skins=[],packLibrary,packPreview=null,packArchiveCatalog=[];
let petPointerTimer, petPointerSignature = '', petIgnoringMouse = true, petDrag = null;
let petLayout = { bubbleVisible: false, controlsVisible: false, characterWidth: 75, characterHeight: 95 };
let petAnchor, petPointerPosition, petWindowBounds, petPositioning = false;
let noticeBelow=false,noticeHit=null,noticeIgnoringMouse=true,noticeHitRevision=0;
let replyingUntil = 0, replyStateTimer;
let historyCatalogRevision = -1, historyCatalog = [];
let admissionTail=Promise.resolve();
let screenLocked = false, systemSuspended = false, queuePaused = false, onBattery = false;
const messageSizeCache = new WeakMap();
const forcedDemo = lifecycleSmoke || resourceSmoke || stabilitySmoke || smoke || performanceSmoke || petPointerSmoke || floatingSmoke || process.argv.includes('--demo');

function syncPetPointer() {
  if (!pet || quitting || screenLocked || systemSuspended || pet.isDestroyed() || !pet.rendererReady) return;
  if (!pet.isVisible() && !petDrag) return;
  const bounds = pet.getBounds(), cursor = petPointerPosition && Date.now() - petPointerPosition.at < 200 ? petPointerPosition : screen.getCursorScreenPoint();
  if(petNotice&&!petNotice.isDestroyed()){
    const n=petNotice.getBounds(),hit=noticeHit,inside=petNotice.isVisible()&&hit&&cursor.x>=n.x+hit.x&&cursor.x<=n.x+hit.x+hit.width&&cursor.y>=n.y+hit.y&&cursor.y<=n.y+hit.y+hit.height;
    if(Boolean(!inside)!==noticeIgnoringMouse){noticeIgnoringMouse=Boolean(!inside);petNotice.setIgnoreMouseEvents(noticeIgnoringMouse,{forward:true});}
  }
  const px = cursor.x - bounds.x, py = cursor.y - bounds.y;
  const centerX = petAnchor.x - bounds.x, characterBottom = petAnchor.y - bounds.y - 35;
  const insideWindow = pet.isVisible() && px >= 0 && py >= 0 && px < bounds.width && py < bounds.height;
  const insideCharacter = insideWindow && px >= centerX - petLayout.characterWidth / 2 - 5 && px <= centerX + petLayout.characterWidth / 2 + 5 && py >= characterBottom - petLayout.characterHeight - 8 && py <= characterBottom + 3;
  const insideControls = insideWindow && px >= centerX - 54 && px <= centerX + 54 && py >= characterBottom + 3 && py <= characterBottom + 35;
  const ignore = !petDrag && !(insideCharacter || (petLayout.controlsVisible && insideControls));
  if (ignore !== petIgnoringMouse) { petIgnoringMouse = ignore; pet.setIgnoreMouseEvents(ignore,{forward:true}); }
  const signature = `${insideWindow}:${insideCharacter}:${insideControls}`;
  if (signature !== petPointerSignature) { petPointerSignature = signature; pet.webContents.send('pet-pointer',{insideWindow,insideCharacter,insideControls}); }
}

async function refreshModels(onlyIfStale = false) {
  if (modelRefresh) return modelRefresh;
  let identity = null;
  try { const file = fs.statSync(store.data.settings.codexPath); identity = `${store.data.settings.codexPath}:${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}`; } catch {}
  const cliChanged = cliFileIdentity !== null && identity !== null && identity !== cliFileIdentity;
  if (onlyIfStale && codex.process && ['ready','unknown'].includes(connectionSetup.state.phase) && !cliChanged && modelsStatus === 'ready' && Date.now() - modelCatalog.refreshedAt < 5 * 60 * 1000) return {models:modelCatalog.models,defaults:modelCatalog.defaults};
  if (!onlyIfStale || !modelCatalog.models.length) modelsStatus = 'loading';
  modelsError = null;connectionIssue=null; publish();
  modelRefresh = (async () => {
    const restartAllowed = !current && !queue.length && !historyLoading;
    if (cliChanged && restartAllowed) { codex.stop(); resumed = false; }
    try{if(!fs.statSync(store.data.settings.workspace).isDirectory())throw Error('폴더가 아닙니다.');fs.accessSync(store.data.settings.workspace,fs.constants.R_OK);}catch{connectionIssue={phase:'workspace-missing',message:'작업 폴더를 찾지 못했어요. 사용할 폴더를 선택해주세요.'};throw Error(connectionIssue.message);}
    const executable=ConnectionSetup.findExecutable(store.data.settings.codexPath),configured=store.data.settings.codexPath;
    if(!executable||path.isAbsolute(configured)&&path.resolve(configured)!==executable){connectionIssue={phase:'missing-cli',message:'Codex를 찾지 못했어요. 자동으로 다시 찾거나 설치 안내를 열어주세요.'};throw Error(connectionIssue.message);}
    connectionState='connecting';publish();await codex.connect(executable,store.data.settings.workspace);connectionState='connected';
    const account=await connectionSetup.check();
    if(account.phase==='login-required'||account.phase==='login-pending')throw Error(account.message);
    if (!cliChanged || restartAllowed) cliFileIdentity = identity;
    const result = await modelCatalog.refresh(store.data.settings.workspace);
    connectionState = 'connected'; modelsStatus = 'ready';reconnectAttempted=false; publish(); return result;
  })();
  try { return await modelRefresh; }
  catch (error) { if (!codex.process) connectionState = 'disconnected'; modelsStatus = modelCatalog.models.length ? 'ready' : 'error'; modelsError = error.message; publish(); throw error; }
  finally { modelRefresh = null; }
}

function publish(immediate = false) {
  if (!store || quitting) return;
  if (publishTimer) { if (!immediate) return; clearTimeout(publishTimer); }
  publishTimer = setTimeout(() => {
    publishTimer = null;
    if (historyCatalogRevision !== store.registryRevision) { historyCatalogRevision = store.registryRevision; historyCatalog = [...store.data.conversations].sort((a,b) => b.updatedAt - a.updatedAt); }
    const characterState = requests.length ? 'attention' : store.writeBlocked ? 'error' : current || preparing ? 'thinking' : listening ? 'listening' : Date.now() < replyingUntil ? 'replying' : sleeping ? 'sleeping' : store.data.messages.at(-1)?.status === 'failed' ? 'error' : 'idle';
    const activityLabel = store.writeBlocked ? '답변 저장 확인 필요' : characterState === 'thinking' ? ({connecting:'Codex 연결 중…',preparing:'대화 준비 중…',waiting:'응답 기다리는 중…',receiving:'답변 받고 있어요…',generating:'그림을 만들고 있어요…',tool:'도구 실행 중…'}[current?.phase] ?? '생각 중이에요…') : null;
    const state = {
      settings: store.data.settings, messageTotal: store.data.messages.length, threadId: store.data.threadId, panelVisible:Boolean(panel?.isVisible()) && !screenLocked && !systemSuspended,queuePaused,screenLocked,motionReduced:screenLocked||systemSuspended||store.data.settings.reducedMotion||store.data.settings.appearanceProfile==='quiet'||Boolean(onBattery&&store.data.settings.batterySaver),
      lastMessageStatus: store.data.messages.at(-1)?.status,
      queue: queue.map(j => ({ id: j.id, text: j.text, attachmentCount:j.attachments?.length??0 })), busy: Boolean(current), requests,
      connection: (forcedDemo || store.data.settings.demo) ? 'demo' : connectionState, demoLocked: forcedDemo,connectionHelp:connectionIssue??{...connectionSetup.state,...(modelsError&&connectionSetup.state.phase==='ready'?{phase:'error',message:'연결 준비를 마치지 못했어요. 다시 연결하거나 모델 설정을 확인해주세요.'}:{})},
      characterState,activityLabel,
      sleeping, warning: store.warning, packErrors, shortcut: store.shortcut,
      packArchives:packArchiveCatalog,models: modelCatalog.models, modelDefaults: modelCatalog.defaults, modelsStatus, modelsError,
      activeConversationId: store.data.activeConversationId, conversations:historyCatalog,conversationRevision:store.registryRevision, historyLoading, historyWarning, preparing, attachmentPicking, pendingDeletionId:store.pendingDeletion?.id??null,compactMode:Boolean(panel?.compactMode),bubbleBelow:Boolean(panel?.bubbleBelow),bubbleTailX:panel?.bubbleTailX??180
    };
    for (const window of [pet, petNotice, panel]) if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.mainFrame.detached && window.rendererReady) {
      let payload;
      if (window===pet) payload={settings:state.settings,busy:state.busy,lastMessageStatus:state.lastMessageStatus,characterState:state.characterState,activityLabel:state.activityLabel,motionReduced:state.motionReduced,screenLocked:state.screenLocked,petVisible:pet.isVisible(),sleeping:state.sleeping};
      else if(window===petNotice)payload={settings:state.settings,characterState:state.characterState,activityLabel:state.activityLabel,bubbleVisible:petLayout.bubbleVisible&&!screenLocked&&!systemSuspended,noticeHitRevision,noticeBelow,noticeAnchorX:(petLayout.noticeAnchorX??petAnchor.x)-petNotice.getBounds().x};
      else {
        const reset=!window.messageView || window.messageView.conversationId!==state.activeConversationId;
        if (reset) {window.messageView={conversationId:state.activeConversationId,entries:new Map()};window.expandedHistory=false;}
        if (!window.expandedHistory) {
          let count=0,bytes=0;
          for(let i=store.data.messages.length-1;i>=0&&count<100;i--){const size=Buffer.byteLength(store.data.messages[i].text);if(count&&bytes+size>256*1024)break;bytes+=size;count++;}
          window.messageLimit=Math.max(1,count);
        }
        const visible=store.data.messages.slice(-(window.messageLimit??100)).map(message=>message.text.length>100000?{...message,text:message.text.slice(0,100000),displayTruncated:true}:message),entries=new Map(),upsert=[];
        for (const message of visible) {
          const metadata=JSON.stringify({...message,text:undefined}),previous=window.messageView.entries.get(message.id);
          if (!previous || previous.text!==message.text || previous.metadata!==metadata) upsert.push(message);
          entries.set(message.id,{text:message.text,metadata});
        }
        window.messageView.entries=entries;
        payload={...state,messagePatch:{reset,ids:visible.map(m=>m.id),upsert}};
        if (window.historyRevision === store.registryRevision && !reset) delete payload.conversations;
        window.historyRevision = store.registryRevision;
      }
      if(window!==petNotice){
        const selected=packs.find(p=>p.manifest.id===state.settings.characterId);
        if(selected&&window.assetRevision!==selected.revision){payload.characterPack={...selected.manifest,assets:selected.assets,animationFrames:selected.animationFrames,revision:selected.revision};window.assetRevision=selected.revision;}
      }
      window.webContents.send('state', window.catalogVersion === catalogVersion ? payload : window===petNotice?{...payload,skins}:{...payload,packs:packs.map(p=>({...p.manifest,thumbnail:p.thumbnail,builtin:Boolean(p.builtin),temporary:Boolean(p.temporary),revision:p.revision})),...(window===panel?{personas:personaCatalog}:{}),skins});
      window.catalogVersion = catalogVersion;
    }
  }, immediate ? 0 : 50);
}

function showPanel(tab = 'chat', full = false, positionOnly = false) {
  if (!pet || !panel || quitting || screenLocked || systemSuspended || pet.isDestroyed() || panel.isDestroyed()) return;
  const bounds = pet.getBounds(), area = screen.getDisplayNearestPoint({x:Math.round(petAnchor.x),y:Math.round(petAnchor.y-80)}).workArea;
  panel.compactMode=tab==='chat'&&!full&&!requests.length&&store.data.settings.chatMode==='bubble';
  const width=Math.min(panel.compactMode?360:460,area.width-24),height=Math.min(panel.compactMode?410:740,area.height-24);
  const previousSize=panel.getBounds();if(previousSize.width!==width||previousSize.height!==height)panel.setSize(width,height);
  const size = panel.getBounds();
  let x = bounds.x - size.width + 25 >= area.x ? bounds.x - size.width + 25 : bounds.x + bounds.width - 25,y=bounds.y+bounds.height-size.height;
  if(panel.compactMode){x=petAnchor.x-width/2;y=petAnchor.y-35-petLayout.characterHeight-height-8;panel.bubbleBelow=y<area.y;if(panel.bubbleBelow)y=petAnchor.y+8;}
  x=Math.round(Math.max(area.x,Math.min(x,area.x+area.width-width)));y=Math.round(Math.max(area.y,Math.min(y,area.y+area.height-height)));
  panel.bubbleTailX=Math.max(30,Math.min(width-30,petAnchor.x-x));panel.setPosition(x,y);
  if(positionOnly){panel.webContents.send('bubble-placement',{below:panel.bubbleBelow,tailX:panel.bubbleTailX});return;}
  panel.show(); panel.focus(); panel.pendingTab=tab; if (panel.rendererReady) panel.webContents.send('show-tab',tab); publish();
  if (!historyLoading && !(forcedDemo || store.data.settings.demo)) void refreshModels(true).catch(() => {});
}

async function finishJob(status, error) {
  if (!current) return;
  const job = current;
  if(job.finishing)return job.finishing;
  const assistant = job.reply??store.data.messages.find(m => m.id === job.replyId);
  if (!assistant || assistant.status !== 'running') return;
  const user = store.data.messages.find(m => m.id === current.id);
  if (assistant) { assistant.status = status; if (error) assistant.error = String(error).slice(0,4000); }
  if (assistant.timing) {
    const timing = assistant.timing; timing.completedAt = performance.timeOrigin + performance.now(); timing.status = status;
    timing.inputMs = timing.submittedAt === null ? null : Math.max(0,timing.receivedAt - timing.submittedAt);
    timing.dispatchMs = timing.cliSentAt === undefined ? null : Math.max(0,timing.cliSentAt - timing.receivedAt);
    timing.cliMs = timing.cliSentAt === undefined ? null : Math.max(0,timing.completedAt - timing.cliSentAt);
    timing.firstReplyMs = timing.firstReplyAt === undefined ? null : Math.max(0,timing.firstReplyAt - timing.cliSentAt);
    timing.queueMs = Math.max(0,timing.queueStartedAt - timing.enqueuedAt);
  }
  if (user) user.status = status;
  clearTimeout(current.timeout);
  requests = [];
  clearTimeout(replyStateTimer); replyingUntil = status === 'completed' ? Date.now() + 3500 : 0;
  if (replyingUntil) replyStateTimer = setTimeout(() => { replyingUntil = 0; publish(true); },3500);
  job.finishing=(async()=>{
    try{await job.imageWork;if(assistant.images)assistant.images=assistant.images.map(i=>i.status==='pending'?{itemId:i.itemId,status:'failed',error:status==='interrupted'?'이미지 생성이 중단됐어요. 대화를 다시 열어 결과를 확인할 수 있어요.':'이미지 결과를 받지 못했어요. 결과 다시 확인을 눌러주세요.'}:i);await store.saveAsync();}catch(error){store.writeBlocked=true;assistant.error=[assistant.error,'답변은 수신했지만 저장하지 못했습니다. '+error.message].filter(Boolean).join('\n');}
    job.resolve?.();publish(true);
  })();
  return job.finishing;
}

async function runQueue() {
  if (current || queue.length === 0 || quitting || systemSuspended || queuePaused) return;
  if (store.writeBlocked) {
    for (const job of queue.splice(0)) for (const id of [job.id,job.replyId]) { const message=store.data.messages.find(m=>m.id===id);if(message){message.status='interrupted';if(message.role==='assistant'){message.error='저장 실패로 실행하지 않았습니다.';if(message.timing){const t=message.timing;t.completedAt=performance.timeOrigin+performance.now();t.status='interrupted';t.inputMs=t.submittedAt===null?null:Math.max(0,t.receivedAt-t.submittedAt);t.queueMs=Math.max(0,t.completedAt-t.enqueuedAt);}}} }
    publish(true);return;
  }
  current = queue.shift();
  const job = current;
  const reply = store.data.messages.find(m => m.id === job.replyId);
  job.reply=reply;
  const user = store.data.messages.find(m => m.id === job.id);
  if (reply.timing) reply.timing.queueStartedAt = performance.timeOrigin + performance.now();
  reply.status = 'running'; user.status = 'running'; sleeping = false; job.phase='connecting'; publish();
  try {
    if (job.mode === 'demo') {
      connectionState = 'demo'; job.phase='receiving';
      const answer = job.persona?.id==='concise'?`체험 응답입니다. ${job.buddyName}: “${job.text}”\n실제 Codex 응답은 연결 모드에서 받을 수 있습니다.`:job.persona?.id==='blunt'?`체험 응답이야. 실제 Codex에 보낸 건 아니야.\n“${job.text}”라고 물었지. 연결 모드에서 다시 물어봐.`:`체험 모드예요. 실제 Codex에는 보내지 않았어요.\n\n“${job.text}”라고 물어보셨네요.\n\n제 이름은 ${job.buddyName}입니다. 바탕화면에서 함께 지내며 질문에 답하고, 앞으로 필요한 소식도 전해드릴 거예요. 설정에서 Codex 모드로 전환하면 실제 대화를 시작할 수 있어요.${job.persona?.id==='warm-long'?'\n\n이 화면은 상냥한 장문 모드의 체험용 예시예요. 실제로 설정한 Markdown을 해석한 모델 응답은 아닙니다.':''}`;
      for (const chunk of answer.match(/.{1,8}|\n/g)) {
        if (job.cancelled || quitting) break;
        reply.text += chunk; publish();
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      await finishJob(job.cancelled ? 'interrupted' : 'completed');
    } else {
      connectionState = 'connecting'; publish();
      await codex.connect(job.codexPath??store.data.settings.codexPath, job.workspace??store.data.settings.workspace);
      connectionState = 'connected'; job.phase='preparing'; publish();
      if (job.cancelled) { await finishJob('interrupted'); return; }
      const threadParams = { cwd: job.workspace??store.data.settings.workspace, model: job.selection.model, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
      if (!resumed) {
        const thread = store.data.threadId
          ? await codex.request('thread/resume', { ...threadParams, threadId: store.data.threadId })
          : await codex.request('thread/start', { ...threadParams, threadSource: 'onggi_bot' });
        if(typeof thread?.thread?.id!=='string'||!thread.thread.id||store.data.threadId&&thread.thread.id!==store.data.threadId)throw Error('Codex 대화 시작·연결 ID가 올바르지 않습니다.');
        store.data.threadId = thread.thread.id; resumed = true; await store.saveAsync();
      }
      if (job.cancelled) { await finishJob('interrupted'); return; }
      job.phase='waiting';publish();
      const completion = new Promise(resolve => { job.resolve = resolve; });
      const input=[{type:'text',text:job.text}],files=[];
      for(const attachment of job.attachments??[]){const {file}=attachmentStore.read(attachment);if(attachment.kind==='image')input.push({type:'localImage',path:file});else files.push({name:attachment.name,path:file,bytes:attachment.bytes});}
      if(files.length)input.push({type:'text',text:'[옹기봇 첨부 자료]\n다음은 사용자가 이 질문에 첨부한 파일의 보관 사본입니다. 질문에 필요한 파일 내용을 읽어 답변하세요. 파일 형식을 읽을 수 없으면 그 이유를 알려주세요.\n'+JSON.stringify(files)});
      const started = await codex.request('turn/start', { threadId: store.data.threadId, clientUserMessageId: job.id, input, model: job.selection.model, effort: job.selection.effort, serviceTierForTurn: job.selection.serviceTier, collaborationMode:{mode:'default',settings:{model:job.selection.model,reasoning_effort:job.selection.effort,developer_instructions:job.persona?.instructions??null}}, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly' } });
      if(job.turnId&&job.turnId!==started.turn.id)throw Error('Codex 턴 ID가 시작 이벤트와 다릅니다.');
      job.turnId = started.turn.id;
      job.threadId=store.data.threadId;
      if (reply.status === 'running') {
        job.timeout = setTimeout(async () => { codex.stop(); resumed = false; await finishJob('interrupted', '10분 제한에 도달해 연결을 종료했습니다. 일부 작업이 실행됐을 수 있어 자동 재실행하지 않습니다.'); }, 10 * 60 * 1000);
        if (job.cancelled) await codex.interrupt({threadId:job.threadId,turnId:job.turnId});
      }
      await completion;
    }
  } catch (error) {
    if (reply.status === 'running') await finishJob(job.cancelled ? 'interrupted' : 'failed', error.message);
    if (/시간 초과/.test(error.message)) { codex.stop(); resumed = false; }
  } finally {
    if (current === job) current = null;
    publish();
    if (!quitting) void runQueue();
  }
}

codex.on('notification', message => {
  if (!store) return;
  const { method, params = {} } = message;
  if (params.threadId && params.threadId !== store.data.threadId) return;
  if (method === 'serverRequest/resolved') { requests = requests.filter(r => r.id !== params.requestId); publish(); return; }
  if (!current||current.finishing) return;
  const incomingTurn = params.turnId ?? params.turn?.id;
  if(!current.turnId&&incomingTurn&&codex.turnContext?.turnId===incomingTurn&&codex.turnContext.threadId===store.data.threadId)current.turnId=incomingTurn;
  if (current.turnId && incomingTurn && current.turnId !== incomingTurn) return;
  if (method === 'turn/started') { current.turnId = params.turn.id; for (const id of [current.id,current.replyId]) { const message = store.data.messages.find(m => m.id === id); if (message) message.turnId = current.turnId; } }
  const reply = current.reply??(current.reply=store.data.messages.find(m => m.id === current.replyId));
  if(method==='item/started'&&params.item.type==='imageGeneration'){
    current.phase='generating';reply.images??=[];if(reply.images.length<8&&!reply.images.some(i=>i.itemId===params.item.id))reply.images.push({itemId:params.item.id,status:'pending'});publish();
  }
  if(method==='item/completed'&&(params.item.type==='imageGeneration'||params.item.type==='mcpToolCall'&&Array.isArray(params.item.result?.content)&&params.item.result.content.some(c=>c?.type==='image'))){
    const job=current,item=params.item,workspace=job.workspace??store.data.settings.workspace,threadId=store.data.threadId;
    if(reply.timing&&reply.timing.firstReplyAt===undefined&&item.status==='completed')reply.timing.firstReplyAt=performance.timeOrigin+performance.now();
    reply.images??=[];
    if(reply.images.length<8||reply.images.some(i=>i.itemId===item.id)){
      if(!reply.images.some(i=>i.itemId===item.id))reply.images.push({itemId:item.id,status:'pending'});
      job.imageWork=(job.imageWork??Promise.resolve()).then(async()=>{
        const images=await responseImages.capture(item,{workspace,threadId});reply.images=[...reply.images.filter(i=>i.itemId!==item.id&&!i.itemId.startsWith(item.id+':')),...images].slice(0,8);publish(true);
      }).catch(()=>{reply.images=reply.images.map(i=>i.itemId===item.id?{itemId:item.id,status:'failed',error:'이미지 결과를 표시하지 못했어요. 대화를 다시 열어 확인해주세요.'}:i);publish(true);});
    }else reply.error='이미지는 답변당 최대 8개까지 표시해요.';
  }
  if (method === 'item/started' && ['fileChange','commandExecution'].includes(params.item?.type)) {
    current.phase='tool';
    current.toolItems ??= new Map();
    if (current.toolItems.size < 128 || current.toolItems.has(params.item.id)) {
      const item = Buffer.byteLength(JSON.stringify(params.item)) > 128 * 1024 ? {id:params.item.id,type:params.item.type,truncated:true} : params.item;
      current.toolItems.set(params.item.id,item);
    } else current.toolOverflow = true;
  }
  if (method === 'item/agentMessage/delta' || (method === 'item/completed' && params.item?.type === 'agentMessage')) {
    current.phase='receiving';
    const itemId = method === 'item/completed' ? params.item.id : params.itemId, incoming = method === 'item/completed' ? params.item.text : params.delta;
    if (reply.timing && incoming && reply.timing.firstReplyAt === undefined) reply.timing.firstReplyAt = performance.timeOrigin + performance.now();
    current.items ??= new Map(); current.itemCharacters ??= 0;
    const previous = current.items.get(itemId) ?? '';
    if (current.items.has(itemId) || current.items.size < 128) {
      const separators = Math.max(0,current.items.size - (current.items.has(itemId) ? 1 : 0)) * 2;
      const room = Math.max(0,100000 - current.itemCharacters + previous.length - separators);
      const text = method === 'item/completed' ? incoming : previous + incoming;
      const retained = text.slice(0,room);
      current.itemCharacters += retained.length - previous.length;
      current.items.set(itemId,retained);
      if (retained.length < text.length) reply.textTruncated = true;
    } else reply.textTruncated = true;
    reply.text = current.items.size===1?current.items.values().next().value:[...current.items.values()].join('\n\n').slice(0,100000); publish();
  }
  if (method === 'item/completed' && params.item?.type !== 'agentMessage') current.toolItems?.delete(params.item.id);
  if (method === 'turn/completed') finishJob(params.turn.status === 'completed' ? 'completed' : params.turn.status === 'interrupted' ? 'interrupted' : 'failed', params.turn.error?.message);
  if (method === 'error' && !params.willRetry) { reply.error = String(params.error?.message ?? 'Codex에서 오류가 발생했습니다.').slice(0,4000); publish(); }
});
codex.on('turn-sent', event => { if (current && event.threadId === store.data.threadId) { const reply = store.data.messages.find(m => m.id === current.replyId); if (reply?.timing) reply.timing.cliSentAt = event.at; } });
codex.on('request', request => {
  const ownedTurn=current?.turnId??codex.turnContext?.turnId;
  if (!current || current.finishing || (request.params?.threadId && request.params.threadId !== store.data.threadId) || (ownedTurn && request.params?.turnId && request.params.turnId !== ownedTurn)) { codex.write({ id: request.id, error: { code: -32601, message: 'No active OnggiBot conversation' } }); return; }
  const supported = ['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput'];
  if (!supported.includes(request.method)) {
    if (request.method === 'mcpServer/elicitation/request') codex.respond(request.id, { action: 'decline', content: null });
    else codex.write({ id: request.id, error: { code: -32601, message: 'This request is not supported by OnggiBot alpha' } });
    return;
  }
  if (requests.length >= 16 || Buffer.byteLength(JSON.stringify(request.params)) > 256 * 1024) { codex.write({id:request.id,error:{code:-32000,message:'Approval or input request exceeds OnggiBot alpha limits'}});return; }
  requests.push({ id: request.id,jobId:current.id, method: request.method, params: request.params, details: current.toolItems?.get(request.params.itemId) ?? (current.toolOverflow ? {truncated:true} : undefined) });
  publish(); if(store.data.settings.appearanceProfile!=='quiet')showPanel('chat',true);
});
codex.on('disconnected', error => {
  connectionState='disconnected';resumed=false;queuePaused=Boolean(queue.length)||queuePaused;clearTimeout(reconnectTimer);
  const workspace=store?.data.settings.workspace,executable=store?.data.settings.codexPath;
  void Promise.resolve(finishJob('interrupted',error)).then(()=>{
    if(!store||quitting||forcedDemo||store.data.settings.demo||reconnectAttempted)return;
    reconnectAttempted=true;
    reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(quitting||screenLocked||systemSuspended||current||preparing||historyLoading||modelRefresh||packImporting||connectionSetup.attempt||codex.process||store.data.settings.workspace!==workspace||store.data.settings.codexPath!==executable)return;void refreshModels(false).catch(()=>{});},1500);
  }).catch(()=>{});publish();
});
codex.on('protocol-error', error => { store.warning = error; publish(); });

app.whenReady().then(async () => {
  let executable=ConnectionSetup.findExecutable(null)??'codex';
  if (modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke || buddyFeatureSmoke || connectionImageSmoke) executable = path.join(__dirname, '..', 'test', 'fixtures', connectionImageSmoke?'connection-image-codex.cjs':buddyFeatureSmoke?'persona-codex.cjs':deleteSmoke?'delete-codex.cjs':'model-codex.cjs');
  const workspace = path.join(app.getPath('userData'), 'workspace'); fs.mkdirSync(workspace, { recursive: true });
  store = new Store(app.getPath('userData'), { buddyName:'옹기봇', characterId: 'onggi-clip', codexPath: executable, workspace, demo: false, reducedMotion: false, alwaysOnTop: true, position: null, model: 'gpt-5.6-luna', effort: 'high', serviceTier: 'default', measureResponseTime:false,skinId:'paper',chatMode:'panel',personaModes:{},appearanceProfile:'custom',batterySaver:false,characterScale:.5 });
  responseImages=new ResponseImages(path.join(store.directory,'response-images'),assetValidator);
  attachmentStore=new AttachmentStore(path.join(store.directory,'attachments'),responseImages);
  if(responseImages.error)store.warning=responseImages.error;
  const savedName=typeof store.data.settings.buddyName==='string'?store.data.settings.buddyName.trim().normalize('NFC'):'';
  store.data.settings.buddyName=savedName&&Array.from(savedName).length<=20&&!/[\u0000-\u001f\u007f-\u009f]/u.test(savedName)?savedName:'옹기봇';
  if (smoke || realSmoke || modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke || buddyFeatureSmoke || stabilitySmoke || resourceSmoke) { store.data.settings.workspace = workspace; store.data.messages = []; store.data.threadId = null; store.data.settings.characterId = 'onggi-clip'; store.data.settings.model = realSmoke ? 'gpt-5.6-luna' : null; store.data.settings.effort = realSmoke ? 'high' : null; }
  if (smoke || realSmoke || modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke || buddyFeatureSmoke || stabilitySmoke || resourceSmoke) { store.data.activeConversationId = null; store.data.conversations = []; store.snapshot = null; }
  if (smoke || realSmoke || modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke || buddyFeatureSmoke || stabilitySmoke || resourceSmoke) {store.data.settings.serviceTier = 'default';store.data.settings.measureResponseTime = realSmoke;}
  if (modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke || buddyFeatureSmoke || stabilitySmoke || resourceSmoke) { store.data.settings.codexPath = executable; store.data.settings.demo = false; }
  packLibrary=new PackLibrary(store.directory);try{packLibrary.recover(store);}catch(error){store.writeBlocked=true;store.warning='캐릭터 복구가 필요합니다. '+error.message;}
  packArchiveCatalog=packLibrary.archives();
  const userPacks = path.join(store.directory, 'characters'); fs.mkdirSync(userPacks, { recursive: true });
  for (const root of lifecycleSmoke&&process.argv.includes('--no-pack-fixture')?[]:[path.join(__dirname, '..', 'characters'), userPacks]) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { const loaded = loadPack(path.join(root, entry.name)); await assetValidator.validate(loaded); loaded.builtin = root !== userPacks; if (packs.some(p => p.manifest.id === loaded.manifest.id)) throw new Error('같은 ID의 캐릭터가 있습니다.'); packs.push(loaded); }
      catch (error) { packErrors.push(`${entry.name}: ${error.message}`); }
    }
  }
  if(!packs.length){
    const source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="190"><circle cx="75" cy="100" r="42" fill="#48644c"/><path d="M54 110Q75 135 96 110" fill="none" stroke="white" stroke-width="5"/><circle cx="60" cy="89" r="5" fill="white"/><circle cx="90" cy="89" r="5" fill="white"/></svg>').toString('base64');
    packs.push({manifest:{schemaVersion:1,id:store.data.settings.characterId??'onggi-clip',name:'캐릭터 복구 표시',description:'정상 팩을 가져오거나 앱 설치 파일을 복구해주세요.',size:{width:150,height:190},bubbleAnchor:{x:.5,y:.1},motion:'sway',states:{}},assets:Object.fromEntries(['idle','listening','thinking','replying','attention','error','sleeping'].map(state=>[state,source])),animationFrames:[],revision:'recovery-placeholder',thumbnail:source,builtin:true,temporary:true});
    store.warning='캐릭터 팩을 읽지 못했습니다. 원본과 기록은 유지합니다. 설정에서 정상 팩을 가져오거나 앱 설치 파일을 복구해주세요.';
  }
  if (!packs.some(p => p.manifest.id === store.data.settings.characterId)) store.data.settings.characterId = packs[0]?.manifest.id;
  skins=loadSkins(path.join(__dirname,'..','skins'));if(!skins.some(s=>s.id===store.data.settings.skinId))store.data.settings.skinId='paper';
  if(!['panel','bubble'].includes(store.data.settings.chatMode))store.data.settings.chatMode='panel';
  if(!store.data.settings.personaModes||typeof store.data.settings.personaModes!=='object'||Array.isArray(store.data.settings.personaModes))store.data.settings.personaModes={};
  personaLibrary=new PersonaLibrary(path.join(store.directory,'personas'),packs);personaCatalog=personaLibrary.catalog();
  for(const entry of personaCatalog)if(!entry.entries.some(e=>e.id!=='base'&&!e.error&&!e.archived&&e.id===store.data.settings.personaModes[entry.characterId])){const fallback=entry.entries.find(e=>e.id==='friendly'&&!e.error)??entry.entries.find(e=>e.id!=='base'&&!e.error&&!e.archived);if(fallback)store.data.settings.personaModes[entry.characterId]=fallback.id;}
  const area = screen.getPrimaryDisplay().workArea;
  const selectedPack = packs.find(p => p.manifest.id === store.data.settings.characterId);
  petLayout.characterWidth = (selectedPack?.manifest.size.width ?? 150) * store.data.settings.characterScale; petLayout.characterHeight = (selectedPack?.manifest.size.height ?? 190) * store.data.settings.characterScale;
  const petWidth = Math.max(120, Math.ceil(petLayout.characterWidth + 16)), petHeight = Math.ceil(petLayout.characterHeight + 48);
  const savedPosition = store.data.settings.position;
  const requested = savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y) ? { x: savedPosition.x + (savedPosition.width ?? 250) / 2 - petWidth / 2, y: savedPosition.y + (savedPosition.height ?? 270) - petHeight } : { x: area.x + area.width - petWidth - 10, y: area.y + area.height - petHeight - 20 };
  const character = {x:requested.x + petWidth / 2 - petLayout.characterWidth / 2,y:requested.y + petHeight - 35 - petLayout.characterHeight,width:petLayout.characterWidth,height:petLayout.characterHeight};
  const visible = screen.getAllDisplays().some(({bounds}) => Math.min(character.x + character.width,bounds.x + bounds.width) - Math.max(character.x,bounds.x) >= Math.min(16,character.width) && Math.min(character.y + character.height,bounds.y + bounds.height) - Math.max(character.y,bounds.y) >= Math.min(16,character.height));
  const x = Math.round(visible ? requested.x : area.x + area.width - petWidth - 24), y = Math.round(visible ? requested.y : area.y + area.height - petHeight - 24);
  const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true };
  // Keep the pet borderless and nonactivating; corner behavior still needs OS-specific verification.
  pet = new BrowserWindow({ width: petWidth, height: petHeight, x, y, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: store.data.settings.alwaysOnTop, show: false, ...(process.platform === 'darwin' ? {type:'panel',roundedCorners:false,acceptFirstMouse:true,hiddenInMissionControl:true,enableLargerThanScreen:true} : {}), webPreferences });
  petWindowBounds = pet.getBounds();
  petAnchor = {x:petWindowBounds.x + petWindowBounds.width / 2,y:petWindowBounds.y + petWindowBounds.height};
  pet.setAlwaysOnTop(store.data.settings.alwaysOnTop);
  pet.setIgnoreMouseEvents(true,{forward:true});
  panel = new BrowserWindow({ width: Math.min(460, area.width - 24), height: Math.min(740, area.height - 24), frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: store.data.settings.alwaysOnTop, show: false,...(process.platform==='darwin'?{roundedCorners:false,acceptFirstMouse:true}:{}), webPreferences });
  petNotice=new BrowserWindow({width:196,height:52,frame:false,transparent:true,hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,focusable:false,skipTaskbar:true,alwaysOnTop:store.data.settings.alwaysOnTop,show:false,...(process.platform==='darwin'?{type:'panel',roundedCorners:false,acceptFirstMouse:true,hiddenInMissionControl:true,enableLargerThanScreen:true}:{}),webPreferences});
  petNotice.setIgnoreMouseEvents(true,{forward:true});
  pet.on('hide',()=>{petNotice.hide();publish(true);});
  pet.on('show',()=>{if(petLayout.bubbleVisible&&!screenLocked&&!systemSuspended&&!petNotice.webContents.isLoadingMainFrame())petNotice.showInactive();publish(true);});
  petNotice.once('ready-to-show',()=>{if(petLayout.bubbleVisible&&pet.isVisible())petNotice.showInactive();});
  panel.on('focus',()=>{if(!historyLoading && !(forcedDemo || store.data.settings.demo))void refreshModels(true).catch(()=>{});});
  panel.on('show',()=>publish(true)); panel.on('hide',()=>publish(true));
  for (const window of [pet, petNotice, panel]) {
    window.rendererReady = false;
    window.webContents.on('did-start-loading',()=>{window.rendererReady=false;if(window===pet||window===petNotice){noticeHit=null;noticeHitRevision++;}});
    if (process.platform !== 'win32') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    if (smoke || realSmoke) window.webContents.on('console-message', details => { if (details.level === 'error') console.error('RENDERER_ERROR', details.message); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on('did-finish-load', () => { window.rendererReady=true; if(window===panel&&window.pendingTab)window.webContents.send('show-tab',window.pendingTab); window.catalogVersion = 0; window.assetRevision = null; window.messageView = null; window.historyRevision = -1; if (window === petNotice && !petDrag) pet.webContents.send('pet-layout-changed'); publish(); });
    window.webContents.on('render-process-gone', (_event, details) => {
      if (quitting) return;
      window.rendererReady=false;
      if (!store.warning) store.warning = '화면이 종료되어 복구합니다. 질문은 자동 재전송하지 않습니다. (' + details.reason + ')';
      window.catalogVersion = 0; window.messageView = null;
      if(window===pet){petIgnoringMouse=true;petPointerSignature='';pet.setIgnoreMouseEvents(true,{forward:true});}
      if (window === pet || window === petNotice) {
        petLayout.bubbleVisible = false; noticeHit = null;noticeHitRevision++; noticeIgnoringMouse = true;
        petNotice.setIgnoreMouseEvents(true,{forward:true}); petNotice.hide();
      }
      if (!window.recoveryAt || Date.now() - window.recoveryAt > 30000) window.recoveryAttempts = 0;
      window.recoveryAt = Date.now(); window.recoveryAttempts = (window.recoveryAttempts ?? 0) + 1;
      if (window.recoveryAttempts <= 1) setTimeout(() => { if (!quitting && !window.isDestroyed()) window.webContents.reload(); },100);
      else { window.hide(); store.warning = '화면 복구가 반복 실패했습니다. 트레이의 화면 복구 또는 앱 재실행을 사용해주세요.'; }
      publish(true);
    });
    window.on('unresponsive', () => { if (!store.warning) store.warning = '화면 응답이 지연됩니다. 트레이에서 화면을 복구할 수 있습니다.'; publish(true); });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  }
  pet.on('move', () => {
    if (petPositioning) return;
    const bounds = pet.getBounds();
    petAnchor.x += bounds.x - petWindowBounds.x; petAnchor.y += bounds.y - petWindowBounds.y; petWindowBounds = bounds;
    const width = Math.max(120,Math.ceil(petLayout.characterWidth + 16)), height = Math.ceil(petLayout.characterHeight + 48);
    store.data.settings.position = {x:petAnchor.x - width / 2,y:petAnchor.y - height,width,height};
    if(petLayout.bubbleVisible)pet.webContents.send('pet-layout-changed');
    if(panel.compactMode&&panel.isVisible())showPanel('chat',false,true);
  });
  pet.on('recover-position', (force = false) => {
    const character = {x:petAnchor.x - petLayout.characterWidth / 2,y:petAnchor.y - 35 - petLayout.characterHeight,width:petLayout.characterWidth,height:petLayout.characterHeight};
    if (!force && screen.getAllDisplays().some(({bounds}) => Math.min(character.x + character.width,bounds.x + bounds.width) - Math.max(character.x,bounds.x) >= Math.min(16,character.width) && Math.min(character.y + character.height,bounds.y + bounds.height) - Math.max(character.y,bounds.y) >= Math.min(16,character.height))) return;
    const area = screen.getPrimaryDisplay().workArea, bounds = pet.getBounds(), width = Math.max(120,Math.ceil(petLayout.characterWidth + 16)), height = Math.ceil(petLayout.characterHeight + 48);
    petDrag = null; petPointerPosition = null;
    const anchor = {x:area.x + area.width - Math.max(width,bounds.width) / 2 - 24,y:area.y + area.height - 24};
    const x = Math.round(anchor.x - bounds.width / 2), y = Math.round(anchor.y - bounds.height);
    petPositioning = true;
    try { pet.setPosition(x,y); } finally { petPositioning = false; }
    petWindowBounds = pet.getBounds(); petAnchor = {x:anchor.x + petWindowBounds.x - x,y:anchor.y + petWindowBounds.y - y};
    store.data.settings.position = {x:petAnchor.x - width / 2,y:petAnchor.y - height,width,height};
    try { store.save({includeHistory:false}); } catch(error) { store.warning = '버디 위치 저장 실패: '+error.message; }
    pet.webContents.send('pet-layout-changed'); syncPetPointer(); publish();
    if(panel.compactMode&&panel.isVisible())showPanel('chat',false,true);
    if (force) pet.showInactive();
  });
  for (const name of ['display-removed','display-metrics-changed']) screen.on(name, () => { if (!quitting) pet.emit('recover-position'); });
  pet.once('ready-to-show', () => pet.showInactive());
  await Promise.all([pet.loadFile(path.join(__dirname, 'ui/index.html'), { query: { surface: 'pet' } }),petNotice.loadFile(path.join(__dirname,'ui/notice.html')), panel.loadFile(path.join(__dirname, 'ui/index.html'), { query: { surface: 'panel' } })]);
  petPointerTimer = setInterval(syncPetPointer,80);
  let image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.png' : 'tray.png'));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  else image = image.resize({width:32,height:32});
  tray = new Tray(image);
  if (process.platform === 'darwin') app.dock.hide();
  tray.setToolTip(store.data.settings.buddyName+' · 바탕화면 친구');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '버디와 대화', click: () => { pet.show(); showPanel(); } },
    { label: '캐릭터와 설정', click: () => { pet.show(); showPanel('settings'); } },
    { label: '버디 보이기 / 숨기기', click: () => { if (pet.isVisible()) { pet.hide(); panel.hide(); } else pet.showInactive(); } },
    { label: '버디 위치 초기화', click: () => pet.emit('recover-position',true) },
    { label: '화면 복구', click: () => { for (const window of [pet,petNotice,panel]) {window.recoveryAttempts=0;window.webContents.reload();} pet.showInactive(); } },
    { type: 'separator' }, { label: '종료', click: () => app.quit() }
  ]));
  tray.on('click', () => { pet.show(); showPanel(); });
  store.shortcut = globalShortcut.register('CommandOrControl+Shift+Space', () => { pet.show(); showPanel(); });
  onBattery=powerMonitor.isOnBatteryPower();
  for(const name of ['lock-screen','unlock-screen','on-battery','on-ac','suspend','resume'])powerMonitor.on(name,()=>{
    if(name==='lock-screen')screenLocked=true;
    if(name==='unlock-screen')screenLocked=false;
    if(name==='on-battery')onBattery=true;
    if(name==='on-ac')onBattery=false;
    if(name==='suspend'){systemSuspended=true;queuePaused=true;if(current){current.cancelled=true;codex.stop();void finishJob('interrupted','PC가 절전 상태로 전환되어 연결을 종료했습니다.');}}
    if(name==='resume'){systemSuspended=false;if(!queue.length)queuePaused=false;}
    if(screenLocked||systemSuspended)petNotice.hide();
    publish(true);
  });
  publish();
  if(lifecycleSmoke){showPanel('settings');setTimeout(()=>require('../scripts/buddy-lifecycle-smoke.cjs')({app,pet,petNotice,panel,store,codex,powerMonitor,dialog,publish,getRuntime:()=>({current,queue,queuePaused,systemSuspended,requests})}),700);}
  if (petPointerSmoke) void require('../scripts/pet-pointer-smoke.cjs')({app,pet,screen,petAnchor,getIgnoring:()=>petIgnoringMouse});
  if (floatingSmoke) void require(process.argv.includes('--native-floating-review') ? '../scripts/native-floating-smoke.cjs' : '../scripts/floating-ui-smoke.cjs')({app,pet,panel,screen,store,getAnchor:()=>petAnchor,getIgnoring:()=>petIgnoringMouse,getDrag:()=>petDrag});
  if(buddyFeatureSmoke){showPanel();setTimeout(()=>require('../scripts/buddy-features-smoke.cjs')({app,pet,panel,store,codex,personaLibrary,skins}),700);}
  if (modelSmoke&&!attachmentSmoke) { showPanel(); setTimeout(() => require('../scripts/model-ui-smoke.cjs')({ app,panel,store,codex,modelCatalog }),700); }
  if(deleteSmoke){showPanel();setTimeout(()=>require('../scripts/deletion-ui-smoke.cjs')({app,panel,store,codex}),700);}
  if (historySmoke) { showPanel(); setTimeout(() => require('../scripts/history-ui-smoke.cjs')({ app,panel,store,codex }),700); }
  if (performanceSmoke) {showPanel();setTimeout(()=>require('../scripts/performance-ui-smoke.cjs')({app,panel,store,codex}),700);}
  if (timingSmoke) {showPanel();setTimeout(()=>require('../scripts/timing-ui-smoke.cjs')({app,panel,store,codex}),700);}
  if(resourceSmoke) void require('../scripts/resource-smoke.cjs')({app,pet,panel,store});
  if (stabilitySmoke) { showPanel(); setTimeout(()=>require('../scripts/stability-ui-smoke.cjs')({app,pet,petNotice,panel,store,showPanel}),700); }
  if(attachmentSmoke){showPanel();setTimeout(()=>require('../scripts/attachments-ui-smoke.cjs')({app,panel,store,codex,dialog,shell,publish,getRuntime:()=>({current,queue,modelsStatus,preparing})}),700);}
  if(connectionImageSmoke){showPanel();setTimeout(()=>require('../scripts/connection-image-smoke.cjs')({app,panel,store,codex,shell,responseImages,publish,getRuntime:()=>({current,queue,queuePaused,connectionState,modelsStatus,modelRefreshing:Boolean(modelRefresh),setup:connectionSetup.state})}),700);}
  if (smoke || realSmoke) { showPanel(); require('../scripts/alpha-ui-smoke.cjs')({app,pet,petNotice,panel,store,codex,screen,publish,smoke,realSmoke}); }

}).catch(error => { console.error(error); codex.stop(); dialog.showErrorBox('옹기봇 시작 실패', error.message); app.exit(1); });

ipcMain.handle('action', async (event, action, payload = {}) => {
  if (quitting) return {ok:false};
  while (store?.saving && !['send','cancel','respond','sync','notice-hit','pet-pointer-sync','pet-layout','drag-start','drag-move','show-panel','hide-panel','copy','open-url','response-image'].includes(action)) { try { await store.saving; } catch {} }
  const owner=[pet,petNotice,panel].find(w=>w&&!w.isDestroyed()&&w.webContents===event.sender);
  if (!owner || event.senderFrame!==event.sender.mainFrame) throw new Error('허용되지 않은 창입니다.');
  if(attachmentPicking&&['send','new-chat','open-conversation','delete-conversation','pick-workspace','pick-codex','settings','pick-attachments'].includes(action))throw Error('첨부 선택을 마친 뒤 진행해주세요.');
  if(owner===petNotice&&!['sync','show-panel','notice-hit','pet-pointer-sync'].includes(action))throw Error('안내 말풍선에서는 대화 열기만 사용할 수 있습니다.');
  if(action==='notice-hit'){
    if(owner!==petNotice||![payload.x,payload.y,payload.width,payload.height].every(Number.isFinite)||payload.x<0||payload.y<0||payload.width<=0||payload.height<=0||payload.x+payload.width>196||payload.y+payload.height>52)throw Error('안내 말풍선 클릭 영역을 확인해주세요.');
    if(payload.revision!==noticeHitRevision)return{ok:false,revision:noticeHitRevision};
    noticeHit={x:payload.x,y:payload.y,width:payload.width,height:payload.height};syncPetPointer();return{ok:true,revision:noticeHitRevision};
  }
  if (action === 'sync') { if(payload.includeCatalog!==false){owner.catalogVersion = 0;owner.assetRevision=null;} if (owner === panel) owner.historyRevision = -1; publish(); return { ok: true }; }
  if (action === 'load-older') {
    if(event.sender!==panel.webContents)throw new Error('대화창에서만 이전 내용을 불러올 수 있습니다.');
    let count=0,bytes=0;
    for(let i=store.data.messages.length-(panel.messageLimit??100)-1;i>=0&&count<100;i--){const size=Buffer.byteLength(store.data.messages[i].text);if(count&&bytes+size>256*1024)break;bytes+=size;count++;}
    panel.messageLimit=(panel.messageLimit??100)+count;panel.expandedHistory=true;publish(true);return{ok:true};
  }
  if (action === 'response-rendered') {
    if (event.sender !== panel.webContents) throw new Error('대화창에서만 화면 반영을 확인할 수 있습니다.');
    if (!panel.isVisible() || screenLocked || systemSuspended) return {ok:false};
    const reply = store.data.messages.find(m => m.id === payload.id && m.role === 'assistant');
    if (!reply?.timing?.completedAt || reply.timing.renderedAt !== undefined) return {ok:true};
    if (!Number.isFinite(payload.renderedAt) || Math.abs(payload.renderedAt - (performance.timeOrigin + performance.now())) > 60000) throw new Error('화면 반영 시각이 올바르지 않습니다.');
    const previous = { ...reply.timing };
    reply.timing.renderedAt = Math.max(reply.timing.completedAt,payload.renderedAt);
    reply.timing.renderMs = reply.timing.renderedAt - reply.timing.completedAt;
    reply.timing.totalMs = reply.timing.submittedAt === null ? null : reply.timing.renderedAt - reply.timing.submittedAt;
    try { await store.saveAsync(); } catch (error) { reply.timing = previous; publish(true); throw error; }
    publish(true); return {ok:true};
  }
  if (action === 'delete-conversation') {
    if(event.sender!==panel.webContents||payload.confirmed!==true)throw new Error('대화창에서 삭제할 대화를 확인해주세요.');
    if(current||queue.length||preparing||historyLoading||modelRefresh)throw new Error('진행 중인 작업을 완료하거나 취소한 뒤 대화를 삭제해주세요.');
    if(store.pendingDeletion?.id===payload.id&&store.pendingDeletion.phase==='cli-deleted'){
      const ids=store.pendingDeletion.ids,activeDeleted=ids.includes(store.data.activeConversationId);store.recoverPendingDeletion();if(activeDeleted||!store.data.threadId){resumed=false;listening=false;codex.stop();}panel.messageView=null;publish(true);return{ok:true,deletedIds:ids};
    }
    const selected=store.data.conversations.find(c=>c.id===payload.id&&c.source==='onggi_bot');
    if(!selected)throw new Error('옹기봇에서 만든 대화만 삭제할 수 있습니다.');
    historyLoading=true;historyWarning=null;publish(true);
    let connection=codex,remoteDeleted=false;
    const removedThreads=new Set(), relatedThreads=new Set([selected.threadId]);
    const onDeleted=message=>{if(message.method==='thread/deleted'&&relatedThreads.has(message.params?.threadId))removedThreads.add(message.params.threadId);};
    try{
      store.beginDeletion(selected.id);
      if(selected.threadId){
        if(selected.codexPath!==store.data.settings.codexPath||selected.workspace!==store.data.settings.workspace)connection=new CodexConnection();
        connection.on('notification',onDeleted);
        await connection.connect(selected.codexPath||store.data.settings.codexPath,selected.workspace||store.data.settings.workspace);
        const owned = store.data.conversations.filter(c => c.threadId && c.codexPath === selected.codexPath && c.workspace === selected.workspace), parents = new Map(), deadline = Date.now() + 30000;
        for (const c of owned) {
          if (store.pendingDeletion.ids.includes(c.id)) relatedThreads.add(c.threadId);
          if (Date.now() >= deadline) throw new Error('파생 대화 확인 시간이 초과됐습니다. 로컬 기록을 보존합니다.');
          try {
            const response = await connection.request('thread/read',{threadId:c.threadId,includeTurns:false},Math.max(1,deadline-Date.now()));
            if (response?.thread?.id !== c.threadId) throw new Error('조회된 대화 ID가 일치하지 않습니다.');
            if (typeof response.thread.parentThreadId === 'string') parents.set(c.threadId,response.thread.parentThreadId);
          } catch (error) {
            if (error.code !== -32600 || ![`thread not loaded: ${c.threadId}`,`no rollout found for thread id ${c.threadId}`].includes(error.message)) throw error;
          }
        }
        for (const c of owned) {
          let parent = parents.get(c.threadId); const seen = new Set();
          while (parent && !seen.has(parent)) { if (relatedThreads.has(parent)) {relatedThreads.add(c.threadId);break;} seen.add(parent);parent=parents.get(parent); }
        }
        store.beginDeletion(selected.id,{relatedIds:owned.filter(c=>relatedThreads.has(c.threadId)).map(c=>c.id)});
        try{await connection.request('thread/delete',{threadId:selected.threadId});}
        catch(error){
          if(error.code!==-32600||error.message!==`no rollout found for thread id ${selected.threadId}`)throw error;
          let absent=false;
          try{await connection.request('thread/read',{threadId:selected.threadId,includeTurns:false});}
          catch(readError){absent=readError.code===-32600&&[`thread not loaded: ${selected.threadId}`,`no rollout found for thread id ${selected.threadId}`].includes(readError.message);if(!absent)throw readError;}
          if(!absent)throw error;
        }
        remoteDeleted=true;removedThreads.add(selected.threadId);
        // Confirm descendants from the persisted scope; notifications may arrive after the RPC reply.
        for (const threadId of relatedThreads) {
          if (threadId === selected.threadId) continue;
          let absent = false;
          try { await connection.request('thread/read',{threadId,includeTurns:false}); }
          catch (error) { absent = error.code === -32600 && [`thread not loaded: ${threadId}`,`no rollout found for thread id ${threadId}`].includes(error.message); if (!absent) throw error; }
          if (!absent) throw new Error('파생 CLI 세션 삭제를 확인하지 못했습니다. 로컬 기록을 보존합니다.');
          removedThreads.add(threadId);
        }
      }
      const deletedIds=store.data.conversations.filter(c=>store.pendingDeletion.ids.includes(c.id)).map(c=>c.id);
      const activeDeleted=deletedIds.includes(store.data.activeConversationId);
      store.completeDeletion(deletedIds);
      if(activeDeleted){resumed=false;listening=false;codex.stop();}
      panel.messageView=null;return{ok:true,deletedIds};
    }catch(error){
      if(remoteDeleted&&removedThreads.has(store.data.threadId))resumed=false;
      historyWarning=remoteDeleted?'CLI 세션은 삭제됐지만 로컬 정리를 완료하지 못했습니다. 삭제를 다시 시도하거나 앱을 재실행해주세요.':'삭제를 완료하지 못했습니다. 로컬 기록은 보존됩니다. 다시 삭제를 눌러 확인해주세요.';
      throw new Error(historyWarning+' '+error.message);
    }finally{connection.off('notification',onDeleted);if(connection!==codex)connection.stop();historyLoading=false;publish(true);}
  }
  if (action === 'open-conversation') {
    if (current || queue.length || preparing || historyLoading || modelRefresh) throw new Error('진행 중인 작업을 완료하거나 취소한 뒤 대화를 바꿔주세요.');
    if(store.pendingDeletion?.ids.includes(payload.id))throw new Error('삭제 확인이 필요한 대화입니다. 먼저 삭제를 재시도해주세요.');
    const selected = store.data.conversations.find(c => c.id === payload.id && c.source === 'onggi_bot');
    if (!selected) throw new Error('옹기봇에서 만든 대화만 열 수 있습니다.');
    historyLoading = true; historyWarning = null; publish();
    try {
      const contextChanged = selected.workspace !== store.data.settings.workspace || selected.codexPath !== store.data.settings.codexPath;
      store.openConversation(selected.id);panel.messageView=null; resumed = false; listening = false;
      if (contextChanged) { codex.stop(); connectionState = 'disconnected'; modelCatalog.models = []; modelsStatus = 'idle'; }
      if (selected.threadId && selected.mode === 'codex' && !forcedDemo) {
        try {
          await codex.connect(store.data.settings.codexPath, store.data.settings.workspace);
          const response = await codex.request('thread/read', { threadId: selected.threadId, includeTurns: true });
          if(response?.thread?.id!==selected.threadId||!Array.isArray(response.thread.turns))throw Error('조회한 대화 ID·기록 형식이 일치하지 않습니다.');
          const previous = store.data.messages, messages = [];
          let previousIndex = 0;
          for (const turn of response.thread.turns ?? []) {
            if(!turn||typeof turn.id!=='string'||!turn.id||!Array.isArray(turn.items)||!['completed','failed','interrupted','inProgress'].includes(turn.status))throw Error('Codex 턴 기록 형식을 확인해주세요.');
            for(const item of turn.items){if(!item||typeof item.type!=='string')throw Error('Codex 항목 형식을 확인해주세요.');if(item.type==='agentMessage'&&typeof item.text!=='string'||item.type==='userMessage'&&(!Array.isArray(item.content)||item.content.some(content=>!content||typeof content.type!=='string'||content.type==='text'&&typeof content.text!=='string')))throw Error('Codex 대화 텍스트 형식을 확인해주세요.');}
            const input = turn.items?.filter(i => i.type === 'userMessage').flatMap(i => i.content ?? []).find(i => i.type === 'text')?.text??'';
            if (!input) continue;
            const remoteUserId = turn.items?.find(i => i.type === 'userMessage')?.id;
            let oldIndex = previous.findIndex(m => m.role === 'user' && (m.turnId === turn.id || m.id === remoteUserId));
            if (oldIndex < 0) oldIndex = previous.findIndex((m,i) => i >= previousIndex && m.role === 'user' && m.text === input);
            const oldUser = oldIndex >= 0 ? previous[oldIndex] : null, oldReply = oldIndex >= 0 && previous[oldIndex + 1]?.role === 'assistant' ? previous[oldIndex + 1] : null;
            if (oldIndex >= 0) previousIndex = oldIndex + 1;
            const output = turn.items?.filter(i => i.type === 'agentMessage').map(i => i.text).join('\n\n') ?? '';
            const status = turn.status === 'completed' ? 'completed' : turn.status === 'failed' ? 'failed' : 'interrupted';
            const timestamp = Number(turn.startedAt) || selected.createdAt;
            messages.push({ ...oldUser, id: oldUser?.id ?? `${turn.id}:user`, turnId: turn.id, role: 'user', text: input, mode: 'codex', status, createdAt: oldUser?.createdAt ?? (timestamp < 1e12 ? timestamp * 1000 : timestamp) });
            const images=[];
            for(const item of turn.items){if(images.length>=8)break;if(item.type==='imageGeneration'||item.type==='mcpToolCall'&&Array.isArray(item.result?.content)&&item.result.content.some(c=>c?.type==='image'))images.push(...await responseImages.capture(item,{workspace:store.data.settings.workspace,threadId:selected.threadId}));}
            if (output || oldReply || images.length) messages.push({ ...oldReply, id: oldReply?.id ?? `${turn.id}:reply`, turnId: turn.id, role: 'assistant', text: output || oldReply?.text || '',...(images.length?{images:images.slice(0,8)}:{}), mode: 'codex', status, createdAt: oldReply?.createdAt ?? Date.now() });
          }
          if (messages.length && messages.length >= previous.filter(m => !['failed','interrupted'].includes(m.status)).length) {
            const remoteUserIds = new Set(messages.filter(m => m.role === 'user').map(m => m.id));
            for (let i = 0; i < previous.length; i++) if (previous[i].role === 'user' && !remoteUserIds.has(previous[i].id)) { messages.push(previous[i]); if (previous[i + 1]?.role === 'assistant') messages.push(previous[++i]); }
            store.data.messages=messages;try{store.save();}catch(error){if(!store.writeBlocked)store.data.messages=previous;throw error;}
          }
          connectionState = 'connected';
        } catch (error) { historyWarning = store.writeBlocked?`원격 기록 병합을 확정하지 못했습니다. 현재 화면·원본·저널을 보존합니다: ${error.message}`:`저장된 기록을 표시합니다. Codex 기록 확인: ${error.message}`; }
      }
      return { ok: true };
    } finally { historyLoading = false; publish(); }
  }
  if (action === 'refresh-models') { if (historyLoading) throw new Error('연결 설정·기록 처리 후 모델 목록을 확인해주세요.'); if (forcedDemo || store.data.settings.demo) return {ok:true}; await refreshModels(Boolean(payload.ifStale)); return { ok: true }; }
  if(action==='recover-connection'||action==='find-cli'){
    if(owner!==panel||current||preparing||historyLoading||modelRefresh||packImporting||connectionSetup.attempt||queue.length&&!queuePaused)throw Error('현재 작업을 마치거나 중단한 뒤 연결을 복구해주세요.');
    if(forcedDemo||store.data.settings.demo)throw Error('체험 모드를 끈 뒤 실제 연결을 확인해주세요.');
    clearTimeout(reconnectTimer);reconnectAttempted=false;resumed=false;
    if(action==='find-cli'){
      const candidate=ConnectionSetup.findExecutable(null);
      if(!candidate){connectionIssue={phase:'missing-cli',message:'설치된 Codex를 찾지 못했어요. 설치 안내를 따라 설치한 뒤 다시 찾아주세요.'};publish(true);return{ok:false};}
      if(candidate!==store.data.settings.codexPath){
        if(queue.length)throw Error('대기 질문을 취소한 뒤 CLI 위치를 변경해주세요.');
        historyLoading=true;publish(true);const probe=new CodexConnection({experimentalApi:true});connectionProbe=probe;
        try{
          await probe.connect(candidate,store.data.settings.workspace);
          if(quitting||owner.isDestroyed()||current||preparing)throw Error('연결 확인 중 상태가 바뀌었어요. 다시 시도해주세요.');
          store.newConversation({settings:{...store.data.settings,codexPath:candidate}});panel.messageView=null;modelCatalog.models=[];modelsStatus='idle';
        }finally{probe.stop();if(connectionProbe===probe)connectionProbe=null;historyLoading=false;publish(true);}
      }
    }
    codex.stop();connectionState='disconnected';await refreshModels(false);return{ok:true};
  }
  if(action==='login-chatgpt'||action==='cancel-login'){
    if(owner!==panel)throw Error('대화창에서 로그인을 진행해주세요.');
    if(action==='cancel-login')return connectionSetup.cancelLogin();
    if(forcedDemo||store.data.settings.demo||current||preparing||historyLoading||modelRefresh||packImporting||queue.length&&!queuePaused)throw Error('체험 모드를 끄고 현재 작업을 마친 뒤 로그인해주세요.');
    if(!codex.process)await refreshModels(false).catch(error=>{if(connectionSetup.state.phase!=='login-required')throw error;});
    const result=await connectionSetup.startLogin();if(result.alreadyAuthenticated)await refreshModels(false);return result;
  }
  if(action==='response-image'||action==='open-response-image'){
    if(owner!==panel)throw Error('대화창에서 이미지를 확인해주세요.');
    const image=store.data.messages.find(m=>m.id===payload.messageId&&m.role==='assistant')?.images?.find(i=>i.id===payload.imageId&&i.status==='ready');
    if(!image)throw Error('이 대화의 이미지 결과를 찾지 못했어요.');
    const result=responseImages.read(action==='response-image'?{id:image.previewId,mime:'image/png'}:image);
    if(action==='response-image')return{ok:true,source:result.source};
    const error=await shell.openPath(result.file);if(error)throw Error('원본 이미지를 열지 못했어요. '+error);return{ok:true};
  }
  if(action==='pick-attachments'){
    if(owner!==panel||historyLoading||preparing||systemSuspended)throw Error('대화창에서 첨부를 선택해주세요.');
    const conversationId=store.data.activeConversationId,workspace=store.data.settings.workspace;attachmentPicking=true;publish(true);
    try{
      for(const [id,record]of pendingAttachments)if(Date.now()-record.createdAt>3600000&&!reservedAttachments.has(id))pendingAttachments.delete(id);
      if(pendingAttachments.size>=128)throw Error('사용하지 않는 첨부를 제거한 뒤 다시 선택해주세요.');
      const selected=await dialog.showOpenDialog(panel,{title:payload.kind==='image'?'이미지 첨부':'파일 첨부',properties:['openFile','multiSelections'],...(payload.kind==='image'?{filters:[{name:'이미지',extensions:['png','jpg','jpeg','webp']}]}:{})});
      if(selected.canceled)return{ok:true,attachments:[]};
      if(selected.filePaths.length+pendingAttachments.size>128)throw Error('사용하지 않는 첨부를 제거한 뒤 다시 선택해주세요.');
      const attachments=await attachmentStore.import(selected.filePaths,{imagesOnly:payload.kind==='image'});
      if(quitting||owner.isDestroyed()||conversationId!==store.data.activeConversationId||workspace!==store.data.settings.workspace)throw Error('대화가 바뀌었어요. 새 대화에서 다시 첨부해주세요.');
      for(const attachment of attachments)pendingAttachments.set(attachment.id,{attachment:Object.freeze(attachment),conversationId,createdAt:Date.now()});
      return{ok:true,attachments};
    }finally{attachmentPicking=false;publish(true);}
  }
  if(action==='discard-attachment'){
    if(owner!==panel||reservedAttachments.has(payload.id))throw Error('첨부를 접수하고 있어요. 잠시 기다려주세요.');
    pendingAttachments.delete(payload.id);return{ok:true};
  }
  if(action==='attachment-preview'||action==='open-attachment'){
    if(owner!==panel)throw Error('대화창에서 첨부를 확인해주세요.');
    const pending=payload.messageId?null:pendingAttachments.get(payload.id),attachment=payload.messageId?store.data.messages.find(m=>m.id===payload.messageId&&m.role==='user')?.attachments?.find(a=>a.id===payload.id):pending?.conversationId===store.data.activeConversationId?pending.attachment:null;
    if(!attachment)throw Error('이 대화의 첨부를 찾지 못했어요.');
    const {file}=attachmentStore.read(attachment);
    if(action==='attachment-preview'){if(attachment.kind!=='image')throw Error('이미지 첨부를 선택해주세요.');return{ok:true,source:responseImages.read({id:attachment.previewId,mime:'image/png'}).source};}
    if(attachment.kind==='image'){const error=await shell.openPath(file);if(error)throw Error('이미지를 열지 못했어요. '+error);}else shell.showItemInFolder(file);return{ok:true};
  }
  if (action === 'model-settings') {
    if (!modelCatalog.models.length) await refreshModels();
    const model = payload.model || null, effort = payload.effort || null;
    const serviceTier = payload.serviceTier ?? store.data.settings.serviceTier;
    if ((model !== null && typeof model !== 'string') || (effort !== null && typeof effort !== 'string')) throw new Error('모델 설정 형식이 올바르지 않습니다.');
    if (typeof serviceTier !== 'string') throw new Error('속도 설정 형식이 올바르지 않습니다.');
    modelCatalog.resolve(model, effort, serviceTier);
    const previous = { model:store.data.settings.model, effort:store.data.settings.effort, serviceTier:store.data.settings.serviceTier };
    Object.assign(store.data.settings, {model, effort, serviceTier});
    try { store.save({includeHistory:false}); } catch (error) { Object.assign(store.data.settings, previous); publish(true); throw error; }
    publish(); return { ok: true };
  }
  if (action === 'pet-pointer-sync') {
    if (![pet,petNotice].some(w=>w.webContents===event.sender) || ![payload.x,payload.y].every(n => Number.isFinite(n) && Math.abs(n) < 100000)) throw new Error('포인터 좌표가 올바르지 않습니다.');
    petPointerPosition = {x:payload.x,y:payload.y,at:Date.now()}; syncPetPointer(); return {ok:true,ignore:petIgnoringMouse,noticeIgnore:noticeIgnoringMouse};
  }
  if (action === 'pet-layout') {
    if (event.sender !== pet.webContents || typeof payload.bubbleVisible !== 'boolean' || typeof payload.controlsVisible !== 'boolean') throw new Error('캐릭터 창 상태가 올바르지 않습니다.');
    const pack = packs.find(p => p.manifest.id === store.data.settings.characterId);
    petLayout = { bubbleVisible: payload.bubbleVisible && !petDrag, controlsVisible: payload.controlsVisible, characterWidth: pack.manifest.size.width * store.data.settings.characterScale, characterHeight: pack.manifest.size.height * store.data.settings.characterScale };
    const bounds = pet.getBounds(), width = Math.max(120,Math.ceil(petLayout.characterWidth + 16)), height = Math.ceil(petLayout.characterHeight + 48);
    if (width !== bounds.width || height !== bounds.height) {
      const anchor = petAnchor;
      let x = Math.round(anchor.x - width / 2), y = Math.round(anchor.y - height);
      petPositioning = true;
      try { pet.setBounds({x,y,width,height}); } finally { petPositioning = false; }
    }
    const updated = pet.getBounds();
    petWindowBounds = updated;
    const area=screen.getDisplayNearestPoint({x:Math.round(petAnchor.x),y:Math.round(petAnchor.y-35-petLayout.characterHeight/2)}).bounds;
    petLayout.noticeAnchorX = petAnchor.x + (pack.manifest.bubbleAnchor.x - .5) * petLayout.characterWidth;
    const above=petAnchor.y-35-petLayout.characterHeight + pack.manifest.bubbleAnchor.y * petLayout.characterHeight - 64;noticeBelow=above<area.y;
    const nx=Math.round(Math.max(area.x,Math.min(petLayout.noticeAnchorX-98,area.x+area.width-196))),ny=Math.round(Math.max(area.y,Math.min(noticeBelow?petAnchor.y+4:above,area.y+area.height-52)));
    const previousNotice=petNotice.getBounds();if(previousNotice.x!==nx||previousNotice.y!==ny)petNotice.setBounds({x:nx,y:ny,width:196,height:52});
    if(petLayout.bubbleVisible&&pet.isVisible()&&!petNotice.webContents.isLoadingMainFrame())petNotice.showInactive();else petNotice.hide();
    publish();
    const idleWidth = Math.max(120,Math.ceil(petLayout.characterWidth + 16)), idleHeight = Math.ceil(petLayout.characterHeight + 48);
    store.data.settings.position = {x:petAnchor.x - idleWidth / 2,y:petAnchor.y - idleHeight,width:idleWidth,height:idleHeight};
    return {ok:true,bounds:updated,centerX:petAnchor.x - updated.x,bottom:updated.y + updated.height - petAnchor.y + 35,noticeBounds:petNotice.getBounds()};
  }
  if (action === 'activity') { listening = Boolean(payload.listening); publish(); return { ok: true }; }
  if (action === 'show-panel') { showPanel(payload.tab,payload.full===true); return { ok: true }; }
  if (action === 'hide-panel') { panel.hide(); listening = false; publish(); return { ok: true }; }
  if (action === 'drag-start' || action === 'drag-move' || action === 'drag-end') {
    if (event.sender !== pet.webContents) throw new Error('캐릭터에서만 이동할 수 있습니다.');
    if (action === 'drag-end') { petDrag = null; store.save({includeHistory:false}); return {ok:true}; }
    if (![payload.x,payload.y].every(n => Number.isFinite(n) && Math.abs(n) < 100000)) throw new Error('이동 값이 올바르지 않습니다.');
    if (action === 'drag-start') { petDrag = { x: payload.x, y: payload.y, bounds: pet.getBounds() }; petIgnoringMouse = false; pet.setIgnoreMouseEvents(false); return {ok:true}; }
    if (!petDrag) return {ok:false};
    const bounds = petDrag.bounds;
    petPositioning = true;
    try { pet.setPosition(Math.round(bounds.x + payload.x - petDrag.x),Math.round(bounds.y + payload.y - petDrag.y)); } finally { petPositioning = false; }
    const moved = pet.getBounds(); petAnchor.x += moved.x - petWindowBounds.x; petAnchor.y += moved.y - petWindowBounds.y; petWindowBounds = moved;
    if(panel.compactMode&&panel.isVisible())showPanel('chat',false,true);
    store.data.settings.position = {x:moved.x,y:moved.y,width:moved.width,height:moved.height};
    return { ok: true };
  }
  if (action === 'sleep') { sleeping = !sleeping; publish(); return { ok: true }; }
  if (action === 'select-character') {
    if (!packs.some(p => !p.temporary&&p.manifest.id === payload.id)) throw new Error('정상 캐릭터 팩을 선택해주세요.');
    const previous = store.data.settings.characterId;
    store.data.settings.characterId = payload.id;
    try { store.save({includeHistory:false}); } catch (error) { store.data.settings.characterId = previous; publish(true); throw error; }
    publish(); return { ok: true };
  }
  if (action === 'pack-discard-preview') {if(owner!==panel)throw Error('설정에서 미리보기를 닫아주세요.');if(!packImporting&&packPreview?.token===payload.token)packPreview=null;return{ok:true};}
  if (action === 'pack-preview') {
    if(owner!==panel||packImporting)throw Error('한 번에 한 캐릭터 팩만 준비할 수 있습니다.');
    packImporting=true;
    try{
      let source;
      if(payload.archiveToken){if(!packArchiveCatalog.some(e=>e.token===payload.archiveToken))throw Error('보관한 팩을 찾을 수 없습니다.');source=path.join(packLibrary.directory,payload.archiveToken);}
      else{const selection=await dialog.showOpenDialog(panel,{title:'캐릭터 폴더 미리보기',properties:['openDirectory']});if(selection.canceled)return{ok:true,canceled:true};source=selection.filePaths[0];}
      const loaded=loadPack(source);await assetValidator.validate(loaded);
      const installed=packs.find(p=>!p.temporary&&p.manifest.id===loaded.manifest.id);
      if(installed?.builtin)throw Error('기본 캐릭터는 덮어쓸 수 없습니다. 다른 ID로 가져와주세요.');
      packPreview={token:randomUUID(),pack:loaded,expiresAt:Date.now()+600000};
      return{ok:true,token:packPreview.token,pack:{...loaded.manifest,thumbnail:loaded.thumbnail,errorThumbnail:loaded.errorThumbnail,hasPoster:loaded.hasPoster},installedVersion:installed?.manifest.version??null};
    }finally{packImporting=false;}
  }
  if(action==='pack-apply'||action==='pack-remove'){
    if(owner!==panel||packImporting||store.writeBlocked||store.saving||current||queue.length||preparing||historyLoading||modelRefresh)throw Error('진행 중인 작업을 마친 뒤 캐릭터를 변경해주세요.');
    const selected=action==='pack-remove'?packs.find(p=>p.manifest.id===payload.id):packPreview?.token===payload.token&&packPreview.expiresAt>Date.now()?packPreview.pack:null;
    if(!selected)throw Error('미리보기나 캐릭터를 다시 선택해주세요.');
    const installed=packs.find(p=>!p.temporary&&p.manifest.id===selected.manifest.id);
    if(installed?.builtin||action==='pack-remove'&&(!installed||payload.confirmed!==true))throw Error('사용자 팩을 선택해 제거 범위를 확인해주세요.');
    if(action==='pack-apply'&&installed&&payload.replace!==true)throw Error('같은 ID의 팩 업데이트를 확인해주세요.');
    if(action==='pack-remove'&&packs.filter(p=>!p.temporary).length<=1)throw Error('정상 캐릭터를 하나 더 설치한 뒤 마지막 팩을 제거해주세요.');
    const previousPacks=packs,previousLibrary=personaLibrary,previousCatalog=personaCatalog,previousSelection={characterId:store.data.settings.characterId,personaModes:{...store.data.settings.personaModes}};
    packImporting=true;
    try{
      packLibrary.change(selected,action==='pack-remove'?'remove':installed?'replace':'install',store,candidate=>{
        const nextPacks=packs.filter(p=>!p.temporary&&p.manifest.id!==selected.manifest.id);if(candidate)nextPacks.push(candidate);
        const nextLibrary=new PersonaLibrary(path.join(store.directory,'personas'),nextPacks),nextCatalog=nextLibrary.catalog();
        const settings={...store.data.settings,personaModes:{...store.data.settings.personaModes}};
        if(!candidate&&settings.characterId===selected.manifest.id)settings.characterId=(nextPacks.find(p=>p.builtin)??nextPacks[0]).manifest.id;
        if(candidate&&payload.select===true)settings.characterId=candidate.manifest.id;
        for(const entry of nextCatalog){
          const valid=entry.entries.filter(e=>e.id!=='base'&&!e.archived&&!e.error);
          if(entry.characterId===settings.characterId&&entry.entries.find(e=>e.id==='base')?.error)throw Error('활성 캐릭터의 기본 성격 MD를 먼저 수정해주세요.');
          if(!valid.some(e=>e.id===settings.personaModes[entry.characterId])){const fallback=valid.find(e=>e.id==='friendly')??valid[0];if(fallback)settings.personaModes[entry.characterId]=fallback.id;else if(entry.characterId===settings.characterId)throw Error('사용할 말투를 확인해주세요.');}
          if(entry.warning&&(entry.characterId===settings.characterId||entry.characterId===candidate?.manifest.id))throw Error('말투 목록을 복구하거나 충돌하지 않는 팩 ID를 사용해주세요. '+entry.warning);
        }
        store.data.settings=settings;store.save({includeHistory:false});packs=nextPacks;personaLibrary=nextLibrary;personaCatalog=nextCatalog;
      });
      if(packLibrary.warning)store.warning=packLibrary.warning;packPreview=null;packArchiveCatalog=packLibrary.archives();catalogVersion++;publish();return{ok:true};
    }catch(error){packs=previousPacks;personaLibrary=previousLibrary;personaCatalog=previousCatalog;Object.assign(store.data.settings,previousSelection);if(packLibrary.warning)store.warning=packLibrary.warning;publish(true);throw error;}
    finally{packImporting=false;}
  }
  if(action==='pack-export'){
    if(owner!==panel||packImporting)throw Error('설정에서 내보낼 팩을 선택해주세요.');
    const selected=packs.find(p=>p.manifest.id===payload.id&&!p.temporary);if(!selected)throw Error('정상 캐릭터 팩을 선택해주세요.');
    packImporting=true;
    try{const selection=await dialog.showOpenDialog(panel,{title:'팩을 내보낼 폴더',properties:['openDirectory','createDirectory']});if(selection.canceled)return{ok:true,canceled:true};
      if(!packs.includes(selected))throw Error('팩이 변경되어 다시 선택해주세요.');
      const fresh=loadPack(selected.root);await assetValidator.validate(fresh);
      if(quitting||panel.isDestroyed()||!packs.includes(selected))throw Error('팩이 변경되어 다시 선택해주세요.');
      const destination=packLibrary.export(fresh,selection.filePaths[0],payload.includeEdited===true?personaLibrary:null);
      return{ok:true,destination};
    }finally{packImporting=false;}
  }
  if (action === 'pick-workspace' || action === 'pick-codex') {
    if (current || queue.length || modelRefresh || preparing || historyLoading) throw new Error('작업 또는 기록 조회 완료 후 설정을 변경해주세요.');
    historyLoading = true; publish(true);
    try {
      const selection = await dialog.showOpenDialog(panel, { title: action === 'pick-workspace' ? 'Codex가 사용할 작업 폴더 선택' : 'Codex CLI 실행 파일 선택', properties: [action === 'pick-workspace' ? 'openDirectory' : 'openFile'] });
      if (!selection.canceled) {
        if (current || queue.length || modelRefresh || preparing) throw new Error('진행 중인 작업을 마친 뒤 연결 설정을 변경해주세요.');
        const selected = selection.filePaths[0], stat = fs.statSync(selected);
        if (action === 'pick-workspace' ? !stat.isDirectory() : !stat.isFile()) throw new Error('선택한 경로를 확인해주세요.');
        if (action === 'pick-codex') {
          fs.accessSync(selected, fs.constants.X_OK);
          if (process.platform === 'win32' && !/\.exe$/i.test(selected)) throw new Error('Windows 네이티브 codex.exe를 선택해주세요.');
        }
        store.newConversation({settings:{...store.data.settings, [action === 'pick-workspace' ? 'workspace' : 'codexPath']:selected}});
        panel.messageView = null; resumed = false; listening = false; codex.stop(); connectionState = 'disconnected'; modelCatalog.models = []; modelsStatus = 'idle'; modelsError = null;
      }
      return { ok: true };
    } finally { historyLoading = false; publish(true); }
  }
  if (action === 'rename-buddy') {
    if(event.sender!==panel.webContents)throw new Error('설정 화면에서 이름을 변경해주세요.');
    if(typeof payload.name!=='string'||/[\u0000-\u001f\u007f-\u009f]/u.test(payload.name))throw new Error('이름은 줄바꿈 없이 1~20자로 입력해주세요.');
    const name=payload.name.trim().normalize('NFC');
    if(!name||Array.from(name).length>20)throw new Error('이름은 1~20자로 입력해주세요.');
    const previous=store.data.settings.buddyName;store.data.settings.buddyName=name;
    try{store.save({includeHistory:false});}catch(error){store.data.settings.buddyName=previous;throw error;}
    tray.setToolTip(name+' · 바탕화면 친구');publish();return{ok:true,name};
  }
  if (action === 'settings') {
    if(payload.appearanceProfile!==undefined&&!['custom','quiet','daily','lively'].includes(payload.appearanceProfile))throw Error('표시 프로필을 확인해주세요.');
    if(payload.characterScale!==undefined&&![.35,.5,.65].includes(payload.characterScale))throw Error('표시 크기를 확인해주세요.');
    if(payload.skinId!==undefined&&!skins.some(s=>s.id===payload.skinId))throw Error('지원하는 스킨을 선택해주세요.');
    if(payload.chatMode!==undefined&&!['panel','bubble'].includes(payload.chatMode))throw Error('지원하는 대화 표시 방식을 선택해주세요.');
    const modeChanged = typeof payload.demo === 'boolean' && payload.demo !== store.data.settings.demo;
    if (modeChanged && (current || queue.length || modelRefresh || preparing || historyLoading)) throw new Error('작업 또는 기록 조회 완료 후 모드를 변경해주세요.');
    const previous = store.data.settings, next = { ...previous };
    for (const key of ['skinId','chatMode','appearanceProfile','characterScale']) if (payload[key] !== undefined) next[key] = payload[key];
    for (const key of ['demo','reducedMotion','measureResponseTime','alwaysOnTop','batterySaver']) if (typeof payload[key] === 'boolean') next[key] = payload[key];
    try {
      if (modeChanged) store.newConversation({settings:next});
      else { store.data.settings = next; store.save({includeHistory:false}); }
    } catch (error) { store.data.settings = previous; publish(true); throw error; }
    if (modeChanged) { panel.messageView = null; resumed = false; listening = false; if(next.demo&&connectionSetup.attempt)await connectionSetup.cancelLogin(); }
    if (next.alwaysOnTop !== previous.alwaysOnTop) for (const window of [pet,petNotice,panel]) if (!window.isDestroyed()) window.setAlwaysOnTop(next.alwaysOnTop);
    if (modeChanged && !next.demo && modelsStatus === 'idle') void refreshModels().catch(() => {});
    publish(); return { ok: true };
  }
  if(action==='persona-settings'||action==='persona-save'||action==='persona-reload'||action==='persona-manage'||action==='open-personas'){
    if(event.sender!==panel.webContents)throw Error('대화 또는 설정 화면에서 페르소나를 변경해주세요.');
    if(action==='open-personas'){const error=await shell.openPath(personaLibrary.root);if(error)throw Error('MD 폴더를 열지 못했습니다. '+error);return{ok:true};}
    if(action==='persona-settings'){
      const entry=personaCatalog.find(p=>p.characterId===payload.characterId)?.entries.find(e=>e.id===payload.mode&&e.id!=='base');
      if(!entry||entry.error||entry.archived)throw Error('사용할 수 있는 말투 모드를 선택해주세요.');
      const previous=store.data.settings.personaModes[payload.characterId];store.data.settings.personaModes[payload.characterId]=payload.mode;
      try{store.save({includeHistory:false});}catch(error){store.data.settings.personaModes[payload.characterId]=previous;throw error;}
    }
    if(action==='persona-manage'){
      if(payload.operation==='archive'&&(store.data.settings.personaModes[payload.characterId]===payload.id||current||queue.length))throw Error('다른 말투를 선택하고 작업을 마친 뒤 보관해주세요.');
      personaLibrary.manage(payload.characterId,payload.operation,payload);
    }
    if(action==='persona-reload')personaLibrary=new PersonaLibrary(personaLibrary.root,packs);
    if(action==='persona-save')personaLibrary.save(payload.characterId,payload.id,payload.text);
    personaCatalog=personaLibrary.catalog();catalogVersion++;publish();return{ok:true};
  }
  if (action === 'new-chat') {
    if (current || queue.length || preparing || historyLoading) throw new Error('실행과 대기 작업을 먼저 완료하거나 취소해주세요.');
    store.newConversation();panel.messageView=null; resumed = false; historyWarning = null; publish(); return { ok: true };
  }
  if (action === 'continue-queue') {
    if(owner!==panel||systemSuspended||screenLocked)throw Error('화면이 열린 상태에서 대기 질문을 계속해주세요.');
    if(!(forcedDemo||store.data.settings.demo))await refreshModels(true);
    queuePaused=false;publish();void runQueue();return{ok:true};
  }
  if (action === 'send') {
    if(packs.some(p=>p.temporary&&p.manifest.id===store.data.settings.characterId))throw Error('정상 캐릭터 팩을 가져오거나 설치 파일을 복구한 뒤 질문해주세요.');
    const receivedAt=performance.timeOrigin+performance.now();
    if(systemSuspended)throw Error('절전 복귀 후 질문해주세요.');
    if(packImporting)throw Error('캐릭터 작업을 마친 뒤 질문해주세요.');
    if(queuePaused&&queue.length)throw Error('대기 질문을 계속하거나 취소한 뒤 질문해주세요.');
    if(!queue.length)queuePaused=false;
    if(store.pendingDeletion?.ids.includes(store.data.activeConversationId))throw Error('현재 대화의 삭제 확인이 필요합니다.');
    if(store.writeBlocked)throw Error('저장 복구가 필요합니다. 앱을 다시 실행하고 기록 폴더를 확인해주세요.');
    if(historyLoading)throw Error('이전 대화를 불러오는 중입니다.');
    if(typeof payload.text!=='string'||payload.text.length>8000||!payload.text.trim()&&!payload.attachmentIds?.length)throw Error('질문이나 첨부를 넣어주세요. 질문은 최대 8,000자입니다.');
    const attachmentIds=payload.attachmentIds??[];
    if(!Array.isArray(attachmentIds)||attachmentIds.length>8||new Set(attachmentIds).size!==attachmentIds.length)throw Error('첨부는 질문당 최대 8개까지 가능해요.');
    const attachments=attachmentIds.map(id=>{const record=pendingAttachments.get(id);if(!record||record.conversationId!==store.data.activeConversationId||reservedAttachments.has(id))throw Error('이 대화에 선택한 첨부를 확인해주세요.');return record.attachment;});
    if(attachments.reduce((sum,a)=>sum+a.bytes,0)>32*1024*1024)throw Error('첨부 합계는 32MiB까지 가능해요.');
    if(queue.length+preparing>=10)throw Error('대기 요청은 최대 10개입니다.');
    const settings={...store.data.settings},messages=store.data.messages,text=payload.text.trim()?payload.text:'첨부한 자료를 확인해주세요.',id=randomUUID(),replyId=randomUUID();
    const persona=personaLibrary.resolve(settings.characterId,settings.personaModes[settings.characterId],settings.buddyName);
    const mode=forcedDemo||settings.demo?'demo':'codex',previous=admissionTail;let release;
    // 접수 확정 순서는 모델 실행 큐·저장 워커의 순서와 별도로 보장한다.
    admissionTail=new Promise(resolve=>{release=resolve;});for(const id of attachmentIds)reservedAttachments.add(id);preparing++;publish();
    try{
      await previous;
      while(store.saving)await store.saving;
      if(mode==='codex')await refreshModels(true);
      while(store.saving)await store.saving;
      if(quitting||systemSuspended||packImporting||historyLoading||store.writeBlocked||messages!==store.data.messages||settings.workspace!==store.data.settings.workspace||settings.codexPath!==store.data.settings.codexPath||owner.isDestroyed()||event.senderFrame!==event.sender.mainFrame||store.pendingDeletion?.ids.includes(store.data.activeConversationId))throw Error('접수 중 대화 상태가 바뀌었습니다. 질문은 실행하지 않았습니다.');
      const selection=mode==='demo'?{model:null,effort:null,modelName:'체험'}:modelCatalog.resolve(settings.model,settings.effort,settings.serviceTier);
    const pendingReplies = store.data.messages.filter(m => m.role === 'assistant' && ['queued','running'].includes(m.status)).length;
    let storedBytes = 2;
    for (const message of store.data.messages) {
      let cached = messageSizeCache.get(message);
      if (!cached || cached.text !== message.text) { cached={text:message.text,bytes:Buffer.byteLength(JSON.stringify(message.text))};messageSizeCache.set(message,cached); }
      storedBytes += Buffer.byteLength(JSON.stringify({...message,text:undefined})) + cached.bytes + 9;
    }
    if (storedBytes + 700000 * (pendingReplies + 1) > 32 * 1024 * 1024) throw new Error('대화 저장 용량이 한도에 가까워졌습니다. 진행 중인 질문을 마친 뒤 새 대화를 시작해주세요.');

      listening=false;
      const timing=settings.measureResponseTime?{receivedAt,submittedAt:Number.isFinite(payload.submittedAt)&&Math.abs(payload.submittedAt-receivedAt)<60000?Math.min(payload.submittedAt,receivedAt):null,enqueuedAt:performance.timeOrigin+performance.now(),mode}:undefined;
      const personaMetadata=persona?{characterId:persona.characterId,id:persona.id,name:persona.name,hash:persona.hash}:null;
      messages.push({id,role:'user',text,status:'queued',createdAt:Date.now(),mode,...selection,...(attachments.length?{attachments}:{})},{id:replyId,role:'assistant',text:'',status:'queued',createdAt:Date.now(),mode,...selection,persona:personaMetadata,...(timing?{timing}:{})});
      try{await store.saveAsync();}catch(error){if(!store.writeBlocked){for(let i=messages.length-1;i>=0;i--)if(messages[i].id===id||messages[i].id===replyId)messages.splice(i,1);}else for(const message of messages)if([id,replyId].includes(message.id))message.status='interrupted';publish(true);throw error;}
      for(const record of pendingAttachments.values())if(record.conversationId===null)record.conversationId=store.data.activeConversationId;
      if(quitting||systemSuspended||queuePaused||store.writeBlocked||owner.isDestroyed()||event.senderFrame!==event.sender.mainFrame){
        for(const message of messages)if([id,replyId].includes(message.id)){message.status='interrupted';if(message.role==='assistant')message.error='접수 중 중단되어 실행하지 않았습니다.';}
        try{await store.saveAsync();}catch(error){store.writeBlocked=true;store.warning=error.message;}
        throw Error('접수 중 중단되어 질문을 실행하지 않았습니다.');
      }
      if(!queue.length)queuePaused=false;
      for(const id of attachmentIds)pendingAttachments.delete(id);
      queue.push({id,replyId,text,attachments,selection,mode,buddyName:settings.buddyName,workspace:settings.workspace,codexPath:settings.codexPath,persona});publish();void runQueue();return{ok:true,id,conversationId:store.data.activeConversationId};
    }finally{for(const id of attachmentIds)reservedAttachments.delete(id);preparing--;release();publish();}
  }
  if (action === 'cancel') {
    if (payload.id && current?.id !== payload.id) {
      const index = queue.findIndex(j => j.id === payload.id);
      if (index !== -1) {
        const [job] = queue.splice(index, 1);
        for (const id of [job.id,job.replyId]) store.data.messages.find(m => m.id === id).status = 'interrupted';
        const reply = store.data.messages.find(m => m.id === job.replyId);
        if (reply.timing) { const t=reply.timing;t.completedAt=performance.timeOrigin + performance.now();t.status='interrupted';t.inputMs=t.submittedAt===null?null:Math.max(0,t.receivedAt-t.submittedAt);t.queueMs=Math.max(0,t.completedAt-t.enqueuedAt); }
        try{await store.saveAsync();}catch(error){store.writeBlocked=true;queuePaused=true;publish(true);throw error;}if(!queue.length)queuePaused=false;publish();
      }
    } else if (current) {
      const job = current;if(job.finishing)return{ok:true};job.cancelled = true;
      if (job.mode !== 'demo') {
        try { if(job.turnId)await codex.interrupt({threadId:job.threadId??store.data.threadId,turnId:job.turnId}); }
        catch (error) {
          if (current === job) { codex.stop(); resumed = false; await finishJob('interrupted', '중단 확인에 실패해 연결을 종료했습니다. 자동 재전송하지 않습니다. ' + error.message); }
          publish(true); return {ok:true,connectionStopped:true};
        }
        if (current === job && job.turnId && store.data.messages.find(m => m.id === job.replyId)?.status === 'running') {
          clearTimeout(job.timeout);
          job.timeout = setTimeout(async () => { if (current === job) { codex.stop(); resumed = false; await finishJob('interrupted', '중단 완료 알림이 오지 않아 연결을 종료했습니다.'); } }, 5000);
        }
      }
      publish();
    }
    return { ok: true };
  }
  if (action === 'respond') {
    const request = requests.find(r => r.id === payload.id);
    if(!request||!current||request.jobId&&request.jobId!==current.id||request.params.threadId&&request.params.threadId!==store.data.threadId||request.params.turnId&&current.turnId&&request.params.turnId!==current.turnId)throw new Error('이 요청은 더 이상 유효하지 않습니다.');
    let result;
    if (request.method === 'item/tool/requestUserInput') {
      const answers = Object.create(null);
      for (const question of request.params.questions) {
        const value = payload.answers?.[question.id];
        if (typeof value !== 'string' || value.length > 8000) throw new Error('추가 질문에 답변해주세요.');
        answers[question.id] = { answers: [value] };
      }
      result = { answers };
    } else if (request.method === 'item/permissions/requestApproval') {
      result = { permissions: {}, scope: 'turn' };
    } else {
      if(payload.decision==='accept'&&(request.details?.truncated||request.method==='item/fileChange/requestApproval'&&(!Array.isArray(request.details?.changes)||!request.details.changes.length||request.details.changes.some(change=>!change||typeof change.path!=='string'||typeof change.diff!=='string'))))throw Error('변경 미리보기를 확인할 수 없어 이 창에서는 허용하지 않습니다.');
      const network=request.params.networkApprovalContext;
      if(payload.decision==='accept'&&network!==undefined&&network!==null&&(!network||typeof network!=='object'||typeof network.host!=='string'||!network.host||network.host.length>253||!['http','https','socks5Tcp','socks5Udp'].includes(network.protocol)||/[\u0000-\u001f]/u.test(network.host+network.protocol)))throw Error('네트워크 승인 대상을 확인할 수 없습니다.');
      if (!['accept','decline','cancel'].includes(payload.decision)) throw new Error('승인 값이 올바르지 않습니다.');
      result = { decision: payload.decision };
    }
    codex.respond(request.id, result); requests = requests.filter(r => r.id !== request.id); publish(); return { ok: true };
  }
  if (action === 'copy') { if (typeof payload.text !== 'string' || payload.text.length > 100000) throw new Error('복사할 내용을 확인해주세요.'); clipboard.writeText(payload.text); return { ok: true }; }
  if (action === 'open-url') {
    if (typeof payload.url !== 'string' || payload.url.length > 8192) throw new Error('링크를 확인해주세요.');
    const url = new URL(payload.url);
    if (!['https:','http:'].includes(url.protocol)) throw new Error('웹 링크만 열 수 있습니다.');
    await shell.openExternal(url.href); return { ok: true };
  }
  if (action === 'open-data') { const error=await shell.openPath(store.directory);if(error)throw Error('기록 폴더를 열지 못했습니다. '+error);return { ok: true }; }
  throw new Error('지원하지 않는 동작입니다.');
});
app.on('second-instance', () => { pet?.show(); if (!petPointerSmoke) showPanel(); });
app.on('activate', () => { pet?.show(); if (!petPointerSmoke) showPanel(); });
app.on('window-all-closed', () => {});
let quitSaved = false;
app.on('before-quit', event => {
  if (quitSaved) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true; clearTimeout(current?.timeout); current?.resolve?.(); clearTimeout(replyStateTimer); clearInterval(petPointerTimer); globalShortcut.unregisterAll();
  clearTimeout(reconnectTimer);connectionSetup.dispose();connectionProbe?.stop();
  codex.stop();
  void (async () => {
    if (store) {
      if(current?.imageWork)await current.imageWork.catch(()=>{});
      if (store.saving) { try { await store.saving; } catch {} }
      for (const message of store.data.messages) if (['queued','running'].includes(message.status)) message.status = 'interrupted';
      try { await store.saveAsync(); } catch (error) { console.error('종료 시 저장 실패:',error.message); }
      try { await store.closeWorker(); } catch (error) { console.error('저장 워커 정리 실패:',error.message); }
    }
    quitSaved = true; app.quit();
  })();
});
