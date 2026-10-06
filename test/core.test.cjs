const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { loadPack } = require('../src/packs.cjs');
const { Store } = require('../src/store.cjs');
const { CodexConnection } = require('../src/codex.cjs');
const { ModelCatalog } = require('../src/models.cjs');

test('character packs reject escape paths, executable SVG and unknown schemas; missing states fall back', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-test-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'pack'); fs.mkdirSync(dir);
  const manifest={schemaVersion:1,id:'test-pack',name:'Test',states:{idle:'idle.svg'}};
  fs.writeFileSync(path.join(dir,'idle.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
  const loaded=loadPack(dir); assert.equal(loaded.assets.sleeping,loaded.assets.idle);
  fs.writeFileSync(path.join(root,'outside.svg'),'<svg/>');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({...manifest,states:{idle:'../outside.svg'}}));
  assert.throws(()=>loadPack(dir),/외부/);
  fs.symlinkSync(path.join(root,'outside.svg'),path.join(dir,'linked.svg'));
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({...manifest,states:{idle:'linked.svg'}})); assert.throws(()=>loadPack(dir),/외부/);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir,'idle.svg'),'<svg onload="alert(1)"/>'); assert.throws(()=>loadPack(dir),/실행 코드/);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({...manifest,schemaVersion:2})); assert.throws(()=>loadPack(dir),/형식/);
});

test('restart preserves completed history and marks pending work interrupted without rerunning', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-store-test-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{characterId:'onggi-clip'});
  store.data.threadId='thread-123';
  store.data.messages=[{id:'a',role:'assistant',text:'done',status:'completed'},{id:'b',role:'assistant',text:'partial',status:'running'},{id:'c',role:'user',text:'queued',status:'queued'}];
  store.save(); const recovered=new Store(root,{});
  assert.equal(recovered.data.threadId,'thread-123'); assert.deepEqual(recovered.data.messages.map(m=>m.status),['completed','interrupted','interrupted']);
  fs.writeFileSync(store.file,'not json'); const broken=new Store(root,{}); assert.match(broken.warning,/보존/); assert.equal(broken.data.messages.length,0); assert.ok(fs.readdirSync(root).some(f=>f.includes('.backup-')));
});

test('Codex JSONL framing, prompt integrity, approval and cancellation roundtrip', async t => {
  const bridge=new CodexConnection(); t.after(()=>bridge.stop());
  const fixture=path.join(__dirname,'fixtures','fake-codex.cjs'); fs.chmodSync(fixture,0o755);
  await bridge.connect(fixture,__dirname);
  assert.equal((await bridge.request('thread/start',{})).thread.id,'thread-test');
  const notifications=[], requests=[]; bridge.on('notification',m=>notifications.push(m)); bridge.on('request',m=>requests.push(m));
  const prompt='literal $(echo injected) `whoami`\n한글 질문';
  const approval=once(bridge,'request'); await bridge.request('turn/start',{threadId:'thread-test',input:[{type:'text',text:prompt}]}); await approval;
  assert.equal(notifications.find(n=>n.method==='item/agentMessage/delta').params.delta,prompt);
  assert.equal(requests[0].id,90);
  const completed=once(bridge,'notification'); bridge.respond(90,{decision:'decline'}); await completed;
  assert.equal(notifications.at(-1).params.turn.status,'completed');
  const approval2=once(bridge,'request'); await bridge.request('turn/start',{threadId:'thread-test',input:[{type:'text',text:'cancel'}]}); await approval2;
  await bridge.interrupt(); await new Promise(r=>setTimeout(r,20)); assert.equal(notifications.at(-1).params.turn.status,'interrupted');
});

test('Codex missing executable and exit reject pending requests rather than hanging', async t => {
  const bridge=new CodexConnection(); t.after(()=>bridge.stop());
  await assert.rejects(bridge.connect('/missing-onggi-codex',__dirname),/실행 실패/);
  await bridge.connect(path.join(__dirname,'fixtures','fake-codex.cjs'),__dirname);
  await assert.rejects(bridge.request('crash',{}),/연결 종료/);
});

test('request timeouts clear pending state and allow the connection to be stopped', async t => {
  const bridge=new CodexConnection(); t.after(()=>bridge.stop());
  await bridge.connect(path.join(__dirname,'fixtures','fake-codex.cjs'),__dirname);
  await assert.rejects(bridge.request('never-replies',{},20),/시간 초과/);
  assert.equal(bridge.pending.size,0);
});

