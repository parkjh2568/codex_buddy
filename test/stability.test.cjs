const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { CodexConnection } = require('../src/codex.cjs');
const { Store } = require('../src/store.cjs');
const { ModelCatalog } = require('../src/models.cjs');

test('body search cancellation bypasses pending saves and discards results before reading history',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'search',role:'user',text:'needle',status:'completed'}];h.store.save();
  const original=fs.promises.stat;let entered,release;const started=new Promise(resolve=>{entered=resolve;});let calls=0;
  fs.promises.stat=async function(file,...args){if(file===path.join(h.store.historyDirectory,h.store.data.activeConversationId+'.json')){calls++;entered();await new Promise(resolve=>{release=resolve;});}return original.call(this,file,...args);};
  try{
    const searching=h.call('search-conversations',{query:'needle'});await started;h.store.saving=new Promise(()=>{});
    assert.equal((await h.call('cancel-search')).ok,true);h.store.saving=null;release();
    const result=await searching;assert.equal(result.canceled,true);assert.equal(result.matches.length,0);assert.equal(result.scanned,0);assert.equal(calls,1);
  }finally{h.store.saving=null;release?.();fs.promises.stat=original;}
});

function mainHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'onggi-stability-'));
  t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  let action, select;const handlers=new Map();
  const electron = {screen:{getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1200,height:900}}),getDisplayMatching:()=>({workArea:{x:0,y:0,width:1200,height:900}}),getCursorScreenPoint:()=>({x:700,y:300})},globalShortcut:{register:()=>true,unregister(){}},app:{isPackaged:true,setName(){},requestSingleInstanceLock:()=>true,whenReady:()=>new Promise(()=>{}),on(){}},ipcMain:{handle:(channel,handler)=>{handlers.set(channel,handler);if(channel==='action')action=handler;}},clipboard:{read:async()=>[]},dialog:{showOpenDialog:()=>new Promise(resolve=>{select=resolve;})},shell:{openPath:async()=>''}};
  const fromMain = createRequire(path.join(__dirname,'../src/main.cjs'));
  const timers = [];
  const context = vm.createContext({require:name=>name==='electron'?electron:fromMain(name),__dirname:path.join(__dirname,'../src'),process,console,Buffer,performance,structuredClone,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:id=>{if(timers[id-1])timers[id-1].cleared=true;},setInterval(){},clearInterval(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),context);
  const originalPublish=vm.runInContext('publish',context);
  const contents = {mainFrame:{},isDestroyed:()=>false}, panel = {webContents:contents,isDestroyed:()=>false,isVisible:()=>true,messageView:null,setAlwaysOnTop(){}};
  const pet = {webContents:{mainFrame:{},isDestroyed:()=>false},isDestroyed:()=>false,setAlwaysOnTop(){}};
  const notice = {webContents:{mainFrame:{},isDestroyed:()=>false},isDestroyed:()=>false,setAlwaysOnTop(){}};
  const store = new Store(root,{characterId:'onggi-clip',skinId:'paper',chatMode:'panel',demo:true,model:'old',effort:'high',serviceTier:'default',measureResponseTime:false,alwaysOnTop:true,personaModes:{},workspace:root,codexPath:'/codex'});
  fs.mkdirSync(path.join(root,'characters'));
  Object.assign(context,{testStore:store,testPanel:panel,testPet:pet,testNotice:notice});
  vm.runInContext("store=testStore;packLibrary=new PackLibrary(store.directory);panel=testPanel;pet=testPet;petNotice=testNotice;publish=()=>{};skins=[{id:'paper'},{id:'night'}];packs=[{manifest:{id:'onggi-clip'}},{manifest:{id:'next'}}];modelCatalog.models=[{model:'new',name:'New',efforts:[{value:'high'}],defaultEffort:'high',serviceTiers:[]}];codex.stop=()=>{};assetValidator.validate=async p=>p;",context);
  return {root,store,context,timers,electron,call:(name,payload,event={})=>action({sender:contents,senderFrame:contents.mainFrame,...event},name,payload),input:(payload,event={})=>handlers.get('attachment-input')({sender:contents,senderFrame:contents.mainFrame,...event},payload),select:value=>select(value),publish:()=>{originalPublish(true);timers.at(-1).fn();}};
}

test('malformed JSON objects and known event fields fail the connection without an uncaught exception', async t => {
  for (const frame of [null,[],{}, {method:'turn/started',params:{}}, {method:'item/completed',params:{}}, {method:'item/tool/requestUserInput',id:9,params:{questions:[null]}}]) {
    const bridge = new CodexConnection();t.after(()=>bridge.stop());
    await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname);
    await assert.rejects(bridge.request('test/emit',{frame}),/응답 형식/);
    assert.equal(bridge.pending.size,0);assert.equal(bridge.process,null);
  }
});

test('a stopped initialization cannot terminate its replacement connection', async t => {
  const bridge = new CodexConnection();t.after(()=>bridge.stop());
  const first = bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname).catch(error=>error.message);
  bridge.stop();await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname);
  assert.match(await first,/종료/);assert.ok(bridge.process);assert.equal(bridge.process.killed,false);
});

test('old and foreign turn events preserve the owned interrupt target in either RPC/event ordering',async t=>{
  const bridge=new CodexConnection();t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname);
  for(const beforeResponse of [true,false]){
    const {turn}=await bridge.request('turn/start',{threadId:'owned-thread',beforeResponse});
    await bridge.request('test/emit',{frame:{method:'turn/completed',params:{threadId:'foreign-thread',turn:{id:'previous-turn',status:'completed'}}}});
    await bridge.request('test/emit',{frame:{method:'turn/started',params:{threadId:'owned-thread',turn:{id:'previous-turn'}}}});
    assert.deepEqual(bridge.active,{threadId:'owned-thread',turnId:turn.id});
    assert.deepEqual(await bridge.request('turn/interrupt',bridge.active),bridge.active);
    await bridge.request('test/emit',{frame:{method:'turn/completed',params:{threadId:'owned-thread',turn:{id:turn.id,status:'interrupted'}}}});assert.equal(bridge.active,null);
  }
});

test('turn RPC identity filters earlier and later old starts while retaining an early completed answer',async t=>{
  const bridge=new CodexConnection();t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname);
  const events=[];bridge.on('notification',event=>events.push(event));
  const {turn}=await bridge.request('turn/start',{threadId:'owned-thread',beforeResponse:true,oldBeforeResponse:true,oldAfterResponse:true,earlyCompletion:true});
  await bridge.request('test/emit',{frame:{method:'thread/updated',params:{threadId:'owned-thread'}}});
  assert.ok(events.every(e=>(e.params.turnId??e.params.turn?.id??turn.id)===turn.id));
  assert.equal(events.find(e=>e.method==='item/agentMessage/delta').params.delta,'kept');assert.equal(bridge.active,null);assert.equal(bridge.turnContext.completed,true);
  const next=await bridge.request('turn/start',{threadId:'owned-thread',oldBeforeResponse:true,oldAfterResponse:true});
  await bridge.request('test/emit',{frame:{method:'thread/updated',params:{threadId:'owned-thread'}}});
  assert.deepEqual(bridge.active,{threadId:'owned-thread',turnId:next.turn.id});
});

test('early image payloads survive the control event limit while oversized control text still disconnects',async t=>{
  const bridge=new CodexConnection();t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname);
  const events=[];bridge.on('notification',event=>events.push(event));
  const {turn}=await bridge.request('turn/start',{threadId:'owned-thread',beforeResponse:true,earlyImageBytes:1024*1024});
  assert.equal(events.find(e=>e.method==='item/completed').params.item.result.length,1024*1024);assert.equal(bridge.turnContext.imageBytes,0);assert.equal(bridge.active.turnId,turn.id);
  await bridge.request('test/emit',{frame:{method:'turn/completed',params:{threadId:'owned-thread',turn:{id:turn.id,status:'completed'}}}});
  await assert.rejects(bridge.request('turn/start',{threadId:'owned-thread',beforeResponse:true,earlyControlBytes:300*1024}),/초기 턴 알림 한도/);assert.equal(bridge.process,null);assert.equal(bridge.pending.size,0);
});

test('cancelled queued jobs never resume after their terminal save fails',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'queued',status:'queued'},{id:'a',role:'assistant',text:'',status:'queued'}];
  vm.runInContext("queue=[{id:'u',replyId:'a'}];",h.context);h.store.saveAsync=async()=>{throw Error('disk full');};
  await assert.rejects(h.call('cancel',{id:'u'}),/disk full/);assert.equal(h.store.writeBlocked,true);assert.equal(vm.runInContext('queue.length',h.context),0);assert.equal(h.store.data.messages[1].status,'interrupted');
  await assert.rejects(h.call('send',{text:'must not run'}),/복구/);
});

test('pack recovery replaces its temporary same-ID placeholder and preserves the last valid pack',async t=>{
  const h=mainHarness(t);h.electron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(__dirname,'../characters/onggi-clip')]});
  vm.runInContext("packs=[{manifest:{id:'onggi-clip'},builtin:true,temporary:true}];",h.context);
  const preview=await h.call('pack-preview',{});await h.call('pack-apply',{token:preview.token,select:true});
  assert.equal(vm.runInContext('packs.length',h.context),1);assert.equal(vm.runInContext('packs[0].temporary',h.context),undefined);assert.equal(h.store.data.settings.characterId,'onggi-clip');
  await assert.rejects(h.call('pack-remove',{id:'onggi-clip',confirmed:true}),/하나 더/);assert.ok(fs.existsSync(path.join(h.root,'characters/onggi-clip/manifest.json')));
});

test('concurrent admissions reserve at most ten slots and commit in FIFO with captured names',async t=>{
  const h=mainHarness(t),{PersonaLibrary}=require('../src/personas.cjs'),{loadPack}=require('../src/packs.cjs');
  h.context.testPersonas=new PersonaLibrary(path.join(h.root,'personas'),[loadPack(path.join(__dirname,'../characters/onggi-clip'))]);
  h.store.data.settings.buddyName='before';h.store.data.settings.personaModes={'onggi-clip':'friendly'};
  vm.runInContext("personaLibrary=testPersonas;current={id:'held'};",h.context);
  const requests=Array.from({length:12},(_,i)=>h.call('send',{text:'request-'+i}));const settled=Promise.allSettled(requests);
  h.store.data.settings.buddyName='after';const results=await settled;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,10);assert.equal(results.filter(r=>r.status==='rejected').length,2);
  assert.equal(vm.runInContext('preparing',h.context),0);assert.deepEqual(Array.from(vm.runInContext('queue.map(j=>j.text)',h.context)),Array.from({length:10},(_,i)=>'request-'+i));
  assert.ok(vm.runInContext("queue.every(j=>j.buddyName==='before')",h.context));assert.equal(new Store(h.root,{}).data.messages.length,20);
});

test('cancel reaches the owned turn while storage is still pending',async t=>{
  const h=mainHarness(t);let release,called=false;h.store.saving=new Promise(r=>{release=r;});
  h.context.interrupted=async target=>{assert.equal(target.turnId,'own-turn');called=true;};h.store.data.messages=[{id:'u',role:'user',text:'keep',status:'running'},{id:'a',role:'assistant',text:'partial',status:'running'}];
  vm.runInContext("current={id:'u',replyId:'a',mode:'codex',threadId:'owned',turnId:'own-turn'};codex.interrupt=interrupted;",h.context);
  await h.call('cancel',{});assert.ok(called);release();h.store.saving=null;
});

test('terminal persistence runs once and rejects late answer/completion changes during a deferred write',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'question',status:'running'},{id:'a',role:'assistant',text:'partial',status:'running'}];
  let release,writes=0;const pending=new Promise(resolve=>{release=resolve;}),save=h.store.saveAsync.bind(h.store);h.store.saveAsync=()=>{writes++;return pending.then(()=>save());};
  vm.runInContext("current={id:'u',replyId:'a',turnId:'owned'};",h.context);
  const first=vm.runInContext("finishJob('interrupted','cancelled')",h.context),second=vm.runInContext("finishJob('completed')",h.context);
  vm.runInContext("codex.emit('notification',{method:'item/agentMessage/delta',params:{turnId:'owned',itemId:'late',delta:'must not replace'}});codex.emit('notification',{method:'turn/completed',params:{turn:{id:'owned',status:'completed'}}});",h.context);
  release();await Promise.all([first,second]);assert.equal(writes,1);assert.equal(h.store.data.messages[1].status,'interrupted');assert.equal(h.store.data.messages[1].text,'partial');
  const persisted=new Store(h.root,{});assert.equal(persisted.data.messages[1].status,'interrupted');assert.equal(persisted.data.messages[1].error,'cancelled');
});

test('admission failure rolls back its IDs and the following reservation remains usable',async t=>{
  const h=mainHarness(t),{PersonaLibrary}=require('../src/personas.cjs'),{loadPack}=require('../src/packs.cjs');h.context.testPersonas=new PersonaLibrary(path.join(h.root,'personas'),[loadPack(path.join(__dirname,'../characters/onggi-clip'))]);h.store.data.settings.personaModes={'onggi-clip':'friendly'};
  vm.runInContext("personaLibrary=testPersonas;current={id:'held'};",h.context);let count=0;const original=h.store.saveAsync.bind(h.store);h.store.saveAsync=()=>++count===1?Promise.reject(Error('disk full')):original();
  const results=await Promise.allSettled([h.call('send',{text:'failed'}),h.call('send',{text:'kept'})]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(h.store.data.messages.length,2);assert.equal(h.store.data.messages[0].text,'kept');assert.equal(vm.runInContext('preparing',h.context),0);
});

test('model pagination has a total cap and preserves the previous catalog after malformed input', async () => {
  let calls=0;
  const catalog = new ModelCatalog({request:async()=>({data:[],nextCursor:'page-'+(++calls)})});
  catalog.models=[{model:'previous'}];await assert.rejects(catalog.refresh('/tmp'),/한도/);assert.equal(calls,20);assert.equal(catalog.models[0].model,'previous');
  catalog.connection={request:async()=>({data:[null]})};await assert.rejects(catalog.refresh('/tmp'),/정보/);assert.equal(catalog.models[0].model,'previous');
});

test('failed settings, model and character saves restore all changed fields and window effects', async t => {
  const h=mainHarness(t),before={...h.store.data.settings};let nativeChanges=0;
  h.context.testPet.setAlwaysOnTop=()=>nativeChanges++;
  h.store.save=()=>{throw Error('disk full');};
  for(const [action,payload] of [['settings',{skinId:'night',measureResponseTime:true,alwaysOnTop:false}],['model-settings',{model:'new',effort:'high'}],['select-character',{id:'next'}]]) {
    await assert.rejects(h.call(action,payload),/disk full/);assert.deepEqual(h.store.data.settings,before);
  }
  assert.equal(nativeChanges,0);
  vm.runInContext("current={id:'running'};",h.context);
  await assert.rejects(h.call('settings',{demo:false,skinId:'night'}),/진행|작업/);assert.deepEqual(h.store.data.settings,before);
});

test('render acknowledgement retries persist after a transient save failure', async t => {
  const h=mainHarness(t),completed=performance.timeOrigin+performance.now()-10;
  h.store.data.messages=[{id:'reply',role:'assistant',text:'done',status:'completed',timing:{completedAt:completed,submittedAt:completed-100}}];let saves=0;
  h.store.saveAsync=async()=>{if(++saves===1)throw Error('disk full');};
  h.context.testPanel.isVisible=()=>false;
  assert.equal((await h.call('response-rendered',{id:'reply',renderedAt:performance.timeOrigin+performance.now()})).ok,false);
  assert.equal(saves,0);assert.equal(h.store.data.messages[0].timing.renderedAt,undefined);
  h.context.testPanel.isVisible=()=>true;
  vm.runInContext('screenLocked=true;',h.context);assert.equal((await h.call('response-rendered',{id:'reply',renderedAt:performance.timeOrigin+performance.now()})).ok,false);assert.equal(saves,0);vm.runInContext('screenLocked=false;',h.context);
  await assert.rejects(h.call('response-rendered',{id:'reply',renderedAt:performance.timeOrigin+performance.now()}),/disk full/);
  assert.equal(h.store.data.messages[0].timing.renderedAt,undefined);
  await h.call('response-rendered',{id:'reply',renderedAt:performance.timeOrigin+performance.now()});assert.equal(saves,2);assert.ok(h.store.data.messages[0].timing.renderedAt);
});

test('a context picker locks sends and rejects a late busy transition', async t => {
  const h=mainHarness(t),before=h.store.data.settings.workspace;
  const picking=h.call('pick-workspace',{});
  await assert.rejects(h.call('send',{text:'while picker is open'}),/불러오는/);
  vm.runInContext("current={id:'running'};",h.context);h.select({canceled:false,filePaths:[h.root]});
  await assert.rejects(picking,/진행/);assert.equal(h.store.data.settings.workspace,before);assert.equal(vm.runInContext('historyLoading',h.context),false);
});

test('context switching commits settings with the new conversation or restores both', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{workspace:'/before',demo:true});store.data.messages=[{id:'u',role:'user',text:'keep',status:'completed'}];store.save();const id=store.data.activeConversationId;
  const original=fs.renameSync;let count=0;
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===store.file&&++count===2)throw Error('context failure');return original(from,to);});
  assert.throws(()=>store.newConversation({settings:{...store.data.settings,workspace:'/after'}}),/failure/);assert.equal(store.data.activeConversationId,id);assert.equal(store.data.settings.workspace,'/before');
  t.mock.restoreAll();store.newConversation({settings:{...store.data.settings,workspace:'/after'}});const reloaded=new Store(root,{});assert.equal(reloaded.data.settings.workspace,'/after');assert.equal(reloaded.data.activeConversationId,null);
});

