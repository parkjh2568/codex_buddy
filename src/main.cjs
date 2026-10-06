const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, clipboard, shell, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { loadPack } = require('./packs.cjs');
const { CodexConnection } = require('./codex.cjs');
const { ModelCatalog } = require('./models.cjs');

const smoke = !app.isPackaged && process.argv.includes('--smoke');
const realSmoke = !app.isPackaged && process.argv.includes('--real-smoke');
const modelSmoke = !app.isPackaged && process.argv.includes('--model-smoke');
const timingSmoke = !app.isPackaged && process.argv.includes('--timing-smoke');
const performanceSmoke = !app.isPackaged && process.argv.includes('--performance-smoke');
const deleteSmoke = !app.isPackaged && process.argv.includes('--delete-smoke');
const historySmoke = !app.isPackaged && process.argv.includes('--history-smoke');
const petPointerSmoke = !app.isPackaged && process.argv.includes('--pet-pointer-smoke');
const floatingSmoke = !app.isPackaged && process.argv.includes('--floating-smoke');
if (smoke || realSmoke || modelSmoke || historySmoke || petPointerSmoke || timingSmoke || performanceSmoke || deleteSmoke || floatingSmoke) app.setPath('userData', path.join(__dirname, '..', 'artifacts', floatingSmoke ? 'floating-smoke-profile' : deleteSmoke ? 'delete-smoke-profile' : performanceSmoke ? 'performance-smoke-profile' : timingSmoke ? 'timing-smoke-profile' : petPointerSmoke ? 'pet-pointer-smoke-profile' : historySmoke ? 'history-smoke-profile' : modelSmoke ? 'model-smoke-profile' : realSmoke ? 'real-smoke-profile' : 'smoke-profile'));
app.setName('OnggiBot');
if (!app.requestSingleInstanceLock()) app.quit();

let pet, panel, tray, store, packs = [], packErrors = [], queue = [], current = null, requests = [], connectionState = 'disconnected', resumed = false, sleeping = false, listening = false, quitting = false, publishTimer, catalogVersion = 1;
const codex = new CodexConnection();
const modelCatalog = new ModelCatalog(codex);
let modelsStatus = 'idle', modelsError = null, modelRefresh = null;
let cliFileIdentity = null;
let historyLoading = false, historyWarning = null, preparing = 0;
let petPointerTimer, petPointerSignature = '', petIgnoringMouse = true, petDrag = null;
let petLayout = { bubbleVisible: false, controlsVisible: false, characterWidth: 75, characterHeight: 95 };
let petAnchor, petPointerPosition, petWindowBounds, petPositioning = false;
const forcedDemo = smoke || performanceSmoke || petPointerSmoke || floatingSmoke || process.argv.includes('--demo');

function syncPetPointer() {
  if (!pet || quitting || pet.isDestroyed()) return;
  const bounds = pet.getBounds(), cursor = petPointerPosition && Date.now() - petPointerPosition.at < 200 ? petPointerPosition : screen.getCursorScreenPoint();
  const px = cursor.x - bounds.x, py = cursor.y - bounds.y;
  const centerX = petAnchor.x - bounds.x, characterBottom = petAnchor.y - bounds.y - 35;
  const insideWindow = pet.isVisible() && px >= 0 && py >= 0 && px < bounds.width && py < bounds.height;
  const insideCharacter = insideWindow && px >= centerX - petLayout.characterWidth / 2 - 5 && px <= centerX + petLayout.characterWidth / 2 + 5 && py >= characterBottom - petLayout.characterHeight - 8 && py <= characterBottom + 3;
  const insideControls = insideWindow && px >= centerX - 54 && px <= centerX + 54 && py >= characterBottom + 3 && py <= characterBottom + 35;
  const characterTop = characterBottom - petLayout.characterHeight;
  const bubbleTop = Math.min(bounds.height - 44,Math.max(8,characterTop < 48 ? characterBottom + 39 : characterTop + (packs.find(p => p.manifest.id === store.data.settings.characterId)?.manifest.bubbleAnchor.y ?? .12) * petLayout.characterHeight - 44));
  const insideBubble = insideWindow && petLayout.bubbleVisible && px >= bounds.width / 2 - 94 && px <= bounds.width / 2 + 94 && py >= bubbleTop && py <= bubbleTop + 42;
  const ignore = !petDrag && !(insideCharacter || insideBubble || (petLayout.controlsVisible && insideControls));
  if (ignore !== petIgnoringMouse) { petIgnoringMouse = ignore; pet.setIgnoreMouseEvents(ignore,{forward:true}); }
  const signature = `${insideWindow}:${insideCharacter}:${insideControls}`;
  if (signature !== petPointerSignature) { petPointerSignature = signature; pet.webContents.send('pet-pointer',{insideWindow,insideCharacter,insideControls}); }
}

async function refreshModels(onlyIfStale = false) {
  if (modelRefresh) return modelRefresh;
  let identity = null;
  try { const file = fs.statSync(store.data.settings.codexPath); identity = `${store.data.settings.codexPath}:${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}`; } catch {}
  const cliChanged = cliFileIdentity !== null && identity !== null && identity !== cliFileIdentity;
  if (onlyIfStale && !cliChanged && modelsStatus === 'ready' && Date.now() - modelCatalog.refreshedAt < 5 * 60 * 1000) return {models:modelCatalog.models,defaults:modelCatalog.defaults};
  if (!onlyIfStale || !modelCatalog.models.length) modelsStatus = 'loading';
  modelsError = null; publish();
  modelRefresh = (async () => {
    const restartAllowed = !current && !queue.length && !historyLoading;
    if (cliChanged && restartAllowed) { codex.stop(); resumed = false; }
    await codex.connect(store.data.settings.codexPath, store.data.settings.workspace);
    if (!cliChanged || restartAllowed) cliFileIdentity = identity;
    const result = await modelCatalog.refresh(store.data.settings.workspace);
    connectionState = 'connected'; modelsStatus = 'ready'; publish(); return result;
  })();
  try { return await modelRefresh; }
  catch (error) { modelsStatus = modelCatalog.models.length ? 'ready' : 'error'; modelsError = error.message; publish(); throw error; }
  finally { modelRefresh = null; }
}