test('model catalog paginates, preserves configured defaults, validates effort and restores CLI defaults', async () => {
  const requested=[];
  const connection={request:async(method,params)=>{
    requested.push({method,params});
    if(method==='config/read')return{config:{model:'test-main',model_reasoning_effort:'high'}};
    if(!params.cursor)return{data:[{model:'test-main',displayName:'Main',isDefault:true,hidden:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}],nextCursor:'page-two'};
    return{data:[{model:'test-small',displayName:'Small',hidden:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],nextCursor:null};
  }};
  const catalog=new ModelCatalog(connection);await catalog.refresh('/example');
  assert.equal(catalog.models.length,2);assert.equal(requested[1].params.cursor,'page-two');
  assert.deepEqual(catalog.resolve(null,null),{model:'test-main',effort:'high',modelName:'Main',serviceTier:'default',serviceTierName:'Standard'});
  const queued={...catalog.resolve('test-main','low')};
  assert.equal(catalog.resolve('test-small',null).effort,'medium');
  assert.deepEqual(queued,{model:'test-main',effort:'low',modelName:'Main',serviceTier:'default',serviceTierName:'Standard'});
  assert.throws(()=>catalog.resolve('missing',null),/목록/);
  assert.throws(()=>catalog.resolve('test-small','ultra'),/지원하지/);
  assert.equal(catalog.resolve(null,null).effort,'high');
});

test('model catalog rejects repeated pagination cursors without replacing the previous catalog', async () => {
  const catalog=new ModelCatalog({request:async()=>({data:[],nextCursor:'same'})});
  catalog.models=[{model:'previous'}];await assert.rejects(catalog.refresh('/example'),/반복/);
  assert.equal(catalog.models[0].model,'previous');
});

test('CJK emphasis preserves Korean parentheses, escaped markers and literal code', async () => {
  const {default:cjkFriendly}=await import('markdown-it-cjk-friendly');
  const markdown=require('markdown-it')({html:false}).use(cjkFriendly);
  assert.match(markdown.render('**알파인 리눅스(Alpine Linux)**는 작은 배포판입니다.'),/<strong>알파인 리눅스\(Alpine Linux\)<\/strong>는/);
  assert.match(markdown.render('`**(코드)**는`'),/<code>\*\*\(코드\)\*\*는<\/code>/);
  assert.doesNotMatch(markdown.render('\\*\\*문자 그대로\\*\\*'),/<strong>/);
});

test('v1 migration backs up original data and registers only its current buddy conversation', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-migrate-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const legacy={version:1,settings:{model:'gpt-5.6-luna',effort:'high',workspace:'/buddy'},threadId:'legacy-buddy-thread',messages:[{id:'legacy-user',role:'user',text:'예전 질문',status:'completed',createdAt:1000},{id:'legacy-reply',role:'assistant',text:'예전 답변',status:'completed'}]};
  fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(legacy));
  const store=new Store(root,{});assert.equal(store.data.version,2);assert.equal(store.data.conversations.length,1);assert.equal(store.data.conversations[0].source,'onggi_bot');assert.equal(store.data.conversations[0].title,'예전 질문');assert.equal(store.data.threadId,'legacy-buddy-thread');assert.equal(store.data.settings.model,'gpt-5.6-luna');
  assert.ok(fs.readdirSync(root).some(f=>f.includes('backup-v1')));assert.equal(JSON.parse(fs.readFileSync(store.file)).version,2);
});

test('new conversations retain past messages and restore their mode, workspace and Codex thread after restart', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-history-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{workspace:'/first',codexPath:'/codex',demo:false});
  store.data.threadId='first-thread';store.data.messages=[{id:'first',role:'user',text:'첫 이야기',mode:'codex',status:'completed',createdAt:1000},{id:'reply',role:'assistant',text:'첫 답변',mode:'codex',status:'completed'}];store.save();
  const first=store.data.activeConversationId, updated=store.data.conversations[0].updatedAt;
  store.newConversation();store.data.settings.workspace='/second';store.data.settings.demo=true;
  store.data.messages=[{id:'second',role:'user',text:'두 번째 이야기',mode:'demo',status:'completed'}];store.save();
  const second=store.data.activeConversationId;assert.notEqual(first,second);assert.equal(store.data.conversations.length,2);
  store.openConversation(first);assert.equal(store.data.threadId,'first-thread');assert.equal(store.data.messages[1].text,'첫 답변');assert.equal(store.data.settings.workspace,'/first');assert.equal(store.data.settings.demo,false);assert.equal(store.data.conversations[0].updatedAt,updated);
  const reopened=new Store(root,{});assert.equal(reopened.data.activeConversationId,first);assert.equal(reopened.data.conversations.length,2);assert.equal(reopened.data.messages[0].text,'첫 이야기');
  assert.throws(()=>reopened.openConversation('../../outside'),/옹기봇/);assert.throws(()=>reopened.openConversation('unrelated-codex-thread'),/옹기봇/);
});