test('cancel timeout finishes the current job rather than leaving it running', async t => {
  const h=mainHarness(t);let stopped=0;
  h.store.data.messages=[{id:'u',role:'user',text:'question',status:'running'},{id:'a',role:'assistant',text:'partial',status:'running'}];h.store.saveAsync=async()=>{};
  h.context.stopObserved=()=>stopped++;
  vm.runInContext("current={id:'u',replyId:'a',turnId:'own-turn',mode:'codex',cancelled:false};codex.stop=stopObserved;codex.interrupt=async()=>{throw Error('turn/interrupt timeout');};",h.context);
  assert.equal((await h.call('cancel',{})).connectionStopped,true);assert.equal(stopped,1);assert.equal(h.store.data.messages[1].status,'interrupted');assert.match(h.store.data.messages[1].error,/중단 확인/);
});

test('invalid settings and dates are normalized, duplicate messages are excluded, long text stays intact', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-normalize-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true,workspace:'/valid',alwaysOnTop:true});store.data.messages=[{id:'a',role:'assistant',text:'a'.repeat(120000),status:'completed'}];store.save();const state=JSON.parse(fs.readFileSync(store.file));
  Object.assign(state.settings,{workspace:42,alwaysOnTop:'wrong',position:{x:1,y:1,width:'wrong'}});state.conversations[0].updatedAt='bad';fs.writeFileSync(store.file,JSON.stringify(state));
  const file=path.join(store.historyDirectory,store.data.activeConversationId+'.json'),history=JSON.parse(fs.readFileSync(file));history.messages.push(history.messages[0]);fs.writeFileSync(file,JSON.stringify(history));
  const reloaded=new Store(root,{workspace:'/valid',alwaysOnTop:true});assert.equal(reloaded.data.settings.workspace,'/valid');assert.equal(reloaded.data.settings.alwaysOnTop,true);assert.equal(reloaded.data.settings.position,null);assert.ok(Number.isFinite(reloaded.data.conversations[0].updatedAt));assert.equal(reloaded.data.messages.length,1);assert.equal(reloaded.data.messages[0].text.length,120000);reloaded.save();assert.equal(JSON.parse(fs.readFileSync(file)).messages[0].text.length,120000);
});

test('a failed persona setup leaves no imported pack in memory and permits a retry', async t => {
  const h=mainHarness(t),source=path.join(h.root,'source');fs.cpSync(path.join(__dirname,'../characters/onggi-sprout'),source,{recursive:true});
  fs.mkdirSync(path.join(h.root,'personas'));fs.mkdirSync(path.join(h.root,'target'));fs.symlinkSync(path.join(h.root,'target'),path.join(h.root,'personas/onggi-sprout'));
  const first=h.call('pack-preview',{});h.select({canceled:false,filePaths:[source]});const preview=await first;
  assert.equal(fs.existsSync(path.join(h.root,'characters/onggi-sprout')),false);assert.equal(h.store.data.settings.characterId,'onggi-clip');
  await assert.rejects(h.call('pack-apply',{token:preview.token,select:true}),/심볼릭/);
  assert.equal(vm.runInContext("packs.some(p=>p.manifest.id==='onggi-sprout')",h.context),false);assert.equal(fs.existsSync(path.join(h.root,'characters/onggi-sprout')),false);
  assert.equal(h.store.data.settings.characterId,'onggi-clip');assert.equal(vm.runInContext('packImporting',h.context),false);
  fs.unlinkSync(path.join(h.root,'personas/onggi-sprout'));await h.call('pack-apply',{token:preview.token,select:true});assert.equal(h.store.data.settings.characterId,'onggi-sprout');
});

test('descendant deletion scope survives missing late notifications and cleanup confirmation failure', async t => {
  const h=mainHarness(t);h.store.data.messages=[{id:'parent-user',role:'user',text:'parent',status:'completed'}];h.store.data.threadId='parent-thread';h.store.save();const parent=h.store.data.activeConversationId;
  h.store.newConversation();h.store.data.messages=[{id:'child-user',role:'user',text:'child',status:'completed'}];h.store.data.threadId='child-thread';h.store.save();const child=h.store.data.activeConversationId;
  let deleted=false,failConfirmation=true;
  h.context.fakeRequest=async(method,params)=>{
    if(method==='thread/delete'){deleted=true;return{};}
    if(deleted){const e=Error(failConfirmation&&params.threadId==='child-thread'?'temporary transport error':'thread not loaded: '+params.threadId);if(!failConfirmation||params.threadId!=='child-thread')e.code=-32600;throw e;}
    return{thread:{id:params.threadId,parentThreadId:params.threadId==='child-thread'?'parent-thread':null}};
  };
  vm.runInContext('codex.connect=async()=>true;codex.request=fakeRequest;',h.context);
  await assert.rejects(h.call('delete-conversation',{id:parent,confirmed:true}),/로컬 정리/);assert.ok(h.store.pendingDeletion.ids.includes(child));assert.equal(h.store.data.conversations.length,2);
  failConfirmation=false;await h.call('delete-conversation',{id:parent,confirmed:true});assert.equal(h.store.data.conversations.length,0);assert.equal(h.store.pendingDeletion,null);
});

test('async history storage serializes concurrent callers and keeps event-loop heartbeats alive', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-worker-save-'));
  const store=new Store(root,{demo:true});t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  store.data.messages=Array.from({length:180},(_,i)=>({id:'large-'+i,role:i%2?'assistant':'user',text:'a'.repeat(90000),status:'completed'}));
  let ticks=0;const timer=setInterval(()=>ticks++,2);
  try{await Promise.all([store.saveAsync(),store.saveAsync(),store.saveAsync()]);}finally{clearInterval(timer);}
  assert.ok(ticks>5);assert.equal(store.saving,null);const saved=new Store(root,{});assert.equal(saved.data.messages.length,180);assert.equal(saved.data.conversations.length,1);
  store.data.settings.skinId='night';store.save({includeHistory:false});await store.saveAsync();assert.equal(new Store(root,{}).data.settings.skinId,'night');
});

test('async storage failure admits no missing-history registration and allows a safe retry', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-worker-error-'));
  const store=new Store(root,{demo:true});t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  await store.saveAsync();store.data.messages=[{id:'u',role:'user',text:'keep',status:'queued'}];fs.mkdirSync(store.file+'.tmp');
  await assert.rejects(store.saveAsync(),/directory|EISDIR/);assert.equal(store.data.activeConversationId,null);assert.equal(store.data.conversations.length,0);
  fs.rmSync(store.file+'.tmp',{recursive:true});await store.saveAsync();assert.equal(new Store(root,{}).data.messages[0].text,'keep');
});

test('Store blocks existing staged/final links and preserves their external targets in sync and worker paths',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-store-links-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const asyncSave of [false,true])for(const name of ['state.json.tmp','state.json','save-journal.json','delete-journal.json']){
    const label=(asyncSave?'worker':'sync')+'-'+name,directory=path.join(root,label),store=new Store(directory,{demo:true}),outside=path.join(root,label+'-outside');await store.saveAsync();await store.closeWorker();
    const target=path.join(store.directory,name);if(fs.existsSync(target))fs.unlinkSync(target);fs.writeFileSync(outside,'preserve');fs.symlinkSync(outside,target);
    if(asyncSave){await assert.rejects(store.saveAsync(),/복구|경로/);await store.closeWorker();}else assert.throws(()=>store.save({includeHistory:false}),/경로/);
    assert.equal(fs.readFileSync(outside,'utf8'),'preserve');assert.ok(fs.lstatSync(target).isSymbolicLink());assert.equal(new Store(directory,{}).writeBlocked,true);
  }
});

test('deletion excludes matching thread IDs in another connection context',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'one',status:'completed'}];h.store.data.threadId='same-thread';h.store.save();const selected=h.store.data.activeConversationId;
  h.store.newConversation({settings:{...h.store.data.settings,workspace:'/another'}});h.store.data.threadId='same-thread';h.store.data.messages=[{id:'v',role:'user',text:'other',status:'completed'}];h.store.save();const retained=h.store.data.activeConversationId;
  t.mock.method(CodexConnection.prototype,'connect',async()=>true);t.mock.method(CodexConnection.prototype,'request',async method=>{if(method==='thread/read')throw Object.assign(Error('thread not loaded: same-thread'),{code:-32600});return{};});
  await h.call('delete-conversation',{id:selected,confirmed:true});assert.equal(h.store.data.conversations.length,1);assert.equal(h.store.data.activeConversationId,retained);assert.equal(h.store.data.messages[0].text,'other');
});

test('stdin failures reject pending RPCs and clear the connection', async t => {
  const bridge=new CodexConnection();t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),__dirname);
  const pending=bridge.request('test/no-response',{});bridge.process.stdin.emit('error',Error('test broken pipe'));
  await assert.rejects(pending,/입력 연결/);assert.equal(bridge.process,null);assert.equal(bridge.pending.size,0);
});

test('cancel acknowledgement without a completion event has a bounded watchdog', async t => {
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'question',status:'running'},{id:'a',role:'assistant',text:'partial',status:'running'}];h.store.saveAsync=async()=>{};
  vm.runInContext("current={id:'u',replyId:'a',turnId:'turn',mode:'codex'};codex.interrupt=async()=>({});",h.context);
  await h.call('cancel',{});const watchdog=h.timers.find(timer=>timer.ms===5000);assert.ok(watchdog);await watchdog.fn();assert.equal(h.store.data.messages[1].status,'interrupted');
});

test('streamed answer items and tools have aggregate bounds and an explicit truncation marker', t => {
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'question',status:'running'},{id:'a',role:'assistant',text:'',status:'running'}];
  vm.runInContext("current={id:'u',replyId:'a'};for(let i=0;i<200;i++){codex.emit('notification',{method:'item/agentMessage/delta',params:{itemId:'item-'+i,delta:'a'.repeat(7000)}});codex.emit('notification',{method:'item/started',params:{item:{id:'tool-'+i,type:'commandExecution'}}});}",h.context);
  assert.ok(h.store.data.messages[1].text.length<=100000);assert.equal(h.store.data.messages[1].textTruncated,true);assert.ok(vm.runInContext('current.items.size<=128&&current.toolItems.size<=128&&current.itemCharacters<=100000',h.context));
});

test('unexpected worker termination blocks writes until recovery', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-worker-exit-'));const store=new Store(root,{demo:true});t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  store.data.messages=[{id:'u',role:'user',text:'keep',status:'queued'}];const pending=store.saveAsync();const rejected=assert.rejects(pending,/프로세스/);await store.worker.terminate();await rejected;assert.equal(store.writeBlocked,true);assert.equal(store.saving,null);await assert.rejects(store.saveAsync(),/복구/);
});

test('Windows launch options keep arguments separate, hide consoles and reject shell launchers', async () => {
  const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),calls=[];
  const fromCodex=createRequire(path.join(__dirname,'../src/codex.cjs'));
  const context=vm.createContext({require:name=>name==='node:child_process'?{spawn:(executable,args,options)=>{
    calls.push({executable,args,options});const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new EventEmitter();child.stdin.writable=true;
    child.stdin.write=value=>{const message=JSON.parse(value);if(message.method==='initialize')child.stdout.write(JSON.stringify({id:message.id,result:{}})+'\n');};child.kill=()=>{};return child;
  }}:fromCodex(name),module:{exports:{}},process:{platform:'win32',execPath:'/node.exe',versions:{}},Buffer,performance,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/codex.cjs'),'utf8'),context);
  const bridge=new context.module.exports.CodexConnection();await bridge.connect(path.join(__dirname,'fixtures/protocol-codex.cjs'),'C:\\한국 공백 폴더');bridge.stop();
  assert.equal(calls[0].executable,'/node.exe');assert.equal(calls[0].args[0],path.join(__dirname,'fixtures/protocol-codex.cjs'));assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[0].options.cwd,'C:\\한국 공백 폴더');
  await assert.rejects(bridge.connect('C:\\codex.cmd','C:\\workspace'),/네이티브/);assert.equal(calls.length,1);
});

test('oversized approval metadata is bounded and incomplete previews cannot be approved', async t => {
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'question',status:'running'},{id:'a',role:'assistant',text:'',status:'running'}];
  h.context.responses=[];vm.runInContext("current={id:'u',replyId:'a'};showPanel=()=>{};codex.write=message=>responses.push(message);codex.respond=(id,result)=>responses.push({id,result});codex.emit('notification',{method:'item/started',params:{item:{id:'large-tool',type:'fileChange',changes:[{diff:'a'.repeat(200000)}]}}});codex.emit('request',{id:90,method:'item/fileChange/requestApproval',params:{itemId:'large-tool'}});",h.context);
  assert.equal(vm.runInContext("current.toolItems.get('large-tool').truncated",h.context),true);
  await assert.rejects(h.call('respond',{id:90,decision:'accept'}),/미리보기/);await h.call('respond',{id:90,decision:'decline'});
  vm.runInContext("codex.emit('request',{id:91,method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'a'.repeat(300000)}]}});",h.context);
  assert.equal(vm.runInContext('requests.length',h.context),0);assert.equal(h.context.responses.at(-1).error.code,-32000);
});

test('missing file previews and malformed network context cannot be accepted; folder errors are explicit',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'question',status:'running'},{id:'a',role:'assistant',text:'',status:'running'}];let sent=0;h.context.observeResponse=()=>sent++;
  vm.runInContext("current={id:'u',replyId:'a',turnId:'owned'};showPanel=()=>{};codex.respond=observeResponse;codex.emit('request',{id:'file',method:'item/fileChange/requestApproval',params:{turnId:'owned'}});",h.context);
  await assert.rejects(h.call('respond',{id:'file',decision:'accept'}),/미리보기/);await h.call('respond',{id:'file',decision:'decline'});assert.equal(sent,1);
  vm.runInContext("codex.emit('request',{id:'network',method:'item/commandExecution/requestApproval',params:{turnId:'owned',networkApprovalContext:{host:'',protocol:'https'}}});",h.context);await assert.rejects(h.call('respond',{id:'network',decision:'accept'}),/네트워크/);
  vm.runInContext("codex.emit('request',{id:'false-network',method:'item/commandExecution/requestApproval',params:{turnId:'owned',networkApprovalContext:false}});",h.context);await assert.rejects(h.call('respond',{id:'false-network',decision:'accept'}),/네트워크/);
  h.electron.shell.openPath=async()=> 'OS folder error';await assert.rejects(h.call('open-data',{}),/OS folder error/);
});

test('invalid remote thread and failed remote merge keep the previous local messages',async t=>{
  for(const failure of ['identity','save']){
    const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.messages=[{id:'local',role:'user',text:'keep',mode:'codex',status:'completed'}];h.store.data.threadId='owned-thread';h.store.save();const id=h.store.data.activeConversationId;
    const turns=[{id:'turn',itemsView:'full',status:'completed',items:[{type:'userMessage',id:'local',content:[{type:'text',text:'keep'}]},{type:'agentMessage',text:'remote answer'}]}];let commits=0;
    h.context.fakeRead=async method=>method==='thread/read'?{thread:{id:failure==='identity'?'foreign-thread':'owned-thread',turns}}:{data:turns,nextCursor:null};vm.runInContext('codex.connect=async()=>true;codex.request=fakeRead;',h.context);
    if(failure==='save')h.store.saveAsync=async()=>{commits++;throw Error('disk full');};
    await h.call('open-conversation',{id});assert.equal(h.store.data.messages.length,1);assert.equal(h.store.data.messages[0].text,'keep');assert.match(vm.runInContext('historyWarning',h.context),/저장된 기록/);
    if(failure==='save'){assert.equal(commits,1);assert.match(vm.runInContext('historyWarning',h.context),/disk full/);}
  }
});

test('paged history deduplicates overlapping turns and preserves locally captured question metadata',async t=>{
  const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';
  h.store.data.messages=Array.from({length:3},(_,i)=>[{id:'local-u-'+i,turnId:'turn-'+i,role:'user',text:'repeat',mode:'codex',status:'completed',purpose:'plan'},{id:'local-a-'+i,turnId:'turn-'+i,role:'assistant',text:'old '+i,mode:'codex',status:'completed'}]).flat();h.store.save();const id=h.store.data.activeConversationId,seen=[];
  const turns=Array.from({length:3},(_,i)=>({id:'turn-'+i,itemsView:'full',status:'completed',items:[{type:'userMessage',id:'local-u-'+i,content:[{type:'text',text:'internal wrapper'}]},{type:'agentMessage',text:'new '+i}]}));
  h.context.readPage=async(method,params)=>{
    seen.push({method,params});if(method==='thread/read')return{thread:{id:'owned-thread',turns:[]}};
    return params.cursor?{data:turns.slice(0,2).reverse(),nextCursor:null}:{data:turns.slice(1).reverse(),nextCursor:'opaque-next'};
  };vm.runInContext('codex.connect=async()=>true;codex.request=readPage;',h.context);
  await h.call('open-conversation',{id});assert.equal(h.store.data.messages.length,6);
  assert.deepEqual(Array.from(h.store.data.messages.filter(item=>item.role==='assistant'),item=>item.text),['old 0','new 1','new 2']);
  assert.equal(seen.length,2);assert.equal(seen[1].params.sortDirection,'desc');
  await h.call('load-older',{});
  assert.deepEqual(Array.from(h.store.data.messages.filter(item=>item.role==='user'),item=>item.text),['repeat','repeat','repeat']);
  assert.deepEqual(Array.from(h.store.data.messages.filter(item=>item.role==='assistant'),item=>item.text),['new 0','new 1','new 2']);
  assert.equal(h.store.data.messages[0].purpose,'plan');assert.equal(h.store.data.messages[0].id,'local-u-0');
  assert.equal(seen[0].params.includeTurns,false);assert.equal(seen[1].params.itemsView,'full');assert.equal(seen[2].params.cursor,'opaque-next');
  assert.equal(new Store(h.root,{}).data.messages.length,6);
});