function publish(immediate = false) {
  if (!store) return;
  if (publishTimer) { if (!immediate) return; clearTimeout(publishTimer); }
  publishTimer = setTimeout(() => {
    publishTimer = null;
    const state = {
      settings: store.data.settings, messageTotal: store.data.messages.length, threadId: store.data.threadId,
      lastMessageStatus: store.data.messages.at(-1)?.status,
      queue: queue.map(j => ({ id: j.id, text: j.text })), busy: Boolean(current), requests,
      connection: (forcedDemo || store.data.settings.demo) ? 'demo' : connectionState, demoLocked: forcedDemo,
      characterState: sleeping ? 'sleeping' : requests.length ? 'attention' : current ? 'thinking' : listening ? 'listening' : store.data.messages.at(-1)?.status === 'failed' ? 'error' : 'idle',
      sleeping, warning: store.warning, packErrors, shortcut: store.shortcut,
      models: modelCatalog.models, modelDefaults: modelCatalog.defaults, modelsStatus, modelsError,
      activeConversationId: store.data.activeConversationId, conversations: [...store.data.conversations].sort((a,b) => b.updatedAt - a.updatedAt), historyLoading, historyWarning, preparing, pendingDeletionId:store.pendingDeletion?.id??null
    };
    for (const window of [pet, panel]) if (window && !window.isDestroyed()) {
      let payload;
      if (window===pet) payload={settings:state.settings,busy:state.busy,lastMessageStatus:state.lastMessageStatus,characterState:state.characterState,sleeping:state.sleeping};
      else {
        const reset=!window.messageView || window.messageView.conversationId!==state.activeConversationId;
        if (reset) {window.messageView={conversationId:state.activeConversationId,entries:new Map()};window.expandedHistory=false;}
        if (!window.expandedHistory) {
          let count=0,bytes=0;
          for(let i=store.data.messages.length-1;i>=0&&count<100;i--){const size=Buffer.byteLength(store.data.messages[i].text);if(count&&bytes+size>256*1024)break;bytes+=size;count++;}
          window.messageLimit=Math.max(1,count);
        }
        const visible=store.data.messages.slice(-(window.messageLimit??100)),entries=new Map(),upsert=[];
        for (const message of visible) {
          const metadata=JSON.stringify({...message,text:undefined}),previous=window.messageView.entries.get(message.id);
          if (!previous || previous.text!==message.text || previous.metadata!==metadata) upsert.push(message);
          entries.set(message.id,{text:message.text,metadata});
        }
        window.messageView.entries=entries;
        payload={...state,messagePatch:{reset,ids:visible.map(m=>m.id),upsert}};
      }
      window.webContents.send('state', window.catalogVersion === catalogVersion ? payload : { ...payload, packs: packs.map(p => ({ ...p.manifest, assets: p.assets })) });
      window.catalogVersion = catalogVersion;
    }
  }, immediate ? 0 : 50);
}

function showPanel(tab = 'chat') {
  if (!pet || !panel) return;
  const bounds = pet.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
  const size = panel.getBounds();
  const x = bounds.x - size.width + 25 >= area.x ? bounds.x - size.width + 25 : bounds.x + bounds.width - 25;
  panel.setPosition(Math.max(area.x, Math.min(x, area.x + area.width - size.width)), Math.max(area.y, Math.min(bounds.y + bounds.height - size.height, area.y + area.height - size.height)));
  panel.show(); panel.focus(); panel.webContents.send('show-tab', tab); publish();
  if (!(forcedDemo || store.data.settings.demo)) void refreshModels(true).catch(() => {});
}

function finishJob(status, error) {
  if (!current) return;
  const assistant = store.data.messages.find(m => m.id === current.replyId);
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
  current.resolve?.();
  requests = [];
  try { store.save(); } catch(error) { store.writeBlocked=true;assistant.error=[assistant.error,'답변은 수신했지만 저장하지 못했습니다. '+error.message].filter(Boolean).join('\n'); }
  publish(true);
}