test('long conversation history is not trimmed to the old 120-message cache', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-long-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=Array.from({length:140},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'message '+i,status:'completed',mode:'demo'}));store.save();
  assert.equal(new Store(root,{}).data.messages.length,140);
});

test('owned registry excludes foreign entries and corrupt history leaves the active conversation intact', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-owned-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=[{id:'owned',role:'user',text:'내 대화',mode:'demo',status:'completed'}];store.save();
  const first=store.data.activeConversationId;store.newConversation();store.data.messages=[{id:'active',role:'user',text:'현재 대화',mode:'demo',status:'completed'}];store.save();
  const saved=JSON.parse(fs.readFileSync(store.file));saved.conversations.push({id:'00000000-0000-0000-0000-000000000000',source:'codex_app',title:'다른 앱 대화'});fs.writeFileSync(store.file,JSON.stringify(saved));
  const reopened=new Store(root,{});assert.equal(reopened.data.conversations.length,2);
  fs.writeFileSync(path.join(reopened.historyDirectory,first+'.json'),'broken JSON');assert.throws(()=>reopened.openConversation(first));assert.equal(reopened.data.messages[0].text,'현재 대화');
});


test('speed choices follow CLI service tiers and Standard explicitly clears a prior Fast request', async () => {
  let generation=0;
  const catalog=new ModelCatalog({request:async method=>method==='config/read'?{config:{model:'dynamic-model'}}:{data:[{model:'dynamic-model',displayName:'Dynamic model',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}],serviceTiers:generation?[{id:'new-fast-id',name:'New Fast',description:'CLI changed tier'}]:[{id:'priority',name:'Fast',description:'CLI fast tier'}]}],nextCursor:null}});
  await catalog.refresh('/test');assert.ok(catalog.refreshedAt>0);
  const queued={...catalog.resolve(null,null,'priority')};assert.equal(queued.serviceTierName,'Fast');
  assert.equal(catalog.resolve(null,null,'default').serviceTier,'default');assert.throws(()=>catalog.resolve(null,null,'unsupported'),/속도/);
  generation++;await catalog.refresh('/test');assert.equal(catalog.models[0].serviceTiers[0].id,'new-fast-id');assert.equal(catalog.resolve(null,null,'new-fast-id').serviceTierName,'New Fast');assert.equal(queued.serviceTier,'priority');assert.throws(()=>catalog.resolve(null,null,'priority'),/속도/);
});


test('settings-only saves preserve the conversation file until an explicit history save', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-settings-save-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{measureResponseTime:false});
  store.data.messages=[{id:'reply',role:'assistant',text:'original',status:'completed'}];store.save();
  const file=path.join(store.historyDirectory,store.data.activeConversationId+'.json'),original=fs.readFileSync(file,'utf8');
  store.data.messages[0].text='updated';store.data.settings.measureResponseTime=true;store.save({includeHistory:false});
  assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(JSON.parse(fs.readFileSync(store.file,'utf8')).settings.measureResponseTime,true);
  store.save();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).messages[0].text,'updated');
});


test('pre-commit storage failure rolls back registration and a retry writes both owned files', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-save-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=[{id:'u',role:'user',text:'not lost',status:'queued'}];
  const original=fs.writeFileSync;
  t.mock.method(fs,'writeFileSync',(file,...args)=>{if(file===store.file+'.tmp')throw new Error('test disk full');return original(file,...args);});
  assert.throws(()=>store.save(),/disk full/);assert.equal(store.data.activeConversationId,null);assert.equal(store.data.conversations.length,0);assert.equal(store.snapshot,null);assert.equal(store.writeBlocked,false);
  t.mock.restoreAll();store.save();assert.equal(new Store(root,{}).data.messages[0].text,'not lost');
});