test('incomplete, cyclic, failed or stale pages preserve the full local history without a full-read retry',async t=>{
  for(const failure of ['summary','cursor','timeout','connection','metadata-connection']){
    const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';h.store.data.messages=[{id:'local',role:'user',text:'preserve local history',mode:'codex',status:'completed'}];h.store.save();const id=h.store.data.activeConversationId;let pages=0,fullReads=0;
    h.context.readPage=async(method,params)=>{
      if(method==='thread/read'){if(params.includeTurns)fullReads++;if(failure==='metadata-connection')vm.runInContext('codex.process={};',h.context);return{thread:{id:'owned-thread',turns:[]}};}
      pages++;if(failure==='timeout'&&pages===2)throw Error('page timeout');
      if(failure==='connection')vm.runInContext('codex.process={};',h.context);
      return{data:[{id:'remote-turn',status:'completed',itemsView:failure==='summary'?'summary':'full',items:[{type:'userMessage',id:'local',content:[{type:'text',text:'preserve local history'}]},{type:'agentMessage',text:'partial remote'}]}],nextCursor:failure==='cursor'||failure==='timeout'?'repeated-cursor':null};
    };vm.runInContext('codex.connect=async()=>true;codex.request=readPage;',h.context);
    await h.call('open-conversation',{id});
    if(failure==='cursor'||failure==='timeout'){
      const committed=JSON.stringify(h.store.data.messages);assert.equal(h.store.data.messages.length,2,failure);assert.equal(pages,1);
      await h.call('load-older',{});assert.equal(JSON.stringify(h.store.data.messages),committed,failure);assert.equal(vm.runInContext('remoteHistory.cursor',h.context),'repeated-cursor');
    }else assert.equal(h.store.data.messages.length,1,failure);
    assert.equal(h.store.data.messages[0].text,'preserve local history');assert.match(vm.runInContext('historyWarning',h.context),/저장된 기록/);assert.equal(fullReads,0);if(failure==='metadata-connection')assert.equal(pages,0);
  }
});

test('ambiguous history identity and oversized merged pages fail before committing local records',async t=>{
  for(const failure of ['identity','quota']){
    const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';h.store.data.messages=[{id:'local-one',turnId:'turn-one',role:'user',text:'keep one',mode:'codex',status:'completed'},{id:'local-two',turnId:'turn-two',role:'user',text:'keep two',mode:'codex',status:'completed'}];h.store.save();const id=h.store.data.activeConversationId;let commits=0;
    const turns=failure==='identity'?[{id:'turn-one',itemsView:'full',status:'completed',items:[{type:'userMessage',id:'local-two',content:[{type:'text',text:'remote wrapper'}]}]}]:Array.from({length:12},(_,i)=>({id:'huge-'+i,itemsView:'full',status:'completed',items:[{type:'userMessage',id:'huge-user-'+i,content:[{type:'text',text:'\u0000'.repeat(500000)}]}]}));
    h.context.readPage=async method=>method==='thread/read'?{thread:{id:'owned-thread'}}:{data:turns,nextCursor:null};vm.runInContext('codex.connect=async()=>true;codex.request=readPage;',h.context);h.store.saveAsync=async()=>{commits++;};
    await h.call('open-conversation',{id});assert.equal(commits,0);assert.equal(h.store.data.messages.length,2);assert.equal(h.store.data.messages[0].text,'keep one');assert.match(vm.runInContext('historyWarning',h.context),failure==='identity'?/연결이 일치/:/저장 용량/);
  }
});

test('large remote history preserves stored IDs, repeated questions and purpose metadata',async t=>{
  const h=mainHarness(t),count=process.env.ONGGI_HISTORY_COST_REVIEW==='1'?5000:30,samples=[];
  h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';
  h.store.data.messages=Array.from({length:count},(_,i)=>[{id:'local-u-'+i,turnId:'turn-'+i,role:'user',text:'same repeated question',mode:'codex',status:'completed',purpose:'analyze'},{id:'local-a-'+i,turnId:'turn-'+i,role:'assistant',text:'old answer '+i,mode:'codex',status:'completed'}]).flat();h.store.save();const id=h.store.data.activeConversationId;
  const turns=Array.from({length:count},(_,i)=>({id:'turn-'+i,status:'completed',items:[{type:'userMessage',id:'local-u-'+i,content:[{type:'text',text:'same repeated question'}]},{type:'agentMessage',text:'updated answer '+i}]}));
  h.context.remoteHistoryFixture={id:'owned-thread',turns};vm.runInContext("codex.connect=async()=>true;codex.request=async(method)=>{if(method==='thread/read')return{thread:remoteHistoryFixture};const error=Error('old CLI');error.code=-32601;throw error;};",h.context);
  for(let i=0;i<(process.env.ONGGI_HISTORY_COST_REVIEW==='1'?20:1);i++){const started=performance.now();await h.call('open-conversation',{id});samples.push(performance.now()-started);}
  assert.equal(h.store.data.messages.length,count*2);assert.equal(h.store.data.messages.at(-2).id,'local-u-'+(count-1));assert.equal(h.store.data.messages.at(-2).purpose,'analyze');assert.equal(h.store.data.messages.at(-1).text,'updated answer '+(count-1));
  if(process.env.ONGGI_HISTORY_COST_REVIEW==='1'){
    const output=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'../artifacts/history-cost'));fs.mkdirSync(output,{recursive:true});
    const label=process.env.ONGGI_HISTORY_COST_LABEL??'sample';if(!/^[a-z0-9-]{1,64}$/i.test(label))throw Error('계측 결과 이름은 영문/숫자/하이픈 1~64자여야 합니다.');
    fs.writeFileSync(path.join(output,'history-cost-'+label+'.json'),JSON.stringify({count,samples,platform:process.platform,arch:process.arch,node:process.versions.node,realModel:false},null,2)+'\n');
  }
});

test('incremental history retries the same cursor, preserves unmatched local blocks and anchors timestamp-free older turns',async t=>{
  const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';
  h.store.data.messages=[{id:'local-2',turnId:'turn-2',role:'user',text:'original question',mode:'codex',status:'completed',purpose:'plan'},{id:'reply-2',turnId:'turn-2',role:'assistant',text:'old answer',mode:'codex',status:'completed'},{id:'unmatched',turnId:'local-only',role:'user',text:'keep unmatched',mode:'codex',status:'completed'}];h.store.save();const id=h.store.data.activeConversationId;
  let pages=0;const cursors=[];
  h.context.readIncremental=async(method,params)=>{
    if(method==='thread/read')return{thread:{id:'owned-thread'}};pages++;cursors.push(params.cursor??null);
    if(pages===2)throw Error('temporary page failure');
    const number=pages===1?2:1;return{data:[{id:'turn-'+number,itemsView:'full',status:'completed',startedAt:null,items:[{type:'userMessage',id:'remote-'+number,content:[{type:'text',text:'remote '+number}]},{type:'agentMessage',text:'answer '+number}]}],nextCursor:pages===1?'older-page':null};
  };vm.runInContext('codex.connect=async()=>true;codex.request=readIncremental;',h.context);
  await h.call('open-conversation',{id});assert.equal(pages,1);assert.equal(h.store.data.messages[0].text,'original question');assert.equal(h.store.data.messages[0].purpose,'plan');assert.equal(h.store.data.messages.at(-1).id,'unmatched');
  const committed=JSON.stringify(h.store.data.messages);await h.call('load-older',{});assert.equal(JSON.stringify(h.store.data.messages),committed);assert.equal(vm.runInContext('remoteHistory.cursor',h.context),'older-page');
  await h.call('load-older',{});assert.deepEqual(cursors,[null,'older-page','older-page']);assert.equal(h.store.data.messages[0].turnId,'turn-1');assert.equal(h.store.data.messages[2].id,'local-2');assert.equal(h.store.data.messages.at(-1).id,'unmatched');assert.equal(vm.runInContext('remoteHistory.cursor',h.context),null);assert.equal(new Store(h.root,{}).data.messages.at(-1).text,'keep unmatched');
});

test('legacy history matches repeated questions without remote IDs in order while retaining local metadata',async t=>{
  const h=mainHarness(t),count=500;h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';
  h.store.data.messages=Array.from({length:count},(_,i)=>[{id:'old-u-'+i,role:'user',text:'same repeated legacy question',mode:'codex',status:'completed',purpose:i%2?'plan':'review'},{id:'old-a-'+i,role:'assistant',text:'old '+i,mode:'codex',status:'completed'}]).flat();h.store.save();const id=h.store.data.activeConversationId;
  h.context.legacyHistoryFixture={id:'owned-thread',turns:Array.from({length:count},(_,i)=>({id:'remote-turn-'+i,status:'completed',items:[{type:'userMessage',id:'unmatched-remote-'+i,content:[{type:'text',text:'same repeated legacy question'}]},{type:'agentMessage',text:'new '+i}]}))};
  vm.runInContext("codex.connect=async()=>true;codex.request=async(method,params)=>{if(method==='thread/read')return{thread:params.includeTurns?legacyHistoryFixture:{id:'owned-thread'}};throw Object.assign(Error('legacy method unavailable'),{code:-32601});};",h.context);
  await h.call('open-conversation',{id});assert.equal(h.store.data.messages.length,count*2);
  for(let i=0;i<count;i++){assert.equal(h.store.data.messages[i*2].id,'old-u-'+i);assert.equal(h.store.data.messages[i*2].purpose,i%2?'plan':'review');assert.equal(h.store.data.messages[i*2+1].id,'old-a-'+i);assert.equal(h.store.data.messages[i*2+1].text,'new '+i);}
});

test('incremental history reveals stored blocks before requesting another remote page',async t=>{
  const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';
  h.store.data.messages=Array.from({length:150},(_,i)=>[{id:'u-'+i,turnId:'turn-'+i,role:'user',text:'question '+i,mode:'codex',status:'completed'},{id:'a-'+i,turnId:'turn-'+i,role:'assistant',text:'answer '+i,mode:'codex',status:'completed'}]).flat();h.store.save();const id=h.store.data.activeConversationId;let pages=0;
  h.context.readIncremental=async method=>method==='thread/read'?{thread:{id:'owned-thread'}}:{data:[{id:'turn-149',itemsView:'full',status:'completed',items:[{type:'userMessage',id:'u-149',content:[{type:'text',text:'question 149'}]},{type:'agentMessage',text:'answer 149'}]}],nextCursor:++pages===1?'older':null};vm.runInContext('codex.connect=async()=>true;codex.request=readIncremental;',h.context);
  await h.call('open-conversation',{id});assert.equal(pages,1);await h.call('load-older',{});assert.equal(h.context.testPanel.messageLimit,200);assert.equal(pages,1);await h.call('load-older',{});assert.equal(h.context.testPanel.messageLimit,300);assert.equal(pages,1);await h.call('load-older',{});assert.equal(pages,2);assert.equal(h.store.data.messages.length,300);
});

test('partial remote history refuses ambiguous text-only legacy matches without losing local records',async t=>{
  const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';h.store.data.messages=[{id:'legacy',role:'user',text:'same question',mode:'codex',status:'completed',purpose:'review'}];h.store.save();const id=h.store.data.activeConversationId;let saves=0;
  h.context.readIncremental=async method=>method==='thread/read'?{thread:{id:'owned-thread'}}:{data:[{id:'unknown-turn',itemsView:'full',status:'completed',items:[{type:'userMessage',id:'remote-item',content:[{type:'text',text:'same question'}]},{type:'agentMessage',text:'partial answer'}]}],nextCursor:'older'};vm.runInContext('codex.connect=async()=>true;codex.request=readIncremental;',h.context);h.store.saveAsync=async()=>{saves++;};
  await h.call('open-conversation',{id});assert.equal(saves,0);assert.equal(h.store.data.messages.length,1);assert.equal(h.store.data.messages[0].id,'legacy');assert.equal(h.store.data.messages[0].purpose,'review');assert.match(vm.runInContext('historyWarning',h.context),/이전 버전 기록의 연결/);assert.equal(vm.runInContext('remoteHistory',h.context),null);
});

test('remote history cancellation and stale owners never commit after metadata, page or image waits',async t=>{
  const failures=[];
  for(const boundary of ['saving','metadata','page','image'])for(const change of boundary==='saving'?['generation','frame','owner','lock','suspend']:['cancel','generation','frame','owner','process','workspace','lock','suspend']){
    const h=mainHarness(t);h.context.testPanel.renderGeneration=1;h.context.testPanel.rendererReady=true;h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';h.store.data.messages=[{id:'local',turnId:'turn',role:'user',text:'keep',mode:'codex',status:'completed'}];h.store.save();const id=h.store.data.activeConversationId;let release,entered,saves=0;
    const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;}),pause=async()=>{entered();await gate;};
    h.context.readCancelable=async method=>{if(method==='thread/read'){if(boundary==='metadata')await pause();return{thread:{id:'owned-thread'}};}if(boundary==='page')await pause();return{data:[{id:'turn',itemsView:'full',status:'completed',items:[{type:'userMessage',id:'local',content:[{type:'text',text:'keep'}]},{type:'agentMessage',text:'must not commit'},...(boundary==='image'?[{type:'imageGeneration'}]:[])]}],nextCursor:'older'};};
    h.context.captureCancelable=async()=>{await pause();return[];};vm.runInContext('codex.connect=async()=>true;codex.request=readCancelable;responseImages={capture:captureCancelable};',h.context);h.store.saveAsync=async()=>{saves++;};
    if(boundary==='saving')h.store.saving=gate.then(()=>{h.store.saving=null;});
    const pending=h.call('open-conversation',{id});if(boundary==='saving')entered();await waiting;
    if(change==='cancel'){
      assert.equal((await h.call('cancel-history',{})).ok,true);assert.equal(vm.runInContext('historyLoading',h.context),true);assert.equal(saves,0);
    }else if(change==='generation')h.context.testPanel.renderGeneration++;
    else if(change==='frame')h.context.testPanel.webContents.mainFrame={};
    else if(change==='owner'){h.context.replacementPanel={...h.context.testPanel,webContents:{...h.context.testPanel.webContents,mainFrame:{}}};vm.runInContext('panel=replacementPanel;',h.context);}
    else if(change==='process')vm.runInContext('codex.process={};',h.context);
    else if(change==='workspace')h.store.data.settings.workspace='/changed';
    else vm.runInContext(change==='lock'?'screenLocked=true;':'systemSuspended=true;',h.context);
    release();try{await pending;}catch{}
    if(saves||h.store.data.messages.length!==1||h.store.data.messages[0].text!=='keep')failures.push({boundary,change,saves,count:h.store.data.messages.length});
    assert.equal(vm.runInContext('historyLoading',h.context),false,boundary+' '+change+' releases history lock');
  }
  assert.deepEqual(failures,[]);
});

test('remote history cannot be canceled once its save starts and stale saves do not publish a continuation',async t=>{
  const failures=[];
  for(const change of ['none','frame','workspace','generation']){
    const h=mainHarness(t);h.context.testPanel.renderGeneration=1;h.store.data.settings.demo=false;h.store.data.threadId='owned-thread';h.store.data.messages=[{id:'local',turnId:'turn',role:'user',text:'keep',mode:'codex',status:'completed'}];h.store.save();const id=h.store.data.activeConversationId;let release,entered;
    const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});
    h.context.readCommitting=async method=>method==='thread/read'?{thread:{id:'owned-thread'}}:{data:[{id:'turn',itemsView:'full',status:'completed',items:[{type:'userMessage',id:'local',content:[{type:'text',text:'keep'}]},{type:'agentMessage',text:'saved answer'}]}],nextCursor:'older'};vm.runInContext('codex.connect=async()=>true;codex.request=readCommitting;',h.context);h.store.saveAsync=async()=>{entered();await gate;};
    const pending=h.call('open-conversation',{id});await waiting;assert.equal((await h.call('cancel-history',{})).ok,false);assert.equal(vm.runInContext('historyRequest.committing',h.context),true);
    if(change==='frame')h.context.testPanel.webContents.mainFrame={};else if(change==='workspace')h.store.data.settings.workspace='/changed';else if(change==='generation')h.context.testPanel.renderGeneration++;
    release();await pending;assert.equal(h.store.data.messages[1].text,'saved answer');assert.equal(vm.runInContext('historyLoading',h.context),false);
    const hasContinuation=vm.runInContext("remoteHistory?.cursor==='older'",h.context);if(hasContinuation!==(change==='none'))failures.push({change,hasContinuation});
  }
  assert.deepEqual(failures,[]);
});