async function runQueue() {
  if (current || queue.length === 0 || quitting) return;
  if (store.writeBlocked) {
    for (const job of queue.splice(0)) for (const id of [job.id,job.replyId]) { const message=store.data.messages.find(m=>m.id===id);if(message){message.status='interrupted';if(message.role==='assistant'){message.error='저장 실패로 실행하지 않았습니다.';if(message.timing){const t=message.timing;t.completedAt=performance.timeOrigin+performance.now();t.status='interrupted';t.inputMs=t.submittedAt===null?null:Math.max(0,t.receivedAt-t.submittedAt);t.queueMs=Math.max(0,t.completedAt-t.enqueuedAt);}}} }
    publish(true);return;
  }
  current = queue.shift();
  const job = current;
  const reply = store.data.messages.find(m => m.id === job.replyId);
  const user = store.data.messages.find(m => m.id === job.id);
  if (reply.timing) reply.timing.queueStartedAt = performance.timeOrigin + performance.now();
  reply.status = 'running'; user.status = 'running'; sleeping = false; publish();
  try {
    if (job.mode === 'demo') {
      connectionState = 'demo';
      const answer = `체험 모드예요. 실제 Codex에는 보내지 않았어요.\n\n“${job.text}”라고 물어보셨네요.\n\n저는 옹기봇이에요. 바탕화면에서 함께 지내며 질문에 답하고, 앞으로 필요한 소식도 전해드릴 거예요. 설정에서 Codex 모드로 전환하면 실제 대화를 시작할 수 있어요.`;
      for (const chunk of answer.match(/.{1,8}|\n/g)) {
        if (job.cancelled || quitting) break;
        reply.text += chunk; publish();
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      finishJob(job.cancelled ? 'interrupted' : 'completed');
    } else {
      connectionState = 'connecting'; publish();
      await codex.connect(store.data.settings.codexPath, store.data.settings.workspace);
      connectionState = 'connected'; publish();
      if (job.cancelled) { finishJob('interrupted'); return; }
      const threadParams = { cwd: store.data.settings.workspace, model: job.selection.model, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
      if (!resumed) {
        const thread = store.data.threadId
          ? await codex.request('thread/resume', { ...threadParams, threadId: store.data.threadId })
          : await codex.request('thread/start', { ...threadParams, threadSource: 'onggi_bot' });
        store.data.threadId = thread.thread.id; resumed = true; store.save();
      }
      if (job.cancelled) { finishJob('interrupted'); return; }
      const completion = new Promise(resolve => { job.resolve = resolve; });
      const started = await codex.request('turn/start', { threadId: store.data.threadId, clientUserMessageId: job.id, input: [{ type: 'text', text: job.text }], model: job.selection.model, effort: job.selection.effort, serviceTierForTurn: job.selection.serviceTier, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly' } });
      job.turnId = started.turn.id;
      if (reply.status === 'running') {
        job.timeout = setTimeout(() => { codex.stop(); resumed = false; finishJob('interrupted', '10분 제한에 도달해 연결을 종료했습니다. 일부 작업이 실행됐을 수 있어 자동 재실행하지 않습니다.'); }, 10 * 60 * 1000);
        if (job.cancelled) await codex.interrupt();
      }
      await completion;
    }
  } catch (error) {
    if (reply.status === 'running') finishJob(job.cancelled ? 'interrupted' : 'failed', error.message);
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
  if (!current) return;
  const incomingTurn = params.turnId ?? params.turn?.id;
  if (current.turnId && incomingTurn && current.turnId !== incomingTurn) return;
  if (method === 'turn/started') { current.turnId = params.turn.id; for (const id of [current.id,current.replyId]) { const message = store.data.messages.find(m => m.id === id); if (message) message.turnId = current.turnId; } }
  const reply = store.data.messages.find(m => m.id === current.replyId);
  if (method === 'item/started' && ['fileChange','commandExecution'].includes(params.item?.type)) {
    current.toolItems ??= new Map(); current.toolItems.set(params.item.id, params.item);
  }
  if (method === 'item/agentMessage/delta') {
    if (reply.timing && params.delta && reply.timing.firstReplyAt === undefined) reply.timing.firstReplyAt = performance.timeOrigin + performance.now();
    current.items ??= new Map();
    current.items.set(params.itemId, ((current.items.get(params.itemId) ?? '') + params.delta).slice(0,100000));
    reply.text = [...current.items.values()].join('\n\n').slice(0,100000); publish();
  }
  if (method === 'item/completed' && params.item?.type === 'agentMessage') {
    if (reply.timing && params.item.text && reply.timing.firstReplyAt === undefined) reply.timing.firstReplyAt = performance.timeOrigin + performance.now();
    current.items ??= new Map(); current.items.set(params.item.id, (params.item.text ?? '').slice(0,100000));
    reply.text = [...current.items.values()].join('\n\n').slice(0,100000); publish();
  }
  if (method === 'turn/completed') finishJob(params.turn.status === 'completed' ? 'completed' : params.turn.status === 'interrupted' ? 'interrupted' : 'failed', params.turn.error?.message);
  if (method === 'error' && !params.willRetry) { reply.error = String(params.error?.message ?? 'Codex에서 오류가 발생했습니다.').slice(0,4000); publish(); }
});
codex.on('turn-sent', event => { if (current && event.threadId === store.data.threadId) { const reply = store.data.messages.find(m => m.id === current.replyId); if (reply?.timing) reply.timing.cliSentAt = event.at; } });
codex.on('request', request => {
  if (!current || (request.params?.threadId && request.params.threadId !== store.data.threadId) || (current.turnId && request.params?.turnId && request.params.turnId !== current.turnId)) { codex.write({ id: request.id, error: { code: -32601, message: 'No active OnggiBot conversation' } }); return; }
  const supported = ['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput'];
  if (!supported.includes(request.method)) {
    if (request.method === 'mcpServer/elicitation/request') codex.respond(request.id, { action: 'decline', content: null });
    else codex.write({ id: request.id, error: { code: -32601, message: 'This request is not supported by OnggiBot alpha' } });
    return;
  }
  requests.push({ id: request.id, method: request.method, params: request.params, details: current.toolItems?.get(request.params.itemId) });
  publish(); showPanel();
});
codex.on('disconnected', error => { connectionState = 'disconnected'; resumed = false; finishJob('interrupted', error); publish(); });
codex.on('protocol-error', error => { store.warning = error; publish(); });

app.whenReady().then(async () => {
  const candidates = process.env.PATH?.split(path.delimiter).map(p => path.join(p, process.platform === 'win32' ? 'codex.exe' : 'codex')) ?? [];
  candidates.push('/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(os.homedir(), '.local/bin/codex'), '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  let executable = 'codex';
  for (const candidate of candidates) { try { fs.accessSync(candidate, fs.constants.X_OK); executable = candidate; break; } catch {} }
  if (modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke) executable = path.join(__dirname, '..', 'test', 'fixtures', deleteSmoke?'delete-codex.cjs':'model-codex.cjs');
  const workspace = path.join(app.getPath('userData'), 'workspace'); fs.mkdirSync(workspace, { recursive: true });
  store = new Store(app.getPath('userData'), { characterId: 'onggi-clip', codexPath: executable, workspace, demo: false, reducedMotion: false, alwaysOnTop: true, position: null, model: 'gpt-5.6-luna', effort: 'high', serviceTier: 'default', measureResponseTime:false });
  if (smoke || realSmoke || modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke) { store.data.messages = []; store.data.threadId = null; store.data.settings.characterId = 'onggi-clip'; store.data.settings.model = realSmoke ? 'gpt-5.6-luna' : null; store.data.settings.effort = realSmoke ? 'high' : null; }
  if (smoke || realSmoke || modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke) { store.data.activeConversationId = null; store.data.conversations = []; store.snapshot = null; }
  if (smoke || realSmoke || modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke) {store.data.settings.serviceTier = 'default';store.data.settings.measureResponseTime = realSmoke;}
  if (modelSmoke || historySmoke || timingSmoke || performanceSmoke || deleteSmoke) { store.data.settings.codexPath = executable; store.data.settings.demo = false; }
  const userPacks = path.join(store.directory, 'characters'); fs.mkdirSync(userPacks, { recursive: true });
  for (const root of [path.join(__dirname, '..', 'characters'), userPacks]) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { const loaded = loadPack(path.join(root, entry.name)); if (packs.some(p => p.manifest.id === loaded.manifest.id)) throw new Error('같은 ID의 캐릭터가 있습니다.'); packs.push(loaded); }
      catch (error) { packErrors.push(`${entry.name}: ${error.message}`); }
    }
  }
  if (!packs.some(p => p.manifest.id === store.data.settings.characterId)) store.data.settings.characterId = packs[0]?.manifest.id;
  const area = screen.getPrimaryDisplay().workArea;
  const selectedPack = packs.find(p => p.manifest.id === store.data.settings.characterId);
  petLayout.characterWidth = (selectedPack?.manifest.size.width ?? 150) / 2; petLayout.characterHeight = (selectedPack?.manifest.size.height ?? 190) / 2;
  const petWidth = Math.max(120, Math.ceil(petLayout.characterWidth + 16)), petHeight = Math.ceil(petLayout.characterHeight + 48);
  const savedPosition = store.data.settings.position;
  const requested = savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y) ? { x: savedPosition.x + (savedPosition.width ?? 250) / 2 - petWidth / 2, y: savedPosition.y + (savedPosition.height ?? 270) - petHeight } : { x: area.x + area.width - petWidth - 10, y: area.y + area.height - petHeight - 20 };
  const character = {x:requested.x + petWidth / 2 - petLayout.characterWidth / 2,y:requested.y + petHeight - 35 - petLayout.characterHeight,width:petLayout.characterWidth,height:petLayout.characterHeight};
  const visible = screen.getAllDisplays().some(({bounds}) => Math.min(character.x + character.width,bounds.x + bounds.width) - Math.max(character.x,bounds.x) >= Math.min(16,character.width) && Math.min(character.y + character.height,bounds.y + bounds.height) - Math.max(character.y,bounds.y) >= Math.min(16,character.height));
  const x = Math.round(visible ? requested.x : area.x + area.width - petWidth - 24), y = Math.round(visible ? requested.y : area.y + area.height - petHeight - 24);
  const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true };
  pet = new BrowserWindow({ width: petWidth, height: petHeight, x, y, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: store.data.settings.alwaysOnTop, show: false, ...(process.platform === 'darwin' ? {type:'panel',acceptFirstMouse:true,hiddenInMissionControl:true,enableLargerThanScreen:true} : {}), webPreferences });
  petWindowBounds = pet.getBounds();
  petAnchor = {x:petWindowBounds.x + petWindowBounds.width / 2,y:petWindowBounds.y + petWindowBounds.height};
  pet.setAlwaysOnTop(store.data.settings.alwaysOnTop);
  pet.setIgnoreMouseEvents(true,{forward:true});
  panel = new BrowserWindow({ width: 430, height: Math.min(690, area.height - 24), frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: store.data.settings.alwaysOnTop, show: false, webPreferences });
  panel.on('focus',()=>{if(!(forcedDemo || store.data.settings.demo))void refreshModels(true).catch(()=>{});});
  for (const window of [pet, panel]) {
    if (process.platform !== 'win32') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    if (smoke || realSmoke) window.webContents.on('console-message', details => { if (details.level === 'error') console.error('RENDERER_ERROR', details.message); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on('did-finish-load', () => { window.catalogVersion = 0;window.messageView=null; publish(); });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  }
  pet.on('move', () => {
    if (petPositioning) return;
    const bounds = pet.getBounds();
    petAnchor.x += bounds.x - petWindowBounds.x; petAnchor.y += bounds.y - petWindowBounds.y; petWindowBounds = bounds;
    const width = Math.max(120,Math.ceil(petLayout.characterWidth + 16)), height = Math.ceil(petLayout.characterHeight + 48);
    store.data.settings.position = {x:petAnchor.x - width / 2,y:petAnchor.y - height,width,height};
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
    if (force) pet.showInactive();
  });
  for (const name of ['display-removed','display-metrics-changed']) screen.on(name, () => { if (!quitting) pet.emit('recover-position'); });
  pet.once('ready-to-show', () => pet.showInactive());
  await Promise.all([pet.loadFile(path.join(__dirname, 'ui/index.html'), { query: { surface: 'pet' } }), panel.loadFile(path.join(__dirname, 'ui/index.html'), { query: { surface: 'panel' } })]);
  petPointerTimer = setInterval(syncPetPointer,80);
  let image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.png' : 'tray.png'));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  else image = image.resize({width:32,height:32});
  tray = new Tray(image);
  if (process.platform === 'darwin') app.dock.hide();
  tray.setToolTip('옹기봇 · 바탕화면 친구');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '옹기봇과 대화', click: () => { pet.show(); showPanel(); } },
    { label: '캐릭터와 설정', click: () => { pet.show(); showPanel('settings'); } },
    { label: '옹기봇 보이기 / 숨기기', click: () => { if (pet.isVisible()) { pet.hide(); panel.hide(); } else pet.showInactive(); } },
    { label: '버디 위치 초기화', click: () => pet.emit('recover-position',true) },
    { type: 'separator' }, { label: '종료', click: () => app.quit() }
  ]));
  tray.on('click', () => { pet.show(); showPanel(); });
  store.shortcut = globalShortcut.register('CommandOrControl+Shift+Space', () => { pet.show(); showPanel(); });
  powerMonitor.on('suspend', () => { if (current) { current.cancelled = true; codex.stop(); finishJob('interrupted', 'PC가 절전 상태로 전환되어 연결을 종료했습니다.'); } });
  publish();
  if (petPointerSmoke) void require('../scripts/pet-pointer-smoke.cjs')({app,pet,screen,petAnchor,getIgnoring:()=>petIgnoringMouse});
  if (floatingSmoke) void require(process.argv.includes('--native-floating-review') ? '../scripts/native-floating-smoke.cjs' : '../scripts/floating-ui-smoke.cjs')({app,pet,panel,screen,store,getAnchor:()=>petAnchor,getIgnoring:()=>petIgnoringMouse,getDrag:()=>petDrag});
  if (modelSmoke) { showPanel(); setTimeout(() => require('../scripts/model-ui-smoke.cjs')({ app,panel,store,codex,modelCatalog }),700); }
  if(deleteSmoke){showPanel();setTimeout(()=>require('../scripts/deletion-ui-smoke.cjs')({app,panel,store,codex}),700);}
  if (historySmoke) { showPanel(); setTimeout(() => require('../scripts/history-ui-smoke.cjs')({ app,panel,store,codex }),700); }
  if (performanceSmoke) {showPanel();setTimeout(()=>require('../scripts/performance-ui-smoke.cjs')({app,panel,store,codex}),700);}
  if (timingSmoke) {showPanel();setTimeout(()=>require('../scripts/timing-ui-smoke.cjs')({app,panel,store,codex}),700);}
  if (smoke || realSmoke) {
    showPanel();
    setTimeout(async () => {
      try {
        if (smoke) {
          const petCheck = await pet.webContents.executeJavaScript(`(async()=>{
            const character=document.querySelector('#pet-character'),bubble=document.querySelector('#pet-bubble');
            const size={width:parseFloat(getComputedStyle(character).width),height:parseFloat(getComputedStyle(character).height)};
            for(let i=0;i<8;i++){await window.onggi.action('sync');await new Promise(r=>setTimeout(r,400));}
            const hiddenAfterIdle=bubble.hidden;
            character.dispatchEvent(new PointerEvent('pointerenter'));
            const visibleOnHover=!bubble.hidden;
            await new Promise(r=>setTimeout(r,3200));
            const hiddenAfterHover=bubble.hidden;
            await window.onggi.action('hide-panel');
            character.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));
            return {...size,hiddenAfterIdle,visibleOnHover,hiddenAfterHover};
          })()`);
          if(petCheck.width!==75||petCheck.height!==95||!petCheck.hiddenAfterIdle||!petCheck.visibleOnHover||!petCheck.hiddenAfterHover||!panel.isVisible())throw new Error('PET_SIZE_BUBBLE_FAILED '+JSON.stringify(petCheck));
          const compact = pet.getBounds();
          if(compact.width!==120||compact.height!==143)throw new Error('PET_COMPACT_WINDOW_FAILED '+JSON.stringify(compact));
          const hitCheck = await pet.webContents.executeJavaScript(`(async()=>{
            const blank=await window.onggi.action('pet-pointer-sync',{x:${compact.x+5},y:${compact.y+70}});
            const character=await window.onggi.action('pet-pointer-sync',{x:${compact.x+60},y:${compact.y+60}});
            return {blankPasses:blank.ignore,characterReceives:!character.ignore};
          })()`);
          if(!hitCheck.blankPasses||!hitCheck.characterReceives)throw new Error('PET_HIT_REGIONS_FAILED '+JSON.stringify(hitCheck));
          console.log('PET_NATIVE_HIT_REGIONS_OK',JSON.stringify(hitCheck));
          await pet.webContents.executeJavaScript(`(async()=>{await window.onggi.action('drag-start',{x:900,y:700});await window.onggi.action('drag-move',{x:860,y:670});await window.onggi.action('drag-move',{x:860,y:670});await window.onggi.action('drag-end');})()`);
          const moved = pet.getBounds();
          if(moved.x!==compact.x-40||moved.y!==compact.y-30)throw new Error('PET_ABSOLUTE_DRAG_FAILED '+JSON.stringify({compact,moved}));
          console.log('PET_COMPACT_ABSOLUTE_DRAG_OK',JSON.stringify({compact,moved}));
          fs.writeFileSync(path.join(__dirname,'..','artifacts','pet-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result:petCheck},null,2));
          console.log('PET_HALF_SIZE_AUTO_HIDE_OK',JSON.stringify(petCheck));
        }
        const result = await panel.webContents.executeJavaScript(`(async () => {
          document.querySelector('[data-tab="settings"]').click();
          document.querySelector('[data-character="onggi-sprout"]').click();
          await new Promise(r => setTimeout(r, 150));
          const switched = document.querySelector('[data-character="onggi-sprout"]').classList.contains('selected');
          document.querySelector('[data-character="onggi-clip"]').click();
          document.querySelector('[data-tab="chat"]').click();
          const input = document.querySelector('#prompt'); input.value = ${JSON.stringify(realSmoke ? '한국어로 짧게 답해줘. 내 캐릭터 이름은 옹기봇이야. 그 이름만 답해줘. 도구는 사용하지 마.' : '안녕 옹기봇!')};
          document.querySelector('#composer').requestSubmit();
          const deadline = Date.now() + 90000;
          do { await new Promise(r => setTimeout(r, 150)); } while (Date.now() < deadline && !document.querySelector('.message.assistant[data-status="completed"]') && !document.querySelector('.message.assistant[data-status="failed"]'));
          return { switched, text: document.querySelector('#messages').innerText, cards: document.querySelectorAll('.message').length, error: document.querySelector('#toast').textContent };
        })()`);
        fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
        if (realSmoke) {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline && !store.data.messages.find(m => m.role === 'assistant')?.timing?.renderedAt) await new Promise(r => setTimeout(r,30));
          const timing = store.data.messages.find(m => m.role === 'assistant')?.timing;
          if (!timing?.renderedAt || !(timing.firstReplyAt >= timing.cliSentAt && timing.completedAt >= timing.firstReplyAt)) throw new Error('Actual CLI response timing was not acknowledged');
          fs.writeFileSync(path.join(__dirname,'..','artifacts','real-response-timing.json'),JSON.stringify({verifiedAt:new Date().toISOString(),model:'gpt-5.6-luna',effort:'high',serviceTier:'default',timing},null,2));
        }
        fs.writeFileSync(path.join(__dirname, '..', 'artifacts', realSmoke ? 'alpha-real.png' : 'alpha-panel.png'), (await panel.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'alpha-pet.png'), (await pet.webContents.capturePage()).toPNG());
        if (!result.switched || !result.text.includes(realSmoke ? '옹기봇' : '체험 모드예요') || result.cards !== 2 || !store.data.messages.some(m => m.role === 'assistant' && m.status === 'completed')) throw new Error(JSON.stringify(result));
        if (!realSmoke) {
          const sample = '## Markdown 표시\n\n**굵게**와 *기울임*, `inline()`을 지원해요.\n\n**알파인 리눅스(Alpine Linux)**는 작은 배포판이에요.\n\n- 첫 번째\n- 두 번째\n\n> 작은 인용문\n\n| 기능 | 상태 |\n| --- | --- |\n| 표 | 완료 |\n\n```js\nconst onggi = "친구";\nconsole.log(onggi);\n```\n\n[공식 문서](https://learn.chatgpt.com/docs/app-server)\n\n<script>window.__onggiInjected = true</script>\n[나쁜 링크](javascript:alert(1))\n![외부 이미지](https://example.com/tracker.png)';
          store.data.messages.find(m => m.role === 'assistant').text = sample; publish();
          await new Promise(r => setTimeout(r, 150));
          const markdownCheck = await panel.webContents.executeJavaScript(`({ heading: Boolean(document.querySelector('.markdown-body h2')), bold: Boolean(document.querySelector('.markdown-body strong')), table: Boolean(document.querySelector('.markdown-table table')), code: document.querySelector('.markdown-body pre code')?.textContent, copy: Boolean(document.querySelector('.copy-code')), noScript: !document.querySelector('.markdown-body script') && !window.__onggiInjected, noUnsafeLink: ![...document.querySelectorAll('.markdown-body a')].some(a => !/^https?:/.test(a.getAttribute('href'))), noRemoteImage: !document.querySelector('.markdown-body img') })`);
          if (!markdownCheck.heading || !markdownCheck.bold || !markdownCheck.table || !markdownCheck.code.includes('const onggi') || !markdownCheck.copy || !markdownCheck.noScript || !markdownCheck.noUnsafeLink || !markdownCheck.noRemoteImage) throw new Error('MARKDOWN_CHECK_FAILED ' + JSON.stringify(markdownCheck));
          if (!(await panel.webContents.executeJavaScript(`[...document.querySelectorAll('.markdown-body strong')].some(e => e.textContent === '알파인 리눅스(Alpine Linux)')`))) throw new Error('KOREAN_EMPHASIS_FAILED');
          console.log('MARKDOWN_SECURITY_OK', JSON.stringify(markdownCheck));
          fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'alpha-markdown.png'), (await panel.webContents.capturePage()).toPNG());
          store.data.messages.find(m => m.role === 'assistant').text = '```js\nconst partial ='; publish();
          await new Promise(r => setTimeout(r, 100));
          if (!(await panel.webContents.executeJavaScript(`Boolean(document.querySelector('.markdown-body pre code')?.textContent.includes('const partial ='))`))) throw new Error('STREAMING_MARKDOWN_FAILED');
          await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="settings"]').click()`);
          await new Promise(r => setTimeout(r, 100));
          fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'alpha-settings.png'), (await panel.webContents.capturePage()).toPNG());
          await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="chat"]').click(); document.querySelector('#new-chat').click()`);
          await new Promise(r => setTimeout(r, 150));
          fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'alpha-welcome.png'), (await panel.webContents.capturePage()).toPNG());
          const layout = await panel.webContents.executeJavaScript(`({ scroll: window.scrollY, shellScroll: document.querySelector('.panel-shell').scrollTop, headerTop: document.querySelector('.header').getBoundingClientRect().top })`);
          if (layout.headerTop < 0 || layout.scroll || layout.shellScroll) throw new Error('LAYOUT_CHECK_FAILED ' + JSON.stringify(layout));
          const queueCheck = await panel.webContents.executeJavaScript(`(async () => {
            const first = await window.onggi.action('send', { text: '첫 번째 질문' });
            const second = await window.onggi.action('send', { text: '두 번째 질문' });
            const third = await window.onggi.action('send', { text: '세 번째 질문' });
            await window.onggi.action('cancel', { id: second.id });
            await new Promise(r => setTimeout(r, 130));
            document.querySelector('[data-tab="settings"]').click();
            document.querySelector('[data-character="onggi-sprout"]').click();
            document.querySelector('[data-tab="chat"]').click();
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline && !document.querySelector('.message.user[data-id="' + third.id + '"][data-status="running"]')) await new Promise(r => setTimeout(r, 50));
            const firstFinished = Boolean(document.querySelector('.message.user[data-id="' + first.id + '"][data-status="completed"]'));
            const secondCancelled = Boolean(document.querySelector('.message.user[data-id="' + second.id + '"][data-status="interrupted"]'));
            await window.onggi.action('cancel');
            await new Promise(r => setTimeout(r, 150));
            const thirdCancelled = Boolean(document.querySelector('.message.user[data-id="' + third.id + '"][data-status="interrupted"]'));
            return { firstFinished, secondCancelled, thirdCancelled };
          })()`);
          if (!Object.values(queueCheck).every(Boolean)) throw new Error('QUEUE_CHECK_FAILED ' + JSON.stringify(queueCheck));
          console.log('QUEUE_AND_HOT_SWAP_OK', JSON.stringify(queueCheck));
        }
        fs.writeFileSync(path.join(__dirname, '..', 'artifacts', realSmoke ? 'real-ui-smoke.json' : 'ui-smoke.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), status: 'passed', result }, null, 2));
        console.log(realSmoke ? 'REAL_UI_SMOKE_OK' : 'SMOKE_OK', JSON.stringify(result)); app.quit();
      } catch (error) { console.error('SMOKE_FAILED', error); codex.stop(); app.exit(1); }
    }, 700);
  }
}).catch(error => { console.error(error); codex.stop(); dialog.showErrorBox('옹기봇 시작 실패', error.message); app.exit(1); });