test('journal recovers crashes before either file replacement without rerunning queued work', t => {
  for(const stage of ['history','index']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-save-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=new Store(root,{demo:true});store.data.messages=[{id:'u',role:'user',text:'old',status:'completed'}];store.save();
    const id=store.data.activeConversationId,history=path.join(store.historyDirectory,id+'.json');
    store.data.messages.push({id:'new',role:'user',text:'recover me',status:'queued'});
    const original=fs.renameSync;
    t.mock.method(fs,'renameSync',(from,to)=>{if(to===(stage==='history'?history:store.file))throw new Error('test crash');return original(from,to);});
    assert.throws(()=>store.save(),/crash/);assert.equal(store.writeBlocked,true);assert.ok(fs.existsSync(store.journalFile));assert.throws(()=>store.save(),/복구/);
    t.mock.restoreAll();const recovered=new Store(root,{});
    assert.equal(recovered.data.messages.length,2);assert.equal(recovered.data.messages[1].status,'interrupted');assert.equal(recovered.data.conversations[0].messageCount,2);assert.equal(recovered.writeBlocked,false);assert.ok(!fs.existsSync(store.journalFile));assert.match(recovered.warning,/복구/);
  }
});

test('journal refuses path escape and tampered staged contents without overwriting originals', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-journal-tamper-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=[{id:'u',role:'user',text:'original',status:'completed'}];store.save();
  const original=fs.readFileSync(store.file,'utf8');
  fs.writeFileSync(store.journalFile,JSON.stringify({version:1,historyId:'../../outside',stateHash:'a'.repeat(64),historyHash:'b'.repeat(64)}));
  const blocked=new Store(root,{});assert.equal(blocked.writeBlocked,true);assert.match(blocked.warning,/복구/);assert.equal(fs.readFileSync(store.file,'utf8'),original);assert.throws(()=>blocked.save(),/복구/);
  fs.writeFileSync(store.journalFile,JSON.stringify({version:1,historyId:store.data.activeConversationId,stateHash:'a'.repeat(64),historyHash:'b'.repeat(64)}));
  fs.writeFileSync(store.file+'.tmp',original);const tampered=new Store(root,{});assert.equal(tampered.writeBlocked,true);assert.equal(fs.readFileSync(store.file,'utf8'),original);
});

test('new conversation settings-only save cannot register a missing history file', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-new-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{});store.data.messages=[{id:'u',role:'user',text:'new',status:'completed'}];store.save({includeHistory:false});assert.equal(new Store(root,{}).data.messages[0].text,'new');
});

test('JSONL accepts a fragmented UTF-8 response larger than the previous 8MiB limit', async t => {
  const bridge=new CodexConnection();t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures','fake-codex.cjs'),__dirname);
  const response=await bridge.request('large-response',{},10000);assert.equal(response.text.length,3*1024*1024);assert.equal(response.text[0],'한');assert.equal((await bridge.request('thread/start',{})).thread.id,'thread-test');
});

test('JSONL applies the byte limit to each frame rather than combined frames in a chunk', async t => {
  const bridge=new CodexConnection({maxFrameBytes:150});t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures','fake-codex.cjs'),__dirname);
  const notice=once(bridge,'notification');assert.equal((await bridge.request('batch-response',{})).text.length,80);assert.equal((await notice)[0].method,'test/notice');assert.ok(bridge.process);
});

test('JSONL rejects an oversized UTF-8 frame with an explicit error and clears pending calls', async t => {
  const bridge=new CodexConnection({maxFrameBytes:256});t.after(()=>bridge.stop());await bridge.connect(path.join(__dirname,'fixtures','fake-codex.cjs'),__dirname);
  const protocol=once(bridge,'protocol-error');await assert.rejects(bridge.request('oversized-response',{}),/프레임.*한도/);assert.match((await protocol)[0],/256바이트/);assert.equal(bridge.pending.size,0);assert.equal(bridge.process,null);
});


test('failed new/open conversation switches retain the previous active history and settings', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-switch-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{workspace:'/first',demo:true});store.data.messages=[{id:'first',role:'user',text:'first',mode:'demo',status:'completed'}];store.save();const first=store.data.activeConversationId;
  store.newConversation();store.data.settings.workspace='/second';store.data.messages=[{id:'second',role:'user',text:'second',mode:'demo',status:'completed'}];store.save();const second=store.data.activeConversationId;
  for(const operation of [()=>store.newConversation(),()=>store.openConversation(first)]){
    const original=fs.renameSync;let calls=0;t.mock.method(fs,'renameSync',(from,to)=>{if(to===store.file&&++calls===2)throw new Error('test switch failure');return original(from,to);});
    assert.throws(operation,/switch failure/);assert.equal(store.data.activeConversationId,second);assert.equal(store.data.messages[0].text,'second');assert.equal(store.data.settings.workspace,'/second');t.mock.restoreAll();
  }
});