test('image completion is persisted after decode, remains an image-only reply and rejects foreign image requests',async t=>{
  const h=mainHarness(t);let release;h.context.fixtureCapture=()=>new Promise(resolve=>{release=resolve;});
  h.store.data.messages=[{id:'u',role:'user',text:'draw',status:'running'},{id:'a',role:'assistant',text:'',status:'running'}];
  vm.runInContext("responseImages={capture:fixtureCapture,read:()=>({bytes:Buffer.from('AA==','base64')})};current={id:'u',replyId:'a',turnId:'turn'};codex.emit('notification',{method:'item/completed',params:{turnId:'turn',item:{id:'image',type:'imageGeneration',status:'completed',result:'fixture'}}});",h.context);
  await Promise.resolve();const finished=vm.runInContext("finishJob('completed')",h.context);await Promise.resolve();assert.equal(h.store.data.activeConversationId,null);
  release([{itemId:'image',status:'ready',id:'a'.repeat(64),previewId:'b'.repeat(64),mime:'image/png',width:2,height:2,bytes:100}]);await finished;
  const persisted=new Store(h.root,{});assert.equal(persisted.data.messages[1].images[0].status,'ready');assert.equal(persisted.data.messages[1].text,'');
  await assert.rejects(h.call('response-image',{messageId:'foreign',imageId:'a'.repeat(64)}),/이 대화/);assert.equal((await h.call('response-image',{messageId:'a',imageId:'a'.repeat(64)})).source,'data:image/png;base64,AA==');
});

test('interrupting image preparation leaves a failed image notice in memory and on disk',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'u',role:'user',text:'draw',status:'running'},{id:'a',role:'assistant',text:'',status:'running',images:[{itemId:'image',status:'pending'}]}];vm.runInContext("current={id:'u',replyId:'a'};",h.context);await vm.runInContext("finishJob('interrupted')",h.context);assert.equal(h.store.data.messages[1].images[0].status,'failed');assert.equal(new Store(h.root,{}).data.messages[1].images[0].status,'failed');
});

test('a failed automatic reconnect does not schedule a retry loop',async t=>{
  const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.settings.codexPath=path.join(__dirname,'fixtures/connection-image-codex.cjs');let calls=0;h.context.failConnect=async()=>{calls++;vm.runInContext("codex.emit('disconnected','retry failed')",h.context);throw Error('retry failed');};
  vm.runInContext("codex.connect=failConnect;codex.emit('disconnected','lost')",h.context);await Promise.resolve();const timer=h.timers.find(t=>t.ms===1500);assert.ok(timer);timer.fn();await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(h.timers.filter(t=>t.ms===1500).length,1);
});

test('switching to demo cancels a pending browser login and preserves the real conversation',async t=>{
  const h=mainHarness(t);h.store.data.settings.demo=false;h.store.data.messages=[{id:'u',role:'user',text:'keep',status:'completed',mode:'codex'}];h.store.save();const id=h.store.data.activeConversationId;
  let cancelled=0;h.context.cancelOwnedLogin=async()=>{cancelled++;vm.runInContext('connectionSetup.attempt=null;',h.context);};vm.runInContext("connectionSetup.attempt={id:'owned'};connectionSetup.cancelLogin=cancelOwnedLogin;",h.context);
  await h.call('settings',{demo:true});assert.equal(cancelled,1);assert.equal(vm.runInContext('connectionSetup.attempt',h.context),null);assert.equal(h.store.data.settings.demo,true);assert.ok(h.store.data.conversations.some(c=>c.id===id));assert.equal(h.store.readHistory(id).messages[0].text,'keep');
});

test('mini-mode admissions preserve attachment snapshots in FIFO and prevent reuse during commit',async t=>{
  const h=mainHarness(t),{PersonaLibrary}=require('../src/personas.cjs'),{loadPack}=require('../src/packs.cjs'),{AttachmentStore}=require('../src/attachments.cjs');
  h.store.data.settings.buddyName='옹기봇';h.store.data.settings.personaModes={'onggi-clip':'friendly'};
  h.context.testPersonas=new PersonaLibrary(path.join(h.root,'personas'),[loadPack(path.join(__dirname,'../characters/onggi-clip'))]);h.context.testAttachments=new AttachmentStore(path.join(h.root,'attachments'),{});vm.runInContext('personaLibrary=testPersonas;attachmentStore=testAttachments;panel.compactMode=true;current={id:"held"};',h.context);
  const source=path.join(h.root,'source.txt');fs.writeFileSync(source,'first');h.electron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});
  const selected=await h.call('pick-attachments',{kind:'file'}),attachment=selected.attachments[0];fs.writeFileSync(source,'changed');
  const first=h.call('send',{text:'first',attachmentIds:[attachment.id]});await assert.rejects(h.call('send',{text:'reuse',attachmentIds:[attachment.id]}),/선택한 첨부/);const second=h.call('send',{text:'second'});await Promise.all([first,second]);
  assert.deepEqual(Array.from(vm.runInContext('queue.map(j=>j.text)',h.context)),['first','second']);assert.equal(vm.runInContext('queue[0].attachments[0].hash',h.context),attachment.hash);assert.equal(fs.readFileSync(h.context.testAttachments.read(attachment).file,'utf8'),'first');assert.equal(new Store(h.root,{}).data.messages[0].attachments[0].hash,attachment.hash);
  await assert.rejects(h.call('attachment-preview',{id:attachment.id}),/이 대화/);await assert.rejects(h.call('send',{text:'foreign',attachmentIds:['foreign']}),/선택한 첨부/);
  await h.call('cancel',{id:vm.runInContext('queue[0].id',h.context)});assert.equal(vm.runInContext('queue[0].text',h.context),'second');assert.equal(h.store.data.messages[0].status,'interrupted');
});

test('queued edits reserve their position and restore the original question after a failed commit',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'edit-user',role:'user',text:'original',status:'queued'},{id:'edit-reply',role:'assistant',text:'',status:'queued'}];h.store.save();
  vm.runInContext("queue=[{id:'edit-user',replyId:'edit-reply',text:'original',attachments:[],selection:{model:'captured'},mode:'demo'}];current={id:'held'};",h.context);
  const edit=await h.call('edit-queued',{id:'edit-user'});assert.equal(vm.runInContext('queue[0].editing',h.context),true);
  h.store.saveAsync=async()=>{throw Error('edit disk full');};await assert.rejects(h.call('save-queued',{id:edit.id,token:edit.token,text:'new text'}),/disk full/);
  assert.equal(h.store.data.messages[0].text,'original');assert.equal(vm.runInContext('queue[0].text',h.context),'original');assert.equal(vm.runInContext('queueEdit.saving',h.context),false);
  h.store.saveAsync=async()=>{};await h.call('save-queued',{id:edit.id,token:edit.token,text:'new text'});assert.equal(h.store.data.messages[0].text,'new text');assert.equal(vm.runInContext('queue[0].selection.model',h.context),'captured');assert.equal(vm.runInContext('queueEdit',h.context),null);
});

test('terminal queued cancellation prevents dispatch until its storage operation finishes',async t=>{
  const h=mainHarness(t);let release;h.store.saveAsync=()=>new Promise(resolve=>{release=resolve;});h.store.data.messages=[{id:'cancel-u',role:'user',text:'cancel',status:'queued'},{id:'cancel-a',role:'assistant',text:'',status:'queued'}];
  vm.runInContext("queue=[{id:'cancel-u',replyId:'cancel-a'}];",h.context);const pending=h.call('cancel-all-queued',{});
  vm.runInContext("queue.push({id:'later'});",h.context);await vm.runInContext('runQueue()',h.context);assert.equal(vm.runInContext('current',h.context),null);assert.equal(vm.runInContext('queueControlSaving',h.context),1);
  vm.runInContext("queuePauses.add('manual');",h.context);release();await pending;assert.equal(vm.runInContext('queue[0].id',h.context),'later');assert.equal(vm.runInContext('queueControlSaving',h.context),0);
});

test('manual pause survives clearing transient causes and storage blockage retains queued drafts',async t=>{
  const h=mainHarness(t);await h.call('pause-queue',{});vm.runInContext("queuePauses.add('connection');queue=[{id:'q'}];",h.context);h.store.writeBlocked=true;
  await assert.rejects(h.call('continue-queue',{}),/복구/);await vm.runInContext('runQueue()',h.context);assert.equal(vm.runInContext('queue.length',h.context),1);assert.equal(vm.runInContext("queuePauses.has('manual')&&queuePauses.has('storage')",h.context),true);
});

test('hotkey collision and failed persistence keep the existing registered shortcut',async t=>{
  const h=mainHarness(t),registered=new Set(['CommandOrControl+Shift+Space']);let reject=false;Object.assign(h.electron.globalShortcut,{register:key=>{if(reject)return false;registered.add(key);return true;},unregister:key=>registered.delete(key)});
  reject=true;await assert.rejects(h.call('settings',{hotkey:'CommandOrControl+Shift+B'}),/사용 중/);assert.deepEqual([...registered],['CommandOrControl+Shift+Space']);
  reject=false;h.store.save=()=>{throw Error('setting full');};await assert.rejects(h.call('settings',{hotkey:'CommandOrControl+Shift+B'}),/full/);assert.deepEqual([...registered],['CommandOrControl+Shift+Space']);assert.equal(vm.runInContext('activeShortcut',h.context),'CommandOrControl+Shift+Space');
});

test('manual conversation title and pins survive worker saves and legacy records default to automatic',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'title-u',role:'user',text:'자동 제목',status:'completed'}];h.store.save();const id=h.store.data.activeConversationId;
  await h.call('conversation-meta',{id,title:'내가 정한 제목',pinned:true});h.store.data.messages.push({id:'title-a',role:'assistant',text:'새 응답',status:'completed'});await h.store.saveAsync();const restored=new Store(h.root,{});assert.equal(restored.data.conversations[0].title,'내가 정한 제목');assert.equal(restored.data.conversations[0].titleSource,'manual');assert.equal(restored.data.conversations[0].pinned,true);
  const file=JSON.parse(fs.readFileSync(h.store.file));delete file.conversations[0].titleSource;delete file.conversations[0].pinned;fs.writeFileSync(h.store.file,JSON.stringify(file));const legacy=new Store(h.root,{});assert.equal(legacy.data.conversations[0].titleSource,'auto');assert.equal(legacy.data.conversations[0].pinned,false);
});

test('queued review edits reject image inputs and block new attachment dialogs during a commit',async t=>{
  const h=mainHarness(t);h.store.data.messages=[{id:'review-edit',role:'user',text:'review request',status:'queued'},{id:'review-reply',role:'assistant',text:'',status:'queued'}];h.store.save();
  vm.runInContext("queue=[{id:'review-edit',replyId:'review-reply',text:'review request',attachments:[],selection:{},purpose:'review'}];current={id:'held'};",h.context);const edit=await h.call('edit-queued',{id:'review-edit'});
  vm.runInContext("pendingAttachments.set('fixture-image',{attachment:{id:'fixture-image',kind:'image',bytes:20},conversationId:store.data.activeConversationId,editingJobId:'review-edit'});",h.context);
  await assert.rejects(h.call('save-queued',{id:edit.id,token:edit.token,text:'edited review',attachmentIds:['fixture-image']}),/이미지 첨부/);assert.equal(h.store.data.messages[0].text,'review request');assert.equal(vm.runInContext('queue[0].text',h.context),'review request');
  vm.runInContext('queueEdit.saving=true;',h.context);await assert.rejects(h.call('pick-attachments',{kind:'image'}),/준비 작업/);
});

test('Markdown export flushes one verified image at a time and preserves the request-time text snapshot',async t=>{
  const h=mainHarness(t),file=path.join(h.root,'bounded.md'),folder=path.join(h.root,'bounded.assets'),bytes=Buffer.from('verified bytes');let pendingReads=0,writes=0;
  h.store.data.messages=[{id:'bounded-reply',role:'assistant',text:'original request snapshot',status:'completed',images:Array.from({length:3},(_,i)=>({id:String(i+1).repeat(64),mime:'image/png',status:'ready',bytes:bytes.length}))}];h.store.save();
  const id=h.store.data.activeConversationId;h.electron.dialog.showSaveDialog=async()=>{h.store.data.messages[0].text='changed while choosing a location';return{canceled:false,filePath:file};};
  h.context.exportRead=()=>{pendingReads++;return{bytes:Buffer.from(bytes)};};vm.runInContext('responseImages={read:exportRead};',h.context);
  const write=fs.promises.writeFile;t.mock.method(fs.promises,'writeFile',async(destination,...args)=>{
    if(String(destination).startsWith(folder+path.sep)){assert.equal(pendingReads,1,'Only one image buffer may be retained before flushing');pendingReads--;writes++;}
    return write(destination,...args);
  });
  const result=await h.call('export-conversation',{id,includeImages:true});assert.equal(result.imageCount,3);assert.equal(writes,3);assert.equal(pendingReads,0);
  assert.match(fs.readFileSync(file,'utf8'),/original request snapshot/);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/changed while/);
  for(let i=1;i<=3;i++)assert.ok(fs.readFileSync(path.join(folder,i+'.png')).equals(bytes));
});

test('failed Markdown image export retains files added by the user to the new output folder',async t=>{
  const h=mainHarness(t),file=path.join(h.root,'export.md'),folder=path.join(h.root,'export.assets'),bytes=Buffer.from('owned fixture bytes');
  h.electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:file});h.context.exportImageBytes=bytes;vm.runInContext('responseImages={read:()=>({bytes:exportImageBytes})};',h.context);
  h.store.data.messages=[{id:'export-reply',role:'assistant',text:'keep original',status:'completed',images:[{id:'a'.repeat(64),mime:'image/png',status:'ready',bytes:bytes.length},{id:'b'.repeat(64),mime:'image/png',status:'ready',bytes:bytes.length}]}];h.store.save();const id=h.store.data.activeConversationId,write=fs.promises.writeFile;
  t.mock.method(fs.promises,'writeFile',async(destination,...args)=>{if(destination===path.join(folder,'2.png'))throw Error('fixture export disk full');const result=await write(destination,...args);if(destination===path.join(folder,'1.png'))await write(path.join(folder,'user-note.txt'),'user added content',{flag:'wx'});return result;});
  await assert.rejects(h.call('export-conversation',{id,includeImages:true}),/부분 이미지/);assert.equal(fs.readFileSync(path.join(folder,'user-note.txt'),'utf8'),'user added content');assert.equal(fs.existsSync(file),false);assert.equal(h.store.data.messages[0].text,'keep original');
});

test('image save failure never unlinks a replacement file created after the exclusive open',async t=>{
  const h=mainHarness(t),file=path.join(h.root,'save.png'),bytes=Buffer.from('owned fixture');h.electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:file});h.context.saveImageBytes=bytes;vm.runInContext('responseImages={read:()=>({bytes:saveImageBytes})};',h.context);
  h.store.data.messages=[{id:'save-reply',role:'assistant',text:'keep',status:'completed',images:[{id:'a'.repeat(64),mime:'image/png',status:'ready',bytes:bytes.length}]}];h.store.save();
  const open=fs.promises.open;t.mock.method(fs.promises,'open',async(destination,...args)=>{const handle=await open(destination,...args);if(destination!==file||args[0]!=='wx')return handle;return{stat:()=>handle.stat(),sync:()=>handle.sync(),close:()=>handle.close(),writeFile:async()=>{fs.renameSync(file,file+'.owned-partial');fs.writeFileSync(file,'foreign replacement');throw Error('fixture image disk full');}};});
  await assert.rejects(h.call('save-response-image',{messageId:'save-reply',imageId:'a'.repeat(64)}),/저장하지 못/);assert.equal(fs.readFileSync(file,'utf8'),'foreign replacement');assert.equal(h.store.data.messages[0].text,'keep');
});

test('declined tools, MCP errors and unknown terminal states remain distinct after reload',t=>{
  const h=mainHarness(t);h.store.data.threadId='owned-thread';h.store.data.messages=[{id:'tool-u',role:'user',text:'review',status:'completed'},{id:'tool-a',role:'assistant',text:'reply',status:'completed'}];
  vm.runInContext("current={id:'tool-u',replyId:'tool-a',turnId:'owned-turn'};",h.context);
  for(const item of [{id:'command',type:'commandExecution',status:'declined'},{id:'files',type:'fileChange',status:'declined'},{id:'mcp',type:'mcpToolCall',status:'completed',result:{isError:true}},{id:'search',type:'webSearch'},{id:'unknown',type:'commandExecution',status:'future-status'}]){
    h.context.eventItem=item;vm.runInContext("codex.emit('notification',{method:'item/completed',params:{threadId:'owned-thread',turnId:'owned-turn',item:eventItem}});",h.context);
  }
  assert.deepEqual(Array.from(h.store.data.messages[1].progress.tools,item=>item.status),['declined','declined','failed','completed','stopped']);
  h.store.save();const restored=new Store(h.root,{});assert.deepEqual(restored.data.messages[1].progress.tools.map(item=>item.status),['declined','declined','failed','completed','stopped']);
});