ipcMain.handle('action', async (event, action, payload = {}) => {
  if (quitting) return {ok:false};
  const owner=[pet,panel].find(w=>w&&!w.isDestroyed()&&w.webContents===event.sender);
  if (!owner || event.senderFrame!==event.sender.mainFrame) throw new Error('허용되지 않은 창입니다.');
  if (action === 'sync') { if(payload.includeCatalog!==false)owner.catalogVersion = 0; publish(); return { ok: true }; }
  if (action === 'load-older') {
    if(event.sender!==panel.webContents)throw new Error('대화창에서만 이전 내용을 불러올 수 있습니다.');
    let count=0,bytes=0;
    for(let i=store.data.messages.length-(panel.messageLimit??100)-1;i>=0&&count<100;i--){const size=Buffer.byteLength(store.data.messages[i].text);if(count&&bytes+size>256*1024)break;bytes+=size;count++;}
    panel.messageLimit=(panel.messageLimit??100)+count;panel.expandedHistory=true;publish(true);return{ok:true};
  }
  if (action === 'response-rendered') {
    if (event.sender !== panel.webContents) throw new Error('대화창에서만 화면 반영을 확인할 수 있습니다.');
    const reply = store.data.messages.find(m => m.id === payload.id && m.role === 'assistant');
    if (!reply?.timing?.completedAt || reply.timing.renderedAt !== undefined) return {ok:true};
    if (!Number.isFinite(payload.renderedAt) || Math.abs(payload.renderedAt - (performance.timeOrigin + performance.now())) > 60000) throw new Error('화면 반영 시각이 올바르지 않습니다.');
    reply.timing.renderedAt = Math.max(reply.timing.completedAt,payload.renderedAt);
    reply.timing.renderMs = reply.timing.renderedAt - reply.timing.completedAt;
    reply.timing.totalMs = reply.timing.submittedAt === null ? null : reply.timing.renderedAt - reply.timing.submittedAt;
    store.save(); publish(true); return {ok:true};
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
    const removedThreads=new Set();
    const onDeleted=message=>{if(message.method==='thread/deleted'&&typeof message.params?.threadId==='string')removedThreads.add(message.params.threadId);};
    try{
      store.beginDeletion(selected.id);
      if(selected.threadId){
        if(selected.codexPath!==store.data.settings.codexPath||selected.workspace!==store.data.settings.workspace)connection=new CodexConnection();
        connection.on('notification',onDeleted);
        await connection.connect(selected.codexPath||store.data.settings.codexPath,selected.workspace||store.data.settings.workspace);
        try{await connection.request('thread/delete',{threadId:selected.threadId});}
        catch(error){
          if(error.code!==-32600||error.message!==`no rollout found for thread id ${selected.threadId}`)throw error;
          let absent=false;
          try{await connection.request('thread/read',{threadId:selected.threadId,includeTurns:false});}
          catch(readError){absent=readError.code===-32600&&[`thread not loaded: ${selected.threadId}`,`no rollout found for thread id ${selected.threadId}`].includes(readError.message);if(!absent)throw readError;}
          if(!absent)throw error;
        }
        remoteDeleted=true;removedThreads.add(selected.threadId);
      }
      const deletedIds=store.data.conversations.filter(c=>c.id===selected.id||removedThreads.has(c.threadId)).map(c=>c.id);
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
      if (contextChanged) { codex.stop(); modelCatalog.models = []; modelsStatus = 'idle'; }
      if (selected.threadId && selected.mode === 'codex' && !forcedDemo) {
        try {
          await codex.connect(store.data.settings.codexPath, store.data.settings.workspace);
          const response = await codex.request('thread/read', { threadId: selected.threadId, includeTurns: true });
          const previous = store.data.messages, messages = [];
          let previousIndex = 0;
          for (const turn of response.thread.turns ?? []) {
            const input = turn.items?.filter(i => i.type === 'userMessage').flatMap(i => i.content ?? []).filter(i => i.type === 'text').map(i => i.text).join('\n');
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
            if (output || oldReply) messages.push({ ...oldReply, id: oldReply?.id ?? `${turn.id}:reply`, turnId: turn.id, role: 'assistant', text: output || oldReply?.text || '', mode: 'codex', status, createdAt: oldReply?.createdAt ?? Date.now() });
          }
          if (messages.length && messages.length >= previous.filter(m => !['failed','interrupted'].includes(m.status)).length) {
            const remoteUserIds = new Set(messages.filter(m => m.role === 'user').map(m => m.id));
            for (let i = 0; i < previous.length; i++) if (previous[i].role === 'user' && !remoteUserIds.has(previous[i].id)) { messages.push(previous[i]); if (previous[i + 1]?.role === 'assistant') messages.push(previous[++i]); }
            store.data.messages = messages; store.save();
          }
          connectionState = 'connected';
        } catch (error) { historyWarning = `저장된 기록을 표시합니다. Codex 기록 확인: ${error.message}`; }
      }
      return { ok: true };
    } finally { historyLoading = false; publish(); }
  }
  if (action === 'refresh-models') { if (forcedDemo || store.data.settings.demo) return {ok:true}; await refreshModels(Boolean(payload.ifStale)); return { ok: true }; }
  if (action === 'model-settings') {
    if (!modelCatalog.models.length) await refreshModels();
    const model = payload.model || null, effort = payload.effort || null;
    const serviceTier = payload.serviceTier ?? store.data.settings.serviceTier;
    if ((model !== null && typeof model !== 'string') || (effort !== null && typeof effort !== 'string')) throw new Error('모델 설정 형식이 올바르지 않습니다.');
    if (typeof serviceTier !== 'string') throw new Error('속도 설정 형식이 올바르지 않습니다.');
    modelCatalog.resolve(model, effort, serviceTier);
    store.data.settings.model = model; store.data.settings.effort = effort; store.data.settings.serviceTier = serviceTier; store.save({includeHistory:false}); publish(); return { ok: true };
  }
  if (action === 'pet-pointer-sync') {
    if (event.sender !== pet.webContents || ![payload.x,payload.y].every(n => Number.isFinite(n) && Math.abs(n) < 100000)) throw new Error('포인터 좌표가 올바르지 않습니다.');
    petPointerPosition = {x:payload.x,y:payload.y,at:Date.now()}; syncPetPointer(); return {ok:true,ignore:petIgnoringMouse};
  }
  if (action === 'pet-layout') {
    if (event.sender !== pet.webContents || typeof payload.bubbleVisible !== 'boolean' || typeof payload.controlsVisible !== 'boolean') throw new Error('캐릭터 창 상태가 올바르지 않습니다.');
    const pack = packs.find(p => p.manifest.id === store.data.settings.characterId);
    petLayout = { bubbleVisible: payload.bubbleVisible && !petDrag, controlsVisible: payload.controlsVisible, characterWidth: pack.manifest.size.width / 2, characterHeight: pack.manifest.size.height / 2 };
    const bounds = pet.getBounds(), width = petLayout.bubbleVisible ? 196 : Math.max(120,Math.ceil(petLayout.characterWidth + 16)), height = Math.ceil(petLayout.characterHeight + 48 + (petLayout.bubbleVisible ? 52 : 0));
    if (width !== bounds.width || height !== bounds.height) {
      const anchor = petAnchor;
      let x = Math.round(anchor.x - width / 2), y = Math.round(anchor.y - height);
      if (petLayout.bubbleVisible) {
        const area = screen.getDisplayNearestPoint({x:Math.round(anchor.x),y:Math.round(anchor.y - 35 - petLayout.characterHeight / 2)}).bounds;
        const intersects = anchor.x + petLayout.characterWidth / 2 > area.x && anchor.x - petLayout.characterWidth / 2 < area.x + area.width && anchor.y - 35 > area.y && anchor.y - 35 - petLayout.characterHeight < area.y + area.height;
        if (intersects) { x = Math.round(Math.max(area.x,Math.min(x,area.x + area.width - width))); y = Math.round(Math.max(area.y,Math.min(y,area.y + area.height - height))); }
      }
      petPositioning = true;
      try { pet.setBounds({x,y,width,height}); } finally { petPositioning = false; }
    }
    const updated = pet.getBounds();
    petWindowBounds = updated;
    const idleWidth = Math.max(120,Math.ceil(petLayout.characterWidth + 16)), idleHeight = Math.ceil(petLayout.characterHeight + 48);
    store.data.settings.position = {x:petAnchor.x - idleWidth / 2,y:petAnchor.y - idleHeight,width:idleWidth,height:idleHeight};
    return {ok:true,bounds:updated,centerX:petAnchor.x - updated.x,bottom:updated.y + updated.height - petAnchor.y + 35};
  }
  if (action === 'activity') { listening = Boolean(payload.listening); publish(); return { ok: true }; }
  if (action === 'show-panel') { showPanel(payload.tab); return { ok: true }; }
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
    store.data.settings.position = {x:moved.x,y:moved.y,width:moved.width,height:moved.height};
    return { ok: true };
  }
  if (action === 'sleep') { sleeping = !sleeping; publish(); return { ok: true }; }
  if (action === 'select-character') {
    if (!packs.some(p => p.manifest.id === payload.id)) throw new Error('캐릭터를 찾을 수 없습니다.');
    store.data.settings.characterId = payload.id; store.save({includeHistory:false}); publish(); return { ok: true };
  }
  if (action === 'import-pack') {
    const selected = await dialog.showOpenDialog(panel, { title: 'manifest.json이 있는 캐릭터 폴더 선택', properties: ['openDirectory'] });
    if (selected.canceled) return { ok: true };
    const loaded = loadPack(selected.filePaths[0]);
    if (packs.some(p => p.manifest.id === loaded.manifest.id)) throw new Error('이미 설치된 캐릭터 ID입니다.');
    const destination = path.join(store.directory, 'characters', loaded.manifest.id);
    fs.mkdirSync(destination, { recursive: true });
    try {
      fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(loaded.manifest, null, 2));
      for (const file of loaded.files) {
        const target = path.resolve(destination, file);
        if (!target.startsWith(destination + path.sep)) throw new Error('팩 파일 경로가 올바르지 않습니다.');
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.resolve(loaded.root, file), target);
      }
      packs.push(loadPack(destination)); catalogVersion++;
    } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
    store.data.settings.characterId = loaded.manifest.id; store.save({includeHistory:false}); publish(); return { ok: true };
  }
  if (action === 'pick-workspace' || action === 'pick-codex') {
    if (current || queue.length || modelRefresh || preparing || historyLoading) throw new Error('작업 또는 기록 조회 완료 후 설정을 변경해주세요.');
    const selection = await dialog.showOpenDialog(panel, { title: action === 'pick-workspace' ? 'Codex가 사용할 작업 폴더 선택' : 'Codex CLI 실행 파일 선택', properties: [action === 'pick-workspace' ? 'openDirectory' : 'openFile'] });
    if (!selection.canceled) {
      store.newConversation(); store.data.settings[action === 'pick-workspace' ? 'workspace' : 'codexPath'] = selection.filePaths[0];
      resumed = false; codex.stop(); modelCatalog.models = []; modelsStatus = 'idle'; modelsError = null; store.save({includeHistory:false}); publish();
    }
    return { ok: true };
  }
  if (action === 'settings') {
    if (typeof payload.demo === 'boolean' && payload.demo !== store.data.settings.demo) {
      if (current || queue.length || modelRefresh || preparing || historyLoading) throw new Error('작업 또는 기록 조회 완료 후 모드를 변경해주세요.');
      store.newConversation();panel.messageView=null; resumed = false;
      store.data.settings.demo = payload.demo;
      if (!payload.demo && modelsStatus === 'idle') void refreshModels().catch(() => {});
    }
    if (typeof payload.reducedMotion === 'boolean') store.data.settings.reducedMotion = payload.reducedMotion;
    if (typeof payload.measureResponseTime === 'boolean') store.data.settings.measureResponseTime = payload.measureResponseTime;
    if (typeof payload.alwaysOnTop === 'boolean') { store.data.settings.alwaysOnTop = payload.alwaysOnTop; pet.setAlwaysOnTop(payload.alwaysOnTop); panel.setAlwaysOnTop(payload.alwaysOnTop); }
    store.save({includeHistory:false}); publish(); return { ok: true };
  }
  if (action === 'new-chat') {
    if (current || queue.length || preparing || historyLoading) throw new Error('실행과 대기 작업을 먼저 완료하거나 취소해주세요.');
    store.newConversation();panel.messageView=null; resumed = false; historyWarning = null; publish(); return { ok: true };
  }
  if (action === 'send') {
    const receivedAt = performance.timeOrigin + performance.now(), measure = store.data.settings.measureResponseTime;
    if(store.pendingDeletion?.ids.includes(store.data.activeConversationId))throw new Error('현재 대화의 삭제 확인이 필요합니다. 이전 대화에서 삭제를 재시도하거나 새 대화를 시작해주세요.');
    if (store.writeBlocked) throw new Error('저장 복구가 필요합니다. 앱을 다시 실행하고 기록 폴더를 확인해주세요.');
    if (historyLoading) throw new Error('이전 대화를 불러오는 중입니다.');
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 8000) throw new Error('질문은 1~8,000자까지 입력할 수 있습니다.');
    if (queue.length >= 10) throw new Error('대기 요청은 최대 10개입니다.');
    const requestedModel = store.data.settings.model, requestedEffort = store.data.settings.effort, requestedTier = store.data.settings.serviceTier;
    const mode = forcedDemo || store.data.settings.demo ? 'demo' : 'codex';
    preparing++; publish();
    try { if (mode === 'codex') await refreshModels(true); }
    finally { preparing--; publish(); }
    if (queue.length >= 10) throw new Error('대기 요청은 최대 10개입니다.');
    const selection = mode === 'demo' ? { model: null, effort: null, modelName: '체험' } : modelCatalog.resolve(requestedModel, requestedEffort, requestedTier);
    const pendingReplies = store.data.messages.filter(m => m.role === 'assistant' && ['queued','running'].includes(m.status)).length;
    if (Buffer.byteLength(JSON.stringify(store.data.messages)) + 700000 * (pendingReplies + 1) > 32 * 1024 * 1024) throw new Error('대화 저장 용량이 한도에 가까워졌습니다. 진행 중인 질문을 마친 뒤 새 대화를 시작해주세요.');
    listening = false;
    const id = randomUUID(), replyId = randomUUID();
    const timing = measure ? { receivedAt, submittedAt:Number.isFinite(payload.submittedAt) && Math.abs(payload.submittedAt - receivedAt) < 60000 ? Math.min(payload.submittedAt,receivedAt) : null,enqueuedAt:performance.timeOrigin + performance.now(),mode } : undefined;
    store.data.messages.push({ id, role: 'user', text: payload.text, status: 'queued', createdAt: Date.now(), mode, ...selection }, { id: replyId, role: 'assistant', text: '', status: 'queued', createdAt: Date.now(), mode, ...selection,...(timing ? {timing} : {}) });
    try { store.save(); }
    catch(error) { store.data.messages.splice(-2);publish(true);throw error; }
    queue.push({ id, replyId, text: payload.text, selection, mode }); publish(); void runQueue(); return { ok: true, id };
  }
  if (action === 'cancel') {
    if (payload.id && current?.id !== payload.id) {
      const index = queue.findIndex(j => j.id === payload.id);
      if (index !== -1) {
        const [job] = queue.splice(index, 1);
        for (const id of [job.id,job.replyId]) store.data.messages.find(m => m.id === id).status = 'interrupted';
        const reply = store.data.messages.find(m => m.id === job.replyId);
        if (reply.timing) { const t=reply.timing;t.completedAt=performance.timeOrigin + performance.now();t.status='interrupted';t.inputMs=t.submittedAt===null?null:Math.max(0,t.receivedAt-t.submittedAt);t.queueMs=Math.max(0,t.completedAt-t.enqueuedAt); }
        store.save(); publish();
      }
    } else if (current) { current.cancelled = true; if (current.mode !== 'demo') await codex.interrupt(); publish(); }
    return { ok: true };
  }
  if (action === 'respond') {
    const request = requests.find(r => r.id === payload.id);
    if (!request || !current) throw new Error('이 요청은 더 이상 유효하지 않습니다.');
    let result;
    if (request.method === 'item/tool/requestUserInput') {
      const answers = {};
      for (const question of request.params.questions) {
        const value = payload.answers?.[question.id];
        if (typeof value !== 'string' || value.length > 8000) throw new Error('추가 질문에 답변해주세요.');
        answers[question.id] = { answers: [value] };
      }
      result = { answers };
    } else if (request.method === 'item/permissions/requestApproval') {
      result = { permissions: {}, scope: 'turn' };
    } else {
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
  if (action === 'open-data') { await shell.openPath(store.directory); return { ok: true }; }
  throw new Error('지원하지 않는 동작입니다.');
});
app.on('second-instance', () => { pet?.show(); if (!petPointerSmoke) showPanel(); });
app.on('activate', () => { pet?.show(); if (!petPointerSmoke) showPanel(); });
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true; clearInterval(petPointerTimer); globalShortcut.unregisterAll();
  if (store) { for (const message of store.data.messages) if (['queued','running'].includes(message.status)) message.status = 'interrupted'; try { store.save(); } catch(error) { console.error('종료 시 저장 실패:',error.message); } }
  codex.stop();
});
