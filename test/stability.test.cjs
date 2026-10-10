const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CodexConnection } = require('../src/codex.cjs');
const { Store } = require('../src/store.cjs');
const { ModelCatalog } = require('../src/models.cjs');

function mainHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'onggi-stability-'));
  t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  let action, select;
  const electron = {globalShortcut:{register:()=>true,unregister(){}},app:{isPackaged:true,setName(){},requestSingleInstanceLock:()=>true,whenReady:()=>new Promise(()=>{}),on(){}},ipcMain:{handle:(_channel,handler)=>{action=handler;}},dialog:{showOpenDialog:()=>new Promise(resolve=>{select=resolve;})},shell:{openPath:async()=>''}};
  const fromMain = createRequire(path.join(__dirname,'../src/main.cjs'));
  const timers = [];
  const context = vm.createContext({require:name=>name==='electron'?electron:fromMain(name),__dirname:path.join(__dirname,'../src'),process,console,Buffer,performance,structuredClone,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval(){},clearInterval(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),context);
  const originalPublish=vm.runInContext('publish',context);
  const contents = {mainFrame:{},isDestroyed:()=>false}, panel = {webContents:contents,isDestroyed:()=>false,isVisible:()=>true,messageView:null,setAlwaysOnTop(){}};
  const pet = {webContents:{mainFrame:{},isDestroyed:()=>false},isDestroyed:()=>false,setAlwaysOnTop(){}};
  const notice = {webContents:{mainFrame:{},isDestroyed:()=>false},isDestroyed:()=>false,setAlwaysOnTop(){}};
  const store = new Store(root,{characterId:'onggi-clip',skinId:'paper',chatMode:'panel',demo:true,model:'old',effort:'high',serviceTier:'default',measureResponseTime:false,alwaysOnTop:true,personaModes:{},workspace:root,codexPath:'/codex'});
  fs.mkdirSync(path.join(root,'characters'));
  Object.assign(context,{testStore:store,testPanel:panel,testPet:pet,testNotice:notice});
  vm.runInContext("store=testStore;packLibrary=new PackLibrary(store.directory);panel=testPanel;pet=testPet;petNotice=testNotice;publish=()=>{};skins=[{id:'paper'},{id:'night'}];packs=[{manifest:{id:'onggi-clip'}},{manifest:{id:'next'}}];modelCatalog.models=[{model:'new',name:'New',efforts:[{value:'high'}],defaultEffort:'high',serviceTiers:[]}];codex.stop=()=>{};assetValidator.validate=async p=>p;",context);
  return {root,store,context,timers,electron,call:(name,payload)=>action({sender:contents,senderFrame:contents.mainFrame},name,payload),select:value=>select(value),publish:()=>{originalPublish(true);timers.at(-1).fn();}};
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
    h.context.fakeRead=async()=>({thread:{id:failure==='identity'?'foreign-thread':'owned-thread',turns:[{id:'turn',status:'completed',items:[{type:'userMessage',id:'local',content:[{type:'text',text:'keep'}]},{type:'agentMessage',text:'remote answer'}]}]}});vm.runInContext('codex.connect=async()=>true;codex.request=fakeRead;',h.context);
    if(failure==='save'){const original=h.store.save.bind(h.store);let calls=0;h.store.save=options=>{if(++calls===3)throw Error('disk full');return original(options);};}
    await h.call('open-conversation',{id});assert.equal(h.store.data.messages.length,1);assert.equal(h.store.data.messages[0].text,'keep');assert.match(vm.runInContext('historyWarning',h.context),/저장된 기록/);
  }
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

test('deferred state publishing tolerates destroyed panels and stops after shutdown begins',t=>{
  const h=mainHarness(t);h.context.testPanel.isDestroyed=()=>true;h.context.testPanel.isVisible=()=>{throw Error('destroyed panel must never be queried');};
  assert.doesNotThrow(()=>h.publish());vm.runInContext('quitting=true;',h.context);assert.doesNotThrow(()=>h.timers.at(-1).fn());
});