test('retrying an unregistered identical shortcut preserves the new registration and rolls back failed saves',async t=>{
  const h=mainHarness(t),registered=new Set();let calls=0;
  Object.assign(h.electron.globalShortcut,{register:key=>{calls++;registered.add(key);return true;},unregister:key=>registered.delete(key)});h.store.shortcut=false;
  await h.call('settings',{hotkey:'CommandOrControl+Shift+Space'});assert.equal(calls,1);assert.equal(h.store.shortcut,true);assert.equal(registered.has('CommandOrControl+Shift+Space'),true);
  registered.clear();h.store.shortcut=false;h.store.save=()=>{throw Error('retry save failed');};
  await assert.rejects(h.call('settings',{hotkey:'CommandOrControl+Shift+Space'}),/save failed/);assert.equal(calls,2);assert.equal(registered.size,0);assert.equal(h.store.shortcut,false);
});

test('fallback shortcuts never block unrelated settings and explicit retries preserve registration rollback',async t=>{
  const h=mainHarness(t),registered=new Set(['CommandOrControl+Shift+Space']),calls=[];let collision=true;
  Object.assign(h.store.data.settings,{hotkey:'CommandOrControl+Shift+B',fontScale:100,notifySound:false});h.store.shortcut=true;
  Object.assign(h.electron.globalShortcut,{register:key=>{calls.push(key);if(collision)return false;registered.add(key);return true;},unregister:key=>registered.delete(key)});
  await h.call('settings',{fontScale:110});await h.call('settings',{notifySound:true});assert.equal(calls.length,0);assert.equal(h.store.data.settings.fontScale,110);assert.equal(h.store.data.settings.notifySound,true);
  await assert.rejects(h.call('settings',{hotkey:'CommandOrControl+Shift+B'}),/단축키/);assert.equal(registered.has('CommandOrControl+Shift+Space'),true);
  collision=false;const save=h.store.save;h.store.save=()=>{throw Error('retry save failed');};
  await assert.rejects(h.call('settings',{hotkey:'CommandOrControl+Shift+B'}),/save failed/);assert.equal(registered.has('CommandOrControl+Shift+B'),false);assert.equal(registered.has('CommandOrControl+Shift+Space'),true);assert.equal(vm.runInContext('activeShortcut',h.context),'CommandOrControl+Shift+Space');
  h.store.save=save;await h.call('settings',{hotkey:'CommandOrControl+Shift+B'});assert.equal(registered.has('CommandOrControl+Shift+B'),true);assert.equal(registered.has('CommandOrControl+Shift+Space'),false);
});

test('queued edit admission locks conflicting controls, preserves current drafts and rejects stale replies',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),draftStart=source.indexOf('function renderDraftAttachments()'),draftBody=source.slice(draftStart,source.indexOf('\nfunction acknowledgeRenderedMessages()',draftStart));
  const start=source.indexOf("edit.addEventListener('click',async()=>{"),body=source.slice(start,source.indexOf('\n        cancel.textContent=',start));
  const ownershipStart=source.indexOf('  if(queueEditOpening){'),ownership=source.slice(ownershipStart,source.indexOf('  const panelRestored=',ownershipStart));
  const submitStart=source.indexOf("document.querySelector('#composer').addEventListener('submit'"),submitBody=source.slice(submitStart,source.indexOf("\ndocument.querySelector('#pause-queue')",submitStart));
  for(const mode of ['success','failure','cancelled','resolved','conversation']){
    const handlers=new Map(),nodes=new Map(),normalAttachment={id:'normal-file',kind:'file',name:'notes.txt',bytes:10},attachments=new Map([['owned',[normalAttachment]]]);let resolve;
    const node=()=>({dataset:{},value:'새 초안',children:[],hidden:false,append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(event,handler){handlers.set(this.key+':'+event,handler);},setAttribute(){},dispatchEvent(){},focus(){}});
    for(const id of ['#prompt','#draft-attachments','#queue-edit-banner','#queue-edit-label','#cancel-queue-edit','#send','#task-purpose','#task-skill','#refresh-skills','#attach-image','#attach-file','#paste-image','#composer','#queue-bar .queue-cancel-all']){const element=node();element.key=id;nodes.set(id,element);}
    const edit=node(),cancel=node();edit.key='edit';const calls=[];
    const context=vm.createContext({state:{activeConversationId:'owned',queue:[{id:'job'}],queueEdit:null,panelVisible:true},next:null,changedConversation:false,queueEditOpening:null,queueEditingUI:null,submitting:false,pickingAttachments:false,attachmentDrafts:attachments,activeTab:'chat',Event:class Event{},edit,item:{id:'job'},document:{querySelector:id=>nodes.get(id),querySelectorAll:selector=>selector.endsWith('.queue-edit')?[edit]:[cancel],createElement:node},act:(action,payload)=>{calls.push({action,payload});return new Promise(done=>{resolve=done;});},window:{onggi:{action:async(action,payload)=>{calls.push({action,payload});return{ok:false};}}}});
    vm.runInContext(draftBody+'\n'+body+'\n'+submitBody,context);const opening=handlers.get('edit:click')();
    for(const id of ['#prompt','#send','#attach-file','#paste-image','#task-purpose','#queue-bar .queue-cancel-all'])assert.equal(nodes.get(id).disabled,true,mode+' '+id);assert.equal(cancel.disabled,true);
    await handlers.get('#composer:submit')({preventDefault(){}});assert.equal(calls.length,1);
    nodes.get('#prompt').value='새 초안 + 늦은 입력';
    if(mode==='cancelled'){context.state.queue=[];context.next=context.state;vm.runInContext(ownership,context);}
    if(mode==='resolved'){
      context.state.queueEdit={id:'job',token:'token'};context.next=context.state;vm.runInContext(ownership,context);context.state.queueEdit=null;vm.runInContext(ownership,context);
    }
    if(mode==='conversation'){context.state.activeConversationId='other';context.state.queue=[];nodes.get('#prompt').value='다른 대화 초안';context.changedConversation=true;context.next=context.state;vm.runInContext(ownership,context);}
    resolve(mode==='failure'?{ok:false}:{ok:true,id:'job',token:'token',text:'대기 질문',attachments:[]});await opening;
    assert.equal(vm.runInContext('queueEditOpening',context),null);assert.equal(nodes.get('#prompt').disabled,false);
    if(mode==='success'){
      assert.equal(vm.runInContext('queueEditingUI.draft',context),'새 초안 + 늦은 입력');assert.equal(vm.runInContext('queueEditingUI.attachments[0].id',context),normalAttachment.id);
      vm.runInContext(source.split('\n').find(line=>line.includes('if(queueEditingUI&&!state.queueEdit&&!submitting)')),context);
      assert.equal(nodes.get('#prompt').value,'새 초안 + 늦은 입력');assert.equal(attachments.get('owned')[0].id,normalAttachment.id);
    }else{assert.equal(vm.runInContext('queueEditingUI',context),null);assert.equal(nodes.get('#prompt').value,mode==='conversation'?'다른 대화 초안':'새 초안 + 늦은 입력');assert.equal(attachments.get('owned')[0].id,normalAttachment.id);}
    assert.equal(calls.filter(item=>item.action==='cancel-queue-edit').length,['cancelled','resolved','conversation'].includes(mode)?1:0);
  }
});

test('trusted file input waits while the composer is disabled and resumes without an IPC capability change',async()=>{
  const handlers=new Map(),invocations=[];let disabled=true,attachmentDisabled=false,prevented=0;
  const context=vm.createContext({require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{invoke:async(...args)=>{invocations.push(args);return{ok:true,attachments:[]};}},webUtils:{getPathForFile:()=>'/fixture/file.txt'}}),window:{addEventListener:(event,handler)=>handlers.set(event,handler)},document:{querySelector:id=>id==='#panel-surface'?{hidden:false}:id==='#prompt'?{disabled}:{disabled:attachmentDisabled}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),context);
  const event={isTrusted:true,preventDefault:()=>prevented++,dataTransfer:{files:[{}]}};await handlers.get('drop')(event);assert.equal(invocations.length,0);assert.equal(prevented,1);
  disabled=false;attachmentDisabled=true;await handlers.get('drop')(event);assert.equal(invocations.length,0);
  attachmentDisabled=false;await handlers.get('drop')(event);assert.equal(invocations.length,1);assert.equal(invocations[0][0],'attachment-input');assert.equal(invocations[0][1].files[0],'/fixture/file.txt');
});

test('attachment import completion belongs to the renderer that admitted it across picker, clipboard and import waits',async t=>{
  const failures=[];
  for(const boundary of ['picker-saving','picker-dialog','picker-import','clipboard-read','clipboard-import','drop-import','response-saving','response-import']){
    for(const change of ['none','generation','frame','owner','lock','suspend']){
      const h=mainHarness(t);h.context.testPanel.renderGeneration=1;h.context.testPanel.rendererReady=true;
      const retained={attachment:{id:'retained'},conversationId:'other',createdAt:Date.now()},attachment={id:'late-import',kind:'file',name:'notes.txt',bytes:1};
      let release,entered;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});
      const pause=async()=>{entered();await gate;};
      h.context.fixtureAttachment=attachment;h.context.retainedAttachment=retained;h.context.importFixture=async()=>{if(boundary.endsWith('-import'))await pause();return[attachment];};
      vm.runInContext("attachmentStore={import:importFixture};pendingAttachments.set('retained',retainedAttachment);responseImages={read:()=>({bytes:Buffer.from('x')})};",h.context);
      h.electron.dialog.showOpenDialog=async()=>{if(boundary==='picker-dialog')await pause();return{canceled:false,filePaths:['/fixture/notes.txt']};};
      h.electron.clipboard.read=async()=>{if(boundary==='clipboard-read')await pause();return[{types:['image/png'],getType:async()=>({size:1,arrayBuffer:async()=>Buffer.from('x')})}];};
      h.store.data.messages=[{id:'reply',role:'assistant',text:'',status:'completed',images:[{id:'image',mime:'image/png',status:'ready'}]}];
      if(boundary.endsWith('-saving'))h.store.saving=gate.then(()=>{h.store.saving=null;});
      const pending=boundary.startsWith('picker-')?h.call('pick-attachments',{kind:'file'}):boundary.startsWith('response-')?h.call('attach-response-image',{messageId:'reply',imageId:'image'}):h.input({kind:boundary.startsWith('clipboard-')?'clipboard':'drop',files:['/fixture/notes.txt']});
      if(boundary.endsWith('-saving'))entered();
      await waiting;
      if(change==='generation')h.context.testPanel.renderGeneration++;
      else if(change==='frame')h.context.testPanel.webContents.mainFrame={};
      else if(change==='owner'){h.context.replacementPanel={...h.context.testPanel,webContents:{...h.context.testPanel.webContents,mainFrame:{}}};vm.runInContext('panel=replacementPanel;',h.context);}
      else if(change==='lock')vm.runInContext('screenLocked=true;',h.context);
      else if(change==='suspend')vm.runInContext('systemSuspended=true;',h.context);
      release();let result,error;try{result=await pending;}catch(value){error=value;}
      const accepted=Boolean(result?.ok),registered=vm.runInContext("pendingAttachments.has('late-import')",h.context);
      if(accepted!==(change==='none')||registered!==(change==='none'))failures.push({boundary,change,accepted,registered,error:error?.message});
      assert.equal(vm.runInContext("pendingAttachments.get('retained')===retainedAttachment",h.context),true,boundary+' '+change+' preserves existing attachment');
      assert.equal(vm.runInContext('attachmentPicking',h.context),false,boundary+' '+change+' releases input lock');
    }
  }
  assert.deepEqual(failures,[],'stale import completions must not register invisible drafts');
});

test('pending attachment removal cannot reappear in a normal draft after queued editing',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('function renderDraftAttachments()'),draftBody=source.slice(start,source.indexOf('\nfunction acknowledgeRenderedMessages()',start));
  const editStart=source.indexOf("edit.addEventListener('click',async()=>{"),editBody=source.slice(editStart,source.indexOf('\n        cancel.textContent=',editStart)),handlers=new Map(),nodes=new Map(),calls=[],pending=new Map();
  const node=()=>({dataset:{},value:'normal draft',children:[],hidden:false,append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(event,handler){handlers.set(this.key+':'+event,handler);},setAttribute(){},dispatchEvent(){},focus(){}});
  for(const id of ['#prompt','#draft-attachments','#queue-edit-banner','#queue-edit-label','#cancel-queue-edit','#send','#task-purpose','#task-skill','#refresh-skills','#attach-image','#attach-file','#paste-image']){const element=node();element.key=id;nodes.set(id,element);}
  const edit=node();edit.key='edit';const attachments=new Map([['owned',[{id:'removed',kind:'file',name:'notes.txt',bytes:10}]]]);
  const context=vm.createContext({state:{activeConversationId:'owned',queue:[{id:'job'}],queueEdit:null,panelVisible:true},queueEditOpening:null,queueEditingUI:null,submitting:false,pickingAttachments:false,attachmentDrafts:attachments,activeTab:'chat',Event:class Event{},edit,item:{id:'job'},document:{querySelector:id=>nodes.get(id),querySelectorAll:()=>[],createElement:node},act:action=>{calls.push(action);return new Promise(resolve=>pending.set(action,resolve));},window:{onggi:{action:async()=>({ok:false})}}});
  vm.runInContext(draftBody+'\n'+editBody+'\nrenderDraftAttachments();',context);const removing=handlers.get('undefined:click')(),opening=handlers.get('edit:click')();
  if(pending.has('edit-queued')){
    pending.get('edit-queued')({ok:true,id:'job',token:'token',text:'queued',attachments:[]});await opening;
    pending.get('discard-attachment')({ok:true});await removing;
  }else{
    await opening;pending.get('discard-attachment')({ok:true});await removing;
    const afterRemoval=handlers.get('edit:click')();pending.get('edit-queued')({ok:true,id:'job',token:'token',text:'queued',attachments:[]});await afterRemoval;
  }
  vm.runInContext(source.split('\n').find(line=>line.includes('if(queueEditingUI&&!state.queueEdit&&!submitting)')),context);
  assert.equal(nodes.get('#prompt').value,'normal draft');assert.deepEqual(Array.from(attachments.get('owned')),[]);assert.equal(vm.runInContext('pickingAttachments',context),false);assert.equal(calls.filter(action=>action==='edit-queued').length,1);
});

test('image save reads only after the dialog and still rejects changed owned cache data',async t=>{
  const h=mainHarness(t),{ResponseImages}=require('../src/response-images.cjs'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4P8EBiBggFAA1rgc9lj6CJAAAAABJRU5ErkJggg==','base64');
  const library=new ResponseImages(path.join(h.root,'images'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),[image]=await library.capture({type:'imageGeneration',id:'generated',status:'completed',result:png.toString('base64')});assert.equal(image.status,'ready');
  h.store.data.messages=[{id:'image-reply',role:'assistant',text:'',status:'completed',images:[image]}];h.context.testImages=library;vm.runInContext('responseImages=testImages;',h.context);const read=library.read.bind(library);let count=0;library.read=value=>{count++;return read(value);};
  h.electron.dialog.showSaveDialog=async()=>({canceled:true});await h.call('save-response-image',{messageId:'image-reply',imageId:image.id});assert.equal(count,0);
  const destination=path.join(h.root,'copy.png');h.electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});await h.call('save-response-image',{messageId:'image-reply',imageId:image.id});assert.equal(count,1);assert.ok(fs.readFileSync(destination).equals(png));
  const changed=path.join(h.root,'changed.png');h.electron.dialog.showSaveDialog=async()=>{fs.writeFileSync(read(image).file,'corrupted');return{canceled:false,filePath:changed};};
  await assert.rejects(h.call('save-response-image',{messageId:'image-reply',imageId:image.id}),/변경/);assert.equal(fs.existsSync(changed),false);
});

test('resolved approvals never notify and visible approval notices close when their turn ends',async t=>{
  const h=mainHarness(t),{EventEmitter}=require('node:events'),notices=[];
  class Notice extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;this.closed=false;}show(){notices.push(this);this.emit('show');}close(){this.closed=true;this.emit('close');}}
  h.context.ReviewNotice=Notice;h.context.testPanel.activeTab='settings';
  Object.assign(h.store.data.settings,{notifyApproval:true,approvalDisplay:'notification',quietHoursEnabled:false});h.store.data.threadId='owned-thread';
  h.store.data.messages=[{id:'notice-u',role:'user',text:'approval',status:'running'},{id:'notice-a',role:'assistant',text:'',status:'running'}];h.store.save();
  vm.runInContext("NativeNotification=ReviewNotice;current={id:'notice-u',replyId:'notice-a',turnId:'owned-turn'};codex.emit('request',{id:'resolved',method:'item/commandExecution/requestApproval',params:{threadId:'owned-thread',turnId:'owned-turn'}});codex.emit('notification',{method:'serverRequest/resolved',params:{threadId:'owned-thread',requestId:'resolved'}});",h.context);
  h.publish();assert.equal(notices.length,0);
  vm.runInContext("codex.emit('request',{id:'visible',method:'item/commandExecution/requestApproval',params:{threadId:'owned-thread',turnId:'owned-turn'}});",h.context);
  h.publish();assert.equal(notices.length,1);assert.equal(notices[0].closed,false);
  await vm.runInContext("finishJob('interrupted')",h.context);h.publish();assert.equal(notices[0].closed,true);assert.equal(vm.runInContext('liveNotices.size',h.context),0);
  class BrokenNotice{static isSupported(){throw Error('native support failure');}}
  h.context.BrokenNotice=BrokenNotice;h.store.data.messages[1].status='running';
  vm.runInContext("NativeNotification=BrokenNotice;current={id:'notice-u',replyId:'notice-a',turnId:'next-turn'};codex.emit('request',{id:'broken',method:'item/commandExecution/requestApproval',params:{threadId:'owned-thread',turnId:'next-turn'}});",h.context);
  assert.doesNotThrow(()=>h.publish());assert.match(vm.runInContext('notificationIssue',h.context),/준비하지 못/);
});