test('oversized new history cannot register a conversation or overwrite the index', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-history-capacity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{});store.save();const original=fs.readFileSync(store.file,'utf8');
  store.data.messages=Array.from({length:56},(_,i)=>({id:'big-'+i,role:'assistant',text:'\u0000'.repeat(100000),status:'completed'}));
  assert.throws(()=>store.save(),/32MiB/);assert.equal(store.data.activeConversationId,null);assert.equal(store.data.conversations.length,0);assert.equal(store.snapshot,null);assert.equal(fs.readFileSync(store.file,'utf8'),original);
});


test('owned deletion removes active files, index and temp while preserving other conversations', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-owned-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=[{id:'first',role:'user',text:'keep',status:'completed',mode:'demo'}];store.save();const first=store.data.activeConversationId;
  store.newConversation();store.data.messages=[{id:'second',role:'user',text:'remove',status:'completed',mode:'demo'}];store.save();const second=store.data.activeConversationId,file=path.join(store.historyDirectory,second+'.json');fs.copyFileSync(file,file+'.tmp');
  assert.throws(()=>store.beginDeletion('../../other'),/옹기봇/);store.beginDeletion(second);assert.ok(fs.existsSync(file));store.completeDeletion([second]);
  assert.equal(store.data.activeConversationId,null);assert.equal(store.data.threadId,null);assert.equal(store.data.messages.length,0);assert.ok(!fs.existsSync(file));assert.ok(!fs.existsSync(file+'.tmp'));assert.ok(!fs.existsSync(store.deleteFile));
  const recovered=new Store(root,{});assert.deepEqual(recovered.data.conversations.map(c=>c.id),[first]);recovered.openConversation(first);assert.equal(recovered.data.messages[0].text,'keep');
});

test('unconfirmed remote deletion survives restart without removing local files', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-pending-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{});store.data.threadId='owned-cli';store.data.messages=[{id:'u',role:'user',text:'preserve',status:'completed'}];store.save();const id=store.data.activeConversationId;store.beginDeletion(id);
  const restarted=new Store(root,{});assert.equal(restarted.pendingDeletion.id,id);assert.equal(restarted.data.messages[0].text,'preserve');assert.ok(fs.existsSync(path.join(store.historyDirectory,id+'.json')));assert.equal(restarted.writeBlocked,false);
});

test('confirmed deletion cleanup failure is completed after restart without resurrecting records', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-recover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=[{id:'u',role:'user',text:'remove',status:'completed'}];store.save();const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json');store.beginDeletion(id);
  const original=fs.rmSync;t.mock.method(fs,'rmSync',(target,...args)=>{if(target===file)throw new Error('test cleanup failure');return original(target,...args);});
  assert.throws(()=>store.completeDeletion([id]),/cleanup failure/);assert.equal(store.pendingDeletion.phase,'cli-deleted');assert.equal(store.writeBlocked,true);assert.ok(fs.existsSync(file));t.mock.restoreAll();
  const restarted=new Store(root,{});assert.equal(restarted.pendingDeletion,null);assert.equal(restarted.data.conversations.length,0);assert.equal(restarted.data.activeConversationId,null);assert.ok(!fs.existsSync(file));assert.equal(restarted.writeBlocked,false);
});

test('deletion refuses foreign file content and escaped journal IDs', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{});store.data.messages=[{id:'u',role:'user',text:'owned',status:'completed'}];store.save();const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json');store.beginDeletion(id);
  fs.writeFileSync(file,JSON.stringify({id,source:'other_app',messages:[]}));assert.throws(()=>store.completeDeletion([id]),/소유/);assert.ok(fs.existsSync(file));
  fs.writeFileSync(store.deleteFile,JSON.stringify({version:1,id:'../../outside',ids:['../../outside'],phase:'cli-deleted'}));const blocked=new Store(root,{});assert.equal(blocked.writeBlocked,true);assert.ok(fs.existsSync(file));
});


test('deletion cannot overwrite an unresolved save transaction', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-save-conflict-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{});store.data.messages=[{id:'u',role:'user',text:'preserve',status:'completed'}];store.save();const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json');store.beginDeletion(id);
  const original=fs.readFileSync(store.file,'utf8');fs.writeFileSync(store.journalFile,'unresolved save');assert.throws(()=>store.completeDeletion([id]),/저장 복구/);assert.ok(fs.existsSync(file));assert.equal(fs.readFileSync(store.file,'utf8'),original);assert.equal(store.pendingDeletion.phase,'pending');
});