test('asynchronous skill reads reject a changed workspace, process or catalog and close the file',async t=>{
  const originalOpen=fs.promises.open;let file,release,handle;
  t.mock.method(fs.promises,'open',async(source,...args)=>{if(source===file)await new Promise(resolve=>{release=resolve;});const opened=await originalOpen(source,...args);if(source===file)handle=opened;return opened;});
  for(const change of ['workspace','process','catalog']){
    const h=mainHarness(t);file=path.join(h.root,'SKILL.md');release=null;handle=null;fs.writeFileSync(file,'# skill\nBounded instructions');h.store.data.settings.demo=false;
    h.context.skillFile=file;
    vm.runInContext("codex.process={};codex.request=async()=>({data:[{cwd:store.data.settings.workspace,skills:[{enabled:true,name:'fixture',path:skillFile}],errors:[]}]});",h.context);
    const pending=h.call('skills-list',{}),deadline=Date.now()+1000;
    while(!release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(release);
    if(change==='workspace')h.store.data.settings.workspace=h.root+'-changed';
    else if(change==='process')vm.runInContext('codex.process={};',h.context);
    else vm.runInContext("codex.emit('notification',{method:'skills/changed',params:{}});",h.context);
    release();await assert.rejects(pending,/스킬 목록/);assert.equal(vm.runInContext('skillsCatalog.length',h.context),0);assert.equal(handle.fd,-1);
  }
});

test('unread acknowledgements require viewport intersection, prepared images and the visible chat owner',async t=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('function acknowledgeRenderedMessages()'),body=source.slice(start,source.indexOf('\nfunction renderHistory()',start)),calls=[];
  let bounds={top:2000,bottom:2150,left:0,right:400},preview=null;
  const message={id:'unread',role:'assistant',status:'completed'},state={panelVisible:true,activeConversationId:'owned',unreadReply:{conversationId:'owned',messageId:'unread'},messages:[message]};
  const context=vm.createContext({surface:'panel',activeTab:'chat',state,innerHeight:600,innerWidth:800,document:{hidden:false,querySelector:()=>({getBoundingClientRect:()=>({top:0,bottom:400,left:0,right:400})})},messageCards:new Map([['unread',{getClientRects:()=>[bounds],getBoundingClientRect:()=>bounds,querySelector:()=>preview}]]),renderAckIds:new Set(),act:name=>{calls.push(name);},requestAnimationFrame:()=>{}});
  vm.runInContext(body,context);vm.runInContext('acknowledgeRenderedMessages()',context);assert.equal(calls.length,0);
  bounds={top:100,bottom:250,left:0,right:400};preview={dataset:{},complete:false,naturalWidth:0};vm.runInContext('acknowledgeRenderedMessages()',context);assert.equal(calls.length,0);
  preview.complete=true;preview.naturalWidth=2;vm.runInContext('acknowledgeRenderedMessages()',context);assert.deepEqual(calls,['notice-read']);calls.length=0;
  message.images=[{status:'pending'}];vm.runInContext('acknowledgeRenderedMessages()',context);assert.equal(calls.length,0);message.images=[];
  vm.runInContext("activeTab='history';acknowledgeRenderedMessages();activeTab='chat';document.hidden=true;acknowledgeRenderedMessages();",context);assert.equal(calls.length,0);
  const h=mainHarness(t);h.store.data.messages=[{id:'unread',role:'assistant',text:'ready',status:'completed'}];h.store.save();h.context.testPanel.rendererReady=true;
  vm.runInContext("unreadReply={conversationId:store.data.activeConversationId,messageId:'unread'};panel.activeTab='history';",h.context);await h.call('notice-read',{id:'unread'});assert.ok(vm.runInContext('unreadReply',h.context));
  vm.runInContext("panel.activeTab='chat';screenLocked=true;",h.context);await h.call('notice-read',{id:'unread'});assert.ok(vm.runInContext('unreadReply',h.context));
  vm.runInContext('screenLocked=false;systemSuspended=true;',h.context);await h.call('notice-read',{id:'unread'});assert.ok(vm.runInContext('unreadReply',h.context));
  vm.runInContext('systemSuspended=false;',h.context);await h.call('notice-read',{id:'unread'});assert.equal(vm.runInContext('unreadReply',h.context),null);
});

test('render acknowledgements avoid geometry for ineligible messages and retain terminal-response acknowledgements',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('function acknowledgeRenderedMessages()'),body=source.slice(start,source.indexOf('\nfunction renderHistory()',start)),frames=[],calls=[],geometry=[];
  const messages=[
    {id:'user',role:'user',timing:{completedAt:1}},
    {id:'running',role:'assistant'},
    {id:'rendered',role:'assistant',timing:{completedAt:1,renderedAt:2}},
    {id:'scheduled',role:'assistant',timing:{completedAt:1}},
    ...['completed','failed','interrupted'].map(status=>({id:status,role:'assistant',status,timing:{completedAt:1}})),
    {id:'hidden',role:'assistant',timing:{completedAt:1}},
    {id:'pending-image',role:'assistant',timing:{completedAt:1},images:[{status:'pending'}]}
  ];
  const cards=new Map(messages.map(message=>[message.id,{getClientRects:()=>{geometry.push(message.id);return message.id==='hidden'?[]:[{}];},querySelector:()=>null}]));
  const context=vm.createContext({surface:'panel',activeTab:'chat',state:{activeConversationId:'owned',panelVisible:true,messages},document:{hidden:false},messageCards:cards,renderAckIds:new Map([['scheduled',{}]]),requestAnimationFrame:callback=>frames.push(callback),performance,act:async(action,payload)=>{calls.push({action,payload});return{ok:true};}});
  vm.runInContext(body+'\nacknowledgeRenderedMessages();',context);
  assert.deepEqual(geometry,['completed','failed','interrupted','hidden','pending-image']);
  assert.equal(frames.length,1);assert.equal(calls.length,0);
  while(frames.length)await frames.shift()();
  assert.equal(calls.length,1);assert.deepEqual(Array.from(calls[0].payload.items,item=>item.id),['completed','failed','interrupted']);assert.equal(calls[0].payload.conversationId,'owned');
  assert.ok(calls.every(call=>call.action==='response-rendered'));
  geometry.length=0;vm.runInContext('acknowledgeRenderedMessages()',context);
  assert.deepEqual(geometry,['hidden','pending-image']);assert.equal(frames.length,0);
});

test('batched render acknowledgements persist terminal timings once and replay without a second save',async t=>{
  const h=mainHarness(t),completed=performance.timeOrigin+performance.now()-100;
  h.store.data.messages=Array.from({length:50},(_,index)=>({id:'batch-'+index,role:'assistant',text:'reply',status:['completed','failed','interrupted'][index%3],timing:{completedAt:completed,submittedAt:index?completed-100:null}}));h.store.save();
  const save=h.store.saveAsync.bind(h.store);let saves=0;h.store.saveAsync=()=>{saves++;return save();};
  const payload={conversationId:h.store.data.activeConversationId,items:h.store.data.messages.map(message=>({id:message.id,completedAt:completed,renderedAt:performance.timeOrigin+performance.now()}))};
  assert.equal((await h.call('response-rendered',payload)).ok,true);assert.equal(saves,1);
  const stored=new Store(h.root,{});assert.equal(stored.data.messages.length,50);assert.ok(stored.data.messages.every(message=>message.timing.renderedAt>=completed));assert.equal(stored.data.messages[0].timing.totalMs,null);
  assert.equal((await h.call('response-rendered',payload)).ok,true);assert.equal(saves,1);
});

test('batched render validation is atomic and a failed save restores every timing before retry',async t=>{
  const h=mainHarness(t),completed=performance.timeOrigin+performance.now()-100;
  h.store.data.messages=['first','second'].map(id=>({id,role:'assistant',text:id,status:'completed',timing:{completedAt:completed,submittedAt:completed-100}}));h.store.save();
  const payload={conversationId:h.store.data.activeConversationId,items:h.store.data.messages.map(message=>({id:message.id,completedAt:completed,renderedAt:performance.timeOrigin+performance.now()}))};let saves=0;
  h.store.saveAsync=async()=>{saves++;throw Error('batch disk full');};
  for(const items of [[],[payload.items[0],payload.items[0]],[payload.items[0],{...payload.items[1],renderedAt:NaN}],[payload.items[0],{...payload.items[1],completedAt:Infinity}],Array.from({length:101},(_,index)=>({...payload.items[0],id:String(index)}))])await assert.rejects(h.call('response-rendered',{...payload,items}),/화면 반영/);
  assert.equal((await h.call('response-rendered',{...payload,items:[payload.items[0],{...payload.items[1],completedAt:completed-1}]})).ok,false);assert.equal(saves,0);
  const before=structuredClone(h.store.data.messages.map(message=>message.timing));await assert.rejects(h.call('response-rendered',payload),/batch disk full/);assert.deepEqual(structuredClone(h.store.data.messages.map(message=>message.timing)),before);
  h.store.saveAsync=async()=>{saves++;};assert.equal((await h.call('response-rendered',payload)).ok,true);assert.equal(saves,2);assert.ok(h.store.data.messages.every(message=>message.timing.renderedAt!==undefined));
});

test('render batches and compatible single acknowledgements reject owner changes while waiting for storage',async t=>{
  for(const mode of ['conversation','array','target','id','timing','generation','frame','hidden','history','lock','suspend','storage','destroyed','quit','single-conversation']){
    const h=mainHarness(t),completed=performance.timeOrigin+performance.now()-100;
    h.store.data.messages=[{id:'same-id',role:'assistant',text:'old owner',status:'completed',timing:{completedAt:completed,submittedAt:completed-100}}];h.store.save();let saves=0,release;
    const original=h.store.data.messages[0],item={id:'same-id',completedAt:completed,renderedAt:performance.timeOrigin+performance.now()};h.store.saveAsync=async()=>{saves++;};
    assert.equal((await h.call('response-rendered',{conversationId:'another-conversation',items:[item]})).ok,false);assert.equal(saves,0);
    h.store.saving=new Promise(resolve=>{release=resolve;});const pending=h.call('response-rendered',mode==='single-conversation'?{id:item.id,renderedAt:item.renderedAt}:{conversationId:h.store.data.activeConversationId,items:[item]});
    if(mode==='conversation'||mode==='single-conversation')h.store.data.activeConversationId='another-conversation';
    else if(mode==='array')h.store.data.messages=[{...original,timing:{...original.timing}}];
    else if(mode==='target')h.store.data.messages[0]={...original,timing:{...original.timing}};
    else if(mode==='id')original.id='changed-id';
    else if(mode==='timing')original.timing={...original.timing};
    else if(mode==='generation')h.context.testPanel.renderGeneration=1;
    else if(mode==='frame')h.context.testPanel.webContents.mainFrame={};
    else if(mode==='hidden')h.context.testPanel.isVisible=()=>false;
    else if(mode==='history')h.context.testPanel.activeTab='history';
    else if(mode==='destroyed')h.context.testPanel.isDestroyed=()=>true;
    else vm.runInContext(({lock:'screenLocked=true;',suspend:'systemSuspended=true;',storage:'storageBusy=true;',quit:'quitting=true;'})[mode],h.context);
    h.store.saving=null;release();assert.equal((await pending).ok,false,mode);assert.equal(saves,0,mode);assert.equal(original.timing.renderedAt,undefined,mode);assert.equal(h.store.data.messages[0].timing.renderedAt,undefined,mode);
  }
});

test('renderer acknowledgement batches cap payloads and preserve newer tokens across stale frames and failed requests',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('function acknowledgeRenderedMessages()'),body=source.slice(start,source.indexOf('\nfunction renderHistory()',start));
  for(const mode of ['bounded','stale-frame','image-pending','failed-request','new-owner']){
    const frames=[],calls=[],messages=Array.from({length:mode==='bounded'?205:1},(_,index)=>({id:'reply-'+index,role:'assistant',status:'completed',timing:{completedAt:1}})),cards=new Map(messages.map(message=>[message.id,{getClientRects:()=>[{}],querySelector:()=>null}])),tokens=new Map();let resolve;
    const context=vm.createContext({surface:'panel',activeTab:'chat',state:{activeConversationId:'owned',panelVisible:true,messages},document:{hidden:false},messageCards:cards,renderAckIds:tokens,requestAnimationFrame:callback=>frames.push(callback),performance,act:(action,payload)=>{calls.push({action,payload});return mode==='failed-request'||mode==='new-owner'?new Promise(done=>{resolve=done;}):Promise.resolve({ok:true});}});
    vm.runInContext(body+'\nacknowledgeRenderedMessages();',context);
    if(mode==='stale-frame'){context.state.activeConversationId='another';tokens.clear();}
    if(mode==='image-pending')messages[0].images=[{status:'pending'}];
    const newer={conversationId:'another',card:{},completedAt:2};if(mode==='stale-frame')tokens.set('reply-0',newer);
    while(frames.length){const pending=frames.shift()();if(resolve){if(mode==='new-owner')tokens.set('reply-0',newer);resolve({ok:false});resolve=null;}await pending;}
    if(mode==='bounded'){assert.deepEqual(calls.map(call=>call.payload.items.length),[100,100,5]);assert.equal(new Set(calls.flatMap(call=>call.payload.items.map(item=>item.id))).size,205);}
    else if(mode==='stale-frame'){assert.equal(calls.length,0);assert.equal(tokens.get('reply-0'),newer);}
    else if(mode==='image-pending'){assert.equal(calls.length,0);assert.equal(tokens.size,0);}
    else if(mode==='new-owner'){assert.equal(calls.length,1);assert.equal(tokens.get('reply-0'),newer);}
    else{assert.equal(calls.length,1);assert.equal(tokens.size,0);vm.runInContext('acknowledgeRenderedMessages()',context);assert.equal(tokens.size,1);}
  }
});

test('message rendering skips unchanged objects while preserving replacements, text, names and timing settings',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('  let previousCard=null;'),body=source.slice(start,source.indexOf('\n  if (!state.messages.length) messages.scrollTop',start));
  const cards=new Map(),children=new Map(),replaced=[];let metadataSerializations=0;
  for(const id of ['first','second']){
    const nodes=new Map();
    for(const selector of ['.message-label','.message-body','.message-images','.message-attachments','.message-error','.message-progress','.message-tools span','.message-tools button'])nodes.set(selector,{dataset:{},textContent:'',classList:{toggle(){}},querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){},append(){}});
    const text=nodes.get('.message-body');text.replaceChildren=fragment=>{text.textContent=fragment.textContent;replaced.push(id);};text.append=child=>nodes.set('.response-timing',child);text.querySelector=selector=>nodes.get(selector)??null;
    nodes.get('.message-progress').querySelector=()=>({textContent:''});
    cards.set(id,{dataset:{},classList:{toggle(){}},querySelector:selector=>nodes.get(selector),after(next){next.previousElementSibling=this;}});children.set(id,nodes);
  }
  const messages=['first','second'].map(id=>({id,role:'assistant',text:id+' original',status:'completed',timing:{completedAt:1,totalMs:25}}));
  const context=vm.createContext({state:{messages,settings:{measureResponseTime:false}},renderedMessages:messages,messageCards:cards,buddyName:'옹기',JSON:{stringify:value=>{if(value?.id)metadataSerializations++;return JSON.stringify(value);}},DOMPurify:{sanitize:fragment=>fragment},markdown:{render:text=>({textContent:text,querySelectorAll:()=>[]})},document:{createElement:()=>({textContent:'',remove(){}})}});
  vm.runInContext('function renderMessages(){\n'+body+'\n}\nrenderMessages();',context);
  assert.equal(metadataSerializations,2);assert.deepEqual(replaced,['first','second']);
  metadataSerializations=0;replaced.length=0;vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,0);assert.equal(replaced.length,0);
  messages[0]={...messages[0]};vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,1);assert.equal(replaced.length,0);assert.equal(cards.get('first').renderedMessage,messages[0]);
  metadataSerializations=0;vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,0);
  messages[1]={...messages[1],text:'changed reply'};vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,1);assert.deepEqual(replaced,['second']);assert.equal(children.get('second').get('.message-body').textContent,'changed reply');
  metadataSerializations=0;context.buddyName='새 버디';vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,2);assert.equal(children.get('first').get('.message-label').textContent,'새 버디');assert.equal(children.get('second').get('.message-label').textContent,'새 버디');
  metadataSerializations=0;context.state.settings.measureResponseTime=true;vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,2);assert.match(children.get('first').get('.response-timing').textContent,/수신 대답속도 측정/);
  metadataSerializations=0;vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,0);
  messages[0]={...messages[0],status:'failed',error:'connection lost'};vm.runInContext('renderMessages()',context);assert.equal(metadataSerializations,1);assert.equal(cards.get('first').dataset.status,'failed');assert.equal(children.get('first').get('.message-error').textContent,'connection lost');assert.equal(children.get('first').get('.message-tools span').textContent,'연결 또는 작업 실패');
});

test('deferred state publishing tolerates destroyed panels and stops after shutdown begins',t=>{
  const h=mainHarness(t);h.context.testPanel.isDestroyed=()=>true;h.context.testPanel.isVisible=()=>{throw Error('destroyed panel must never be queried');};
  assert.doesNotThrow(()=>h.publish());vm.runInContext('quitting=true;',h.context);assert.doesNotThrow(()=>h.timers.at(-1).fn());
});

test('simple mode selects the delivered assistant and hides after thirty seconds with timing disabled',async t=>{
  const h=mainHarness(t),payloads=[];let visible=true,now=100000,hidden=0;
  h.context.Date=class extends Date{static now(){return now;}};
  Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat',isVisible:()=>visible,hide(){visible=false;hidden++;}});
  h.context.testPanel.webContents.send=(channel,payload)=>{if(channel==='state')payloads.push(payload);};
  h.store.data.messages=[{id:'delivered',role:'assistant',text:'saved answer',status:'completed'},{id:'queued-user',role:'user',text:'next question',status:'queued'},{id:'queued-reply',role:'assistant',text:'',status:'queued'}];h.store.save();
  const messages=h.store.data.messages;h.publish();assert.equal(payloads.at(-1).simpleReplyId,'delivered');assert.deepEqual(Array.from(payloads.at(-1).messagePatch.ids),['delivered']);assert.equal(h.store.data.settings.measureResponseTime,false);assert.equal(messages[0].timing,undefined);
  const payload={conversationId:h.store.data.activeConversationId,generation:payloads.at(-1).simpleDisplayGeneration,replyId:'delivered',ready:true,protected:false};
  assert.equal((await h.call('simple-state',payload)).ready,true);h.publish();const timer=h.timers.findLast(item=>item.ms===30000&&!item.cleared);
  assert.ok(timer);assert.equal(payloads.at(-1).simpleHideDeadline,now+30000);now+=29999;h.publish();assert.equal(hidden,0);assert.equal(payloads.at(-1).simpleHideDeadline,100000+30000);
  now++;timer.fn();assert.equal(hidden,1);assert.equal(h.store.data.messages,messages);assert.equal(messages[0].text,'saved answer');assert.equal(messages[1].status,'queued');
});

test('canceling all queued questions preserves the delivered simple reply and retains meaningful interruptions',async t=>{
  const h=mainHarness(t),payloads=[];
  Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat'});h.context.testPanel.webContents.send=(channel,payload)=>{if(channel==='state')payloads.push(payload);};
  h.store.data.messages=[{id:'delivered',role:'assistant',text:'saved answer',status:'completed'},{id:'queued-user',role:'user',text:'next question',status:'queued'},{id:'queued-reply',role:'assistant',text:'',status:'queued'}];h.store.save();
  vm.runInContext("queue=[{id:'queued-user',replyId:'queued-reply',text:'next question',selection:{modelName:'test'}}];",h.context);h.publish();assert.equal(payloads.at(-1).simpleReplyId,'delivered');
  const result=await h.call('cancel-all-queued',{});assert.equal(result.count,1);assert.equal(vm.runInContext('queue.length',h.context),0);h.publish();
  assert.equal(payloads.at(-1).simpleReplyId,'delivered');assert.deepEqual(Array.from(payloads.at(-1).messagePatch.ids),['delivered']);
  const saved=new Store(h.root,{});assert.equal(saved.data.messages.length,3);assert.equal(saved.data.messages[1].status,'interrupted');assert.equal(saved.data.messages[2].status,'interrupted');assert.equal(saved.data.messages[2].text,'');
  const reply=h.store.data.messages[2];
  for(const meaningful of [{text:'partial answer'},{images:[{id:'partial-image',status:'ready'}]},{error:'interrupted while delivering'}]){
    delete reply.images;delete reply.error;reply.text='';Object.assign(reply,meaningful);h.publish();assert.equal(payloads.at(-1).simpleReplyId,'queued-reply');assert.deepEqual(Array.from(payloads.at(-1).messagePatch.ids),['queued-reply']);
  }
});

test('simple input protection bypasses pending storage and resumes with a fresh deadline',async t=>{
  const h=mainHarness(t),payloads=[];let now=100000,hidden=0;
  h.context.Date=class extends Date{static now(){return now;}};
  Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat',hide(){hidden++;}});h.context.testPanel.webContents.send=(channel,payload)=>{if(channel==='state')payloads.push(payload);};
  h.store.data.messages=[{id:'reply',role:'assistant',text:'answer',status:'completed'}];h.store.save();h.publish();
  const payload={conversationId:h.store.data.activeConversationId,generation:payloads.at(-1).simpleDisplayGeneration,replyId:'reply',ready:true,protected:false};await h.call('simple-state',payload);h.publish();const old=h.timers.findLast(item=>item.ms===30000&&!item.cleared);
  now+=1000;h.store.saving=new Promise(()=>{});assert.equal((await h.call('simple-state',{...payload,ready:false,protected:true})).ok,true);assert.equal(old.cleared,true);assert.equal(vm.runInContext('simpleHideDeadline',h.context),null);
  h.store.saving=null;h.publish();now+=10000;old.fn();assert.equal(hidden,0);
  await h.call('simple-state',{...payload,ready:false,protected:false});h.publish();const next=h.timers.findLast(item=>item.ms===30000&&!item.cleared);
  assert.notEqual(next,old);assert.equal(vm.runInContext('simpleHideDeadline',h.context),now+30000);old.fn();assert.equal(hidden,0);now+=30000;next.fn();assert.equal(hidden,1);
});

test('rearmed simple deadlines reject a canceled timer even when the wall-clock deadline is identical',async t=>{
  const h=mainHarness(t);let now=100000,hidden=0;h.context.Date=class extends Date{static now(){return now;}};
  Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat',hide(){hidden++;}});h.context.testPanel.webContents.send=()=>{};
  h.store.data.messages=[{id:'reply',role:'assistant',text:'answer',status:'completed'}];h.store.save();h.publish();
  const payload={conversationId:h.store.data.activeConversationId,generation:h.context.testPanel.simpleDisplayGeneration,replyId:'reply',ready:true,protected:false};await h.call('simple-state',payload);h.publish();const original=h.timers.findLast(item=>item.ms===30000&&!item.cleared),deadline=vm.runInContext('simpleHideDeadline',h.context);
  await h.call('simple-state',{...payload,ready:false,protected:true});await h.call('simple-state',{...payload,ready:false,protected:false});h.publish();
  const rearmed=h.timers.findLast(item=>item.ms===30000&&!item.cleared);assert.notEqual(rearmed,original);assert.equal(vm.runInContext('simpleHideDeadline',h.context),deadline);
  now+=30000;original.fn();assert.equal(hidden,0);assert.equal(vm.runInContext('simpleHideDeadline',h.context),deadline);rearmed.fn();assert.equal(hidden,1);
});

test('simple delivery refuses unfinished images and failed storage without using measured timing',async t=>{
  for(const condition of ['pending-image','error','running','saving','write-blocked']){
    const h=mainHarness(t);Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat'});h.context.testPanel.webContents.send=()=>{};
    h.store.data.messages=[{id:'reply',role:'assistant',text:'answer',status:condition==='running'?'running':'completed',...(condition==='pending-image'?{images:[{itemId:'image',status:'pending'}]}:{}),...(condition==='error'?{error:'could not save answer'}:{})}];h.store.save();h.publish();
    if(condition==='saving')h.store.saving=new Promise(()=>{});if(condition==='write-blocked')h.store.writeBlocked=true;
    const result=await h.call('simple-state',{conversationId:h.store.data.activeConversationId,generation:h.context.testPanel.simpleDisplayGeneration,replyId:'reply',ready:true,protected:false});
    assert.equal(Boolean(result.ready),false,condition);h.publish();assert.equal(vm.runInContext('simpleHideDeadline',h.context),null,condition);h.store.saving=null;h.store.writeBlocked=false;
  }
});

test('simple hide checks main work, approvals, attachments and errors again when its timer fires',async t=>{
  for(const condition of ['current','queue','approval','editing','picking','preparing','history','warning','storage','saving','blocked','draft-attachment','lock','suspend']){
    const h=mainHarness(t);let now=100000,hidden=0;h.context.Date=class extends Date{static now(){return now;}};
    Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat',hide(){hidden++;}});h.context.testPanel.webContents.send=()=>{};
    h.store.data.messages=[{id:'reply',role:'assistant',text:'answer',status:'completed'}];h.store.save();h.publish();
    await h.call('simple-state',{conversationId:h.store.data.activeConversationId,generation:h.context.testPanel.simpleDisplayGeneration,replyId:'reply',ready:true,protected:false});h.publish();const timer=h.timers.findLast(item=>item.ms===30000&&!item.cleared);assert.ok(timer,condition);
    if(condition==='saving')h.store.saving=new Promise(()=>{});else if(condition==='blocked')h.store.writeBlocked=true;
    else vm.runInContext(({current:"current={replyId:'reply'};",queue:"queue=[{id:'queued',text:'next',selection:{}}];",approval:"requests=[{id:'request'}];",editing:"queueEdit={id:'edit'};",picking:'attachmentPicking=true;',preparing:'preparing=1;',history:'historyLoading=true;',warning:"historyWarning='important error';",storage:'storageBusy=true;','draft-attachment':"pendingAttachments.set('attachment',{conversationId:store.data.activeConversationId});",lock:'screenLocked=true;',suspend:'systemSuspended=true;'})[condition],h.context);
    now+=30000;timer.fn();assert.equal(hidden,0,condition);assert.equal(vm.runInContext('simpleHideDeadline',h.context),null,condition);h.store.saving=null;h.store.writeBlocked=false;
  }
});

test('simple reply refresh and ownership changes invalidate old rendered acknowledgements',async t=>{
  for(const condition of ['text','error','image','conversation','generation','hidden','history','lock','suspend','reload']){
    const h=mainHarness(t);Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:true,activeTab:'chat'});h.context.testPanel.webContents.send=()=>{};
    h.store.data.messages=[{id:'reply',role:'assistant',text:'original',status:'completed'}];h.store.save();h.publish();
    const payload={conversationId:h.store.data.activeConversationId,generation:h.context.testPanel.simpleDisplayGeneration,replyId:'reply',ready:true,protected:false};await h.call('simple-state',payload);h.publish();const oldGeneration=payload.generation;
    if(condition==='text')h.store.data.messages[0].text='refreshed same-ID answer';
    else if(condition==='error')h.store.data.messages[0].error='important failure';
    else if(condition==='image')h.store.data.messages[0].images=[{itemId:'image',status:'pending'}];
    else if(condition==='conversation')h.store.data.activeConversationId='another';
    else if(condition==='generation')h.context.testPanel.simpleDisplayGeneration++;
    else if(condition==='hidden')h.context.testPanel.isVisible=()=>false;
    else if(condition==='history')h.context.testPanel.activeTab='history';
    else if(condition==='reload')h.context.testPanel.rendererReady=false;
    else vm.runInContext(condition==='lock'?'screenLocked=true;':'systemSuspended=true;',h.context);
    h.publish();assert.equal((await h.call('simple-state',payload)).ok,false,condition);
    if(['text','error','image','conversation'].includes(condition))assert.ok(h.context.testPanel.simpleDisplayGeneration>oldGeneration,condition);
    if(condition==='text')assert.equal(h.context.testPanel.simpleReady,false);
  }
});

test('simple renderer waits for visible previews and preserves newer owners across two frames and IPC failure',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('function acknowledgeRenderedMessages()'),body=source.slice(start,source.indexOf('\nfunction renderHistory()',start));
  for(const mode of ['image-wait','failed-preview','late-image','new-generation','new-owner','failed-request','draft','composition','popover']){
    const frames=[],calls=[],bounds={top:0,bottom:100,left:0,right:100},preview={dataset:{},complete:mode!=='image-wait',naturalWidth:mode==='image-wait'?0:2,getBoundingClientRect:()=>bounds},message={id:'reply',role:'assistant',status:'completed',images:[{status:'ready'}]},card={getClientRects:()=>[{}],querySelectorAll:()=>[preview]},state={activeConversationId:'owned',simpleDisplayGeneration:7,simpleReplyId:'reply',compactMode:true,panelVisible:true,messages:[message]},cards=new Map([['reply',card]]);let resolve;
    if(mode==='failed-preview'){preview.complete=false;preview.naturalWidth=0;preview.dataset.failed='true';}
    const context=vm.createContext({surface:'panel',activeTab:'chat',state,messageCards:cards,messageCache:new Map([['reply',message]]),simpleDisplayAck:null,renderAckIds:new Map(),composerComposing:mode==='composition',queueEditingUI:null,queueEditOpening:null,submitting:false,pickingAttachments:false,attachmentDrafts:new Map(),document:{hidden:false,querySelector:id=>id==='#messages'?{getBoundingClientRect:()=>({top:0,bottom:400,left:0,right:400})}:id==='#prompt'?{value:mode==='draft'?'unsent question':''}:{matches:()=>mode==='popover'&&id==='#composer-popover'}},requestAnimationFrame:callback=>frames.push(callback),performance,act:(action,payload)=>{calls.push({action,payload});return mode==='failed-request'?new Promise(done=>{resolve=done;}):Promise.resolve({ok:true,ready:true});}});
    vm.runInContext(body+'\nacknowledgeRenderedMessages();',context);
    if(mode==='image-wait'){assert.equal(frames.length,0);preview.complete=true;preview.naturalWidth=2;vm.runInContext('acknowledgeRenderedMessages()',context);}
    const newer={conversationId:'another',generation:8,replyId:'reply',card:{}};
    if(mode==='new-owner')context.simpleDisplayAck=newer;
    else if(mode==='new-generation')state.simpleDisplayGeneration++;
    else if(mode==='late-image'){preview.complete=false;preview.naturalWidth=0;}
    while(frames.length){const pending=frames.shift()();if(resolve){context.simpleDisplayAck=newer;resolve({ok:false,ready:false});resolve=null;}await pending;}
    if(['late-image','new-generation','new-owner'].includes(mode))assert.equal(calls.length,0,mode);else assert.equal(calls.length,1,mode);
    if(mode==='new-owner'||mode==='failed-request')assert.equal(context.simpleDisplayAck,newer,mode);
    else if(mode==='late-image'||mode==='new-generation')assert.equal(context.simpleDisplayAck,null,mode);
    if(['draft','composition','popover'].includes(mode))assert.equal(calls[0].payload.protected,true,mode);
    if(mode==='image-wait'||mode==='failed-preview')assert.equal(calls[0].payload.ready,true,mode);
  }
});

test('long simple answers still send bounded input protection and composition state',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('function renderDraftAttachments()'),body=source.slice(start,source.indexOf('\nfunction acknowledgeRenderedMessages()',start));
  for(const mode of ['draft','composition','menu']){
    const nodes=new Map(),calls=[];for(const id of ['#prompt','#draft-attachments','#queue-edit-banner','#queue-edit-label','#cancel-queue-edit','#send','#task-purpose','#task-skill','#refresh-skills','#attach-image','#attach-file','#paste-image','#queue-bar .queue-cancel-all','#composer-popover','#model-popover','#composer','.mini-header','#queue-bar','#requests','#connection-help','#history-warning'])nodes.set(id,{value:id==='#prompt'&&mode==='draft'?'keep my question':'',dataset:{},offsetHeight:id==='#composer'?120:24,matches:()=>mode==='menu'&&id==='#composer-popover',replaceChildren(){}});
    const context=vm.createContext({state:{activeConversationId:'owned',compactMode:true,panelVisible:true,simpleReplyId:'reply',simpleDisplayGeneration:3,settings:{miniSize:'small'}},messageCards:new Map([['reply',{scrollHeight:100000}]]),attachmentDrafts:new Map(),composerComposing:mode==='composition',composerProtectionSignature:'',queueEditOpening:null,queueEditingUI:null,submitting:false,pickingAttachments:false,document:{querySelector:id=>nodes.get(id),querySelectorAll:()=>[]},act:(action,payload)=>{calls.push({action,payload});return Promise.resolve({ok:true});}});
    vm.runInContext(body+'\nrenderDraftAttachments();',context);assert.equal(calls.length,1,mode);assert.equal(calls[0].action,'simple-state');assert.equal(calls[0].payload.protected,true,mode);assert.ok(Number.isFinite(calls[0].payload.contentHeight)&&calls[0].payload.contentHeight>0&&calls[0].payload.contentHeight<=4096,mode);
    assert.equal(nodes.get('#prompt').value,mode==='draft'?'keep my question':'',mode);
  }
});

test('all four detailed resize corners clamp bounds and keep their opposite corner fixed',async t=>{
  for(const corner of ['nw','ne','sw','se']){
    const h=mainHarness(t);let bounds={x:100,y:100,width:460,height:650},changes=0;
    Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,simpleDisplayGeneration:1,compactMode:false,activeTab:'chat',getBounds:()=>({...bounds}),setBounds:next=>{bounds={...next};changes++;}});
    const old={...bounds},session=await h.call('resize-start',{corner,x:500,y:500});assert.equal(session.ok,true);
    const result=await h.call('resize-move',{token:session.token,x:corner.includes('w')?-100000:100000,y:corner.includes('n')?-100000:100000});assert.equal(result.ok,true);
    assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1200&&bounds.y+bounds.height<=900);assert.ok(bounds.width>=390&&bounds.height>=580);
    assert.equal(corner.includes('w')?bounds.x+bounds.width:bounds.x,corner.includes('w')?old.x+old.width:old.x);assert.equal(corner.includes('n')?bounds.y+bounds.height:bounds.y,corner.includes('n')?old.y+old.height:old.y);
    assert.equal(changes,1);assert.equal((await h.call('resize-end',{token:session.token})).ok,true);assert.equal((await h.call('resize-move',{token:session.token,x:500,y:500})).ok,false);assert.equal(changes,1);
  }
});

test('resize sessions reject invalid coordinates, stale tokens and changed display or frame ownership',async t=>{
  for(const condition of ['new-session','tab','reload','hidden','compact','lock','suspend','display']){
    const h=mainHarness(t);let bounds={x:100,y:100,width:460,height:650},changes=0;
    Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,simpleDisplayGeneration:1,compactMode:false,activeTab:'chat',getBounds:()=>({...bounds}),setBounds:next=>{bounds={...next};changes++;}});
    for(const value of [NaN,Infinity,-Infinity,100001])await assert.rejects(h.call('resize-start',{corner:'se',x:value,y:500}),/좌표/);
    await assert.rejects(h.call('resize-start',{corner:'invalid',x:500,y:500}),/좌표/);
    const start=await h.call('resize-start',{corner:'se',x:500,y:500});await assert.rejects(h.call('resize-move',{token:start.token,x:NaN,y:500}),/좌표/);assert.equal(changes,0);
    if(condition==='new-session'){const newer=await h.call('resize-start',{corner:'nw',x:100,y:100});assert.notEqual(newer.token,start.token);}
    else if(condition==='tab')await h.call('panel-tab',{tab:'history'});
    else if(condition==='reload'){h.context.testPanel.renderGeneration++;h.context.testPanel.webContents.mainFrame={};}
    else if(condition==='hidden')h.context.testPanel.isVisible=()=>false;
    else if(condition==='compact')h.context.testPanel.compactMode=true;
    else if(condition==='display')h.electron.screen.getDisplayMatching=()=>({workArea:{x:0,y:0,width:900,height:700}});
    else vm.runInContext(condition==='lock'?'screenLocked=true;':'systemSuspended=true;',h.context);
    assert.equal((await h.call('resize-move',{token:start.token,x:600,y:600})).ok,false,condition);assert.equal(changes,0,condition);
  }
  const h=mainHarness(t),sender=h.context.testPet.webContents;await assert.rejects(h.call('resize-start',{corner:'se',x:500,y:500},{sender,senderFrame:sender.mainFrame}),/상세 대화창/);
});

test('full resize remains owned across answer updates while renderer hides and tab switches release captures',async t=>{
  const h=mainHarness(t);let bounds={x:100,y:100,width:460,height:650};Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,simpleDisplayGeneration:1,compactMode:false,activeTab:'chat',getBounds:()=>({...bounds}),setBounds:next=>{bounds={...next};}});
  const started=await h.call('resize-start',{corner:'se',x:500,y:500});h.context.testPanel.simpleDisplayGeneration++;
  assert.equal((await h.call('resize-move',{token:started.token,x:600,y:600})).ok,true);assert.equal(bounds.width,560);assert.equal(bounds.height,750);
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf('  const compactChanged='),body=source.slice(start,source.indexOf('\n  if(next.characterPack)',start));
  for(const mode of ['answer-update','compact','hidden','locked']){
    const calls=[];let released=0;const gesture={token:'owned',pointerId:1,target:{hasPointerCapture:()=>true,releasePointerCapture:()=>released++}},context=vm.createContext({state:{compactMode:false,simpleDisplayGeneration:1},next:{compactMode:mode==='compact',panelVisible:mode!=='hidden',screenLocked:mode==='locked',simpleDisplayGeneration:2},resizeGesture:gesture,simpleDisplayAck:{},composerProtectionSignature:'old',act:(action,payload)=>calls.push({action,payload})});
    vm.runInContext(body,context);assert.equal(context.simpleDisplayAck,null,mode);
    if(mode==='answer-update'){assert.equal(context.resizeGesture,gesture);assert.equal(released,0);assert.equal(calls.length,0);}
    else{assert.equal(context.resizeGesture,null,mode);assert.equal(released,1,mode);assert.equal(calls[0].action,'resize-end');}
  }
});

test('small-display resizing preserves opposite corners and refuses starts outside the work area',async t=>{
  for(const corner of ['nw','ne','sw','se']){
    const h=mainHarness(t),area={x:0,y:0,width:320,height:450};let bounds={x:12,y:12,width:296,height:426};h.electron.screen.getDisplayMatching=()=>({workArea:area});
    Object.assign(h.context.testPanel,{rendererReady:true,renderGeneration:1,compactMode:false,activeTab:'chat',getBounds:()=>({...bounds}),setBounds:next=>{bounds={...next};}});
    const original={...bounds},session=await h.call('resize-start',{corner,x:200,y:200});assert.equal(session.ok,true);
    const shrunk=await h.call('resize-move',{token:session.token,x:corner.includes('w')?300:100,y:corner.includes('n')?300:100});assert.equal(shrunk.ok,true);assert.deepEqual(bounds,original,corner);
    await h.call('resize-move',{token:session.token,x:corner.includes('w')?-100000:100000,y:corner.includes('n')?-100000:100000});assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=area.width&&bounds.y+bounds.height<=area.height,corner);
    assert.equal(corner.includes('w')?bounds.x+bounds.width:bounds.x,corner.includes('w')?original.x+original.width:original.x);assert.equal(corner.includes('n')?bounds.y+bounds.height:bounds.y,corner.includes('n')?original.y+original.height:original.y);
    await h.call('resize-end',{token:session.token});bounds={x:400,y:12,width:296,height:426};assert.equal((await h.call('resize-start',{corner,x:500,y:200})).ok,false,corner);
  }
});

test('retargeted resize move and release events finish the owned gesture and permit the next corner',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf("for(const corner of ['nw','ne','sw','se'])"),body=source.slice(start,source.indexOf("\ndocument.addEventListener('keydown'",start));
  for(const endEvent of ['pointerup','pointercancel','lostpointercapture']){
    const handles=new Map(),handlers=new Map(),documentEvents=new Map(),frames=[],calls=[];let starts=0;
    for(const corner of ['nw','ne','sw','se']){const captured=new Set();handles.set('#resize-'+corner,{captured,addEventListener:(name,handler)=>handlers.set(corner+':'+name,handler),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)});}
    const context=vm.createContext({surface:'panel',state:{compactMode:false},resizeGesture:null,window:{},document:{querySelector:id=>handles.get(id)??null,addEventListener:(name,handler,capture)=>documentEvents.set(name,{handler,capture})},requestAnimationFrame:callback=>frames.push(callback),act:(action,payload)=>{calls.push({action,payload});return Promise.resolve(action==='resize-start'?{ok:true,token:'token-'+(++starts)}:{ok:true});}});
    vm.runInContext(body,context);const down={button:0,buttons:0,pointerId:1,screenX:500,screenY:500,preventDefault(){}};
    await handlers.get('nw:pointerdown')(down);const first=context.resizeGesture;assert.ok(first);
    documentEvents.get('pointermove').handler({pointerId:2,screenX:900,screenY:900,target:{id:'outside'}});documentEvents.get(endEvent).handler({pointerId:2,screenX:900,screenY:900,target:{id:'outside'}});assert.equal(context.resizeGesture,first);assert.equal(frames.length,0);assert.equal(calls.length,1);
    documentEvents.get('pointermove').handler({pointerId:1,screenX:450,screenY:450,target:{id:'outside'}});assert.equal(frames.length,1);await frames.shift()();assert.equal(calls.at(-1).action,'resize-move');assert.equal(calls.at(-1).payload.x,450);
    assert.equal(documentEvents.get(endEvent).capture,true);documentEvents.get(endEvent).handler({pointerId:1,screenX:440,screenY:430,target:{id:''}});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(context.resizeGesture,null,endEvent);assert.equal(handles.get('#resize-nw').hasPointerCapture(1),false,endEvent);assert.equal(calls.at(-1).action,'resize-end');assert.equal(calls.at(-1).payload.token,'token-1');
    if(endEvent==='pointerup'){const finalMove=calls.filter(call=>call.action==='resize-move').at(-1);assert.equal(finalMove.payload.x,440);assert.equal(finalMove.payload.y,430);}else assert.equal(calls.filter(call=>call.action==='resize-move').length,1);
    const before=calls.length;documentEvents.get(endEvent).handler({pointerId:1,screenX:440,screenY:430,target:{id:''}});assert.equal(calls.length,before);
    await handlers.get('ne:pointerdown')(down);assert.equal(starts,2,endEvent);assert.equal(context.resizeGesture.token,'token-2');documentEvents.get('pointercancel').handler({pointerId:1,target:{id:''}});await new Promise(resolve=>setImmediate(resolve));assert.equal(context.resizeGesture,null);
  }
});

test('a retargeted release during pending resize admission cannot clear a newer gesture',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf("for(const corner of ['nw','ne','sw','se'])"),body=source.slice(start,source.indexOf("\ndocument.addEventListener('keydown'",start)),handles=new Map(),handlers=new Map(),documentEvents=new Map(),calls=[];let resolve,starts=0;
  for(const corner of ['nw','ne','sw','se']){const captured=new Set();handles.set('#resize-'+corner,{addEventListener:(name,handler)=>handlers.set(corner+':'+name,handler),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)});}
  const context=vm.createContext({surface:'panel',state:{compactMode:false},resizeGesture:null,window:{},document:{querySelector:id=>handles.get(id)??null,addEventListener:(name,handler)=>documentEvents.set(name,handler)},requestAnimationFrame:()=>{},act:(action,payload)=>{calls.push({action,payload});if(action==='resize-start'&&++starts===1)return new Promise(done=>{resolve=done;});return Promise.resolve(action==='resize-start'?{ok:true,token:'new-token'}:{ok:true});}});
  vm.runInContext(body,context);const down={button:0,pointerId:1,screenX:500,screenY:500,preventDefault(){}},pending=handlers.get('nw:pointerdown')(down);assert.ok(context.resizeGesture);
  documentEvents.get('pointerup')({pointerId:1,screenX:550,screenY:550,target:{id:''}});assert.equal(context.resizeGesture,null);assert.equal(handles.get('#resize-nw').hasPointerCapture(1),false);
  await handlers.get('ne:pointerdown')(down);const newer=context.resizeGesture;assert.equal(newer.token,'new-token');resolve({ok:true,token:'old-token'});await pending;assert.equal(context.resizeGesture,newer);assert.ok(calls.some(call=>call.action==='resize-end'&&call.payload.token==='old-token'));
  documentEvents.get('pointercancel')({pointerId:1,target:{id:''}});await new Promise(done=>setImmediate(done));assert.equal(context.resizeGesture,null);assert.ok(calls.some(call=>call.action==='resize-end'&&call.payload.token==='new-token'));
});

test('a fast normal resize release applies its final point after start acknowledgement',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf("for(const corner of ['nw','ne','sw','se'])"),body=source.slice(start,source.indexOf("\ndocument.addEventListener('keydown'",start)),handles=new Map(),handlers=new Map(),documentEvents=new Map(),calls=[];let resolve;
  for(const corner of ['nw','ne','sw','se']){const captured=new Set();handles.set('#resize-'+corner,{addEventListener:(name,handler)=>handlers.set(corner+':'+name,handler),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)});}
  const context=vm.createContext({surface:'panel',state:{compactMode:false},resizeGesture:null,window:{},document:{querySelector:id=>handles.get(id)??null,addEventListener:(name,handler)=>documentEvents.set(name,handler)},requestAnimationFrame:()=>{},act:(action,payload)=>{calls.push({action,payload});return action==='resize-start'?new Promise(done=>{resolve=done;}):Promise.resolve({ok:true});}});
  vm.runInContext(body,context);const pending=handlers.get('nw:pointerdown')({button:0,buttons:0,pointerId:1,screenX:500,screenY:500,preventDefault(){}});
  documentEvents.get('pointermove')({pointerId:1,screenX:480,screenY:480,target:{id:''}});documentEvents.get('pointerup')({pointerId:1,screenX:450,screenY:430,target:{id:''}});assert.equal(context.resizeGesture,null);assert.equal(calls.length,1);
  resolve({ok:true,token:'owned'});await pending;assert.deepEqual(calls.map(call=>call.action),['resize-start','resize-move','resize-end']);assert.equal(calls[1].payload.x,450);assert.equal(calls[1].payload.y,430);assert.ok(calls.slice(1).every(call=>call.payload.token==='owned'));assert.equal(handles.get('#resize-nw').hasPointerCapture(1),false);
});

test('canceled or lost pending resize admissions end without applying a late move',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),start=source.indexOf("for(const corner of ['nw','ne','sw','se'])"),body=source.slice(start,source.indexOf("\ndocument.addEventListener('keydown'",start));
  for(const eventName of ['pointercancel','lostpointercapture']){
    const handles=new Map(),handlers=new Map(),documentEvents=new Map(),calls=[];let resolve;
    for(const corner of ['nw','ne','sw','se']){const captured=new Set();handles.set('#resize-'+corner,{addEventListener:(name,handler)=>handlers.set(corner+':'+name,handler),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)});}
    const context=vm.createContext({surface:'panel',state:{compactMode:false},resizeGesture:null,window:{},document:{querySelector:id=>handles.get(id)??null,addEventListener:(name,handler)=>documentEvents.set(name,handler)},requestAnimationFrame:()=>{},act:(action,payload)=>{calls.push({action,payload});return action==='resize-start'?new Promise(done=>{resolve=done;}):Promise.resolve({ok:true});}});
    vm.runInContext(body,context);const pending=handlers.get('nw:pointerdown')({button:0,pointerId:1,screenX:500,screenY:500,preventDefault(){}});documentEvents.get('pointermove')({pointerId:1,screenX:480,screenY:480,target:{id:''}});documentEvents.get(eventName)({pointerId:1,screenX:450,screenY:430,target:{id:''}});
    resolve({ok:true,token:'owned'});await pending;assert.deepEqual(calls.map(call=>call.action),['resize-start','resize-end'],eventName);assert.equal(context.resizeGesture,null);assert.equal(handles.get('#resize-nw').hasPointerCapture(1),false);
  }
});

test('opening a composer or model popover survives initial simple-height and later viewport resize',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),elements=new Map(),windowEvents=new Map();let protections=0,hidden=0;
  for(const id of ['model-popover','composer-popover','model-menu-toggle','composer-menu-toggle','attach-image','attach-file','paste-image']){
    const listeners=new Map();elements.set('#'+id,{listeners,open:false,style:{},attributes:{},offsetWidth:140,offsetHeight:120,addEventListener:(name,handler)=>listeners.set(name,handler),matches(){return this.open;},hidePopover(){hidden++;this.open=false;},focus(){context.document.activeElement=this;},setAttribute(name,value){this.attributes[name]=value;},getBoundingClientRect(){return{left:252,right:272,top:176,bottom:196};}});
  }
  const context=vm.createContext({document:{querySelector:id=>elements.get(id)},window:{addEventListener:(name,handler)=>windowEvents.set(name,handler)},innerWidth:360,innerHeight:210,renderDraftAttachments:()=>{protections++;}});
  const start=source.indexOf("document.querySelector('#model-popover').addEventListener('toggle'");vm.runInContext(source.slice(start,source.indexOf("window.addEventListener('blur'",start)),context);
  for(const id of ['composer-popover','model-popover']){
    const popup=elements.get('#'+id),other=elements.get('#'+(id==='composer-popover'?'model-popover':'composer-popover'));other.open=true;popup.open=true;
    popup.listeners.get('toggle')({newState:'open',currentTarget:popup});assert.equal(other.open,false);assert.equal(popup.open,true);assert.equal(protections,id==='composer-popover'?1:2);
    if(id==='composer-popover')assert.equal(elements.get('#composer-menu-toggle').attributes['aria-expanded'],'true');
    const focused=elements.get('#'+(id==='composer-popover'?'composer-menu-toggle':'model-menu-toggle'));context.document.activeElement=focused;const oldHidden=hidden,otherStyle={...other.style};
    context.innerHeight=212;windowEvents.get('resize')();assert.equal(popup.open,true,id+' initial 210→212 resize');assert.equal(context.document.activeElement,focused);assert.equal(hidden,oldHidden);assert.deepEqual(other.style,otherStyle);
    context.innerWidth=280;context.innerHeight=180;windowEvents.get('resize')();assert.equal(popup.open,true,id+' smaller viewport resize');
    const left=Number.parseFloat(popup.style.left),top=Number.parseFloat(popup.style.top);assert.ok(left>=12&&left+popup.offsetWidth<=context.innerWidth-12);assert.ok(top>=12&&top+popup.offsetHeight<=context.innerHeight-12);assert.equal(protections,id==='composer-popover'?1:2);assert.equal(context.document.activeElement,focused);assert.equal(hidden,oldHidden);
    popup.open=false;
  }
});
