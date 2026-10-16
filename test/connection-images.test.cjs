const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {ConnectionSetup}=require('../src/connection-setup.cjs'),{ResponseImages}=require('../src/response-images.cjs'),{Store}=require('../src/store.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4P8EBiBggFAA1rgc9lj6CJAAAAABJRU5ErkJggg==','base64');

test('login state separates cached credentials, external providers and required login without retaining email',async()=>{
  const transport=new EventEmitter();transport.process={};let result;
  transport.request=async()=>result;const setup=new ConnectionSetup(transport);try{
    result={account:{type:'chatgpt',email:'private@example.invalid'},requiresOpenaiAuth:true};assert.equal((await setup.check()).phase,'ready');assert.ok(!JSON.stringify(setup.state).includes('private'));
    result={account:null,requiresOpenaiAuth:false};assert.equal((await setup.check()).authMode,'external');
    result={account:null,requiresOpenaiAuth:true};assert.equal((await setup.check()).phase,'login-required');
    result={account:null,requiresOpenaiAuth:'true'};await assert.rejects(setup.check(),/로그인 상태/);
  }finally{setup.dispose();}
});

test('browser login prevents duplicate starts, matches login ID and validates official HTTPS URLs',async()=>{
  const transport=new EventEmitter();transport.process={};let authenticated=false,starts=0,opened=0,cancelled=0;
  transport.request=async(method)=>{if(method==='account/read')return{account:authenticated?{type:'chatgpt'}:null,requiresOpenaiAuth:true};if(method==='account/login/start'){starts++;return{type:'chatgpt',loginId:'owned',authUrl:'https://auth.openai.com/authorize?code=private'};}if(method==='account/login/cancel'){cancelled++;return{};}};
  const setup=new ConnectionSetup(transport,{openExternal:async()=>{opened++;}});try{
    await Promise.all([setup.startLogin(),setup.startLogin()]);assert.equal(starts,1);assert.equal(opened,1);assert.ok(!JSON.stringify(setup.state).includes('private'));
    transport.emit('notification',{method:'account/login/completed',params:{loginId:'foreign',success:true}});assert.ok(setup.attempt);
    authenticated=true;const verified=new Promise(resolve=>setup.once('authenticated',resolve));transport.emit('notification',{method:'account/login/completed',params:{loginId:'owned',success:true}});await verified;assert.equal(setup.state.phase,'ready');assert.equal(setup.attempt,null);
    authenticated=false;transport.request=async method=>method==='account/read'?{requiresOpenaiAuth:true,account:null}:method==='account/login/start'?{type:'chatgpt',loginId:'other',authUrl:'https://auth.openai.com.attacker.invalid/steal'}:(cancelled++,{});
    await assert.rejects(setup.startLogin(),/브라우저 로그인/);assert.equal(opened,1);assert.equal(cancelled,1);assert.equal(setup.attempt,null);
  }finally{setup.dispose();}
});

test('completion before login RPC, cancellation and disconnect clean up the same owned attempt',async()=>{
  const transport=new EventEmitter();transport.process={};let authenticated=false,cancelled=0;
  transport.request=async method=>{if(method==='account/read')return{requiresOpenaiAuth:true,account:authenticated?{type:'chatgpt'}:null};if(method==='account/login/start'){authenticated=true;transport.emit('notification',{method:'account/login/completed',params:{loginId:'early',success:true}});return{type:'chatgpt',loginId:'early',authUrl:'https://auth.openai.com/authorize'};}if(method==='account/login/cancel'){cancelled++;return{};}};
  const setup=new ConnectionSetup(transport,{openExternal:async()=>{throw Error('must not reopen a completed login');}});try{
    await setup.startLogin();assert.equal(setup.state.phase,'ready');assert.equal(setup.attempt,null);
    authenticated=false;transport.request=async method=>method==='account/read'?{requiresOpenaiAuth:true,account:null}:method==='account/login/start'?{type:'chatgpt',loginId:'pending',authUrl:'https://chatgpt.com/authorize'}:(cancelled++,{});setup.openExternal=async()=>{};
    await setup.startLogin();await setup.cancelLogin();assert.equal(cancelled,1);assert.equal(setup.state.phase,'login-required');
    await setup.startLogin();transport.emit('disconnected','closed');assert.equal(setup.attempt,null);assert.equal(setup.state.phase,'error');
  }finally{setup.dispose();}
});

test('authentication reads cannot restore an old account or overwrite a disconnected/disposed state',async()=>{
  for(const change of ['logout','disconnect','dispose']){
    const connection=new EventEmitter();connection.process={};let resolve;
    connection.request=()=>new Promise(done=>{resolve=done;});const setup=new ConnectionSetup(connection);
    try{
      const pending=setup.check();
      if(change==='logout')connection.emit('notification',{method:'account/updated',params:{authMode:null}});
      else if(change==='disconnect')connection.emit('disconnected');else setup.dispose();
      const state=setup.state,features={...setup.diagnostics.features};resolve({requiresOpenaiAuth:true,account:{type:'chatgpt'}});
      await pending;assert.equal(setup.state,state,change);assert.deepEqual(setup.diagnostics.features,features,change);
    }finally{setup.dispose();}
  }
});

test('a fresh authentication read can start after reconnect and an old error cannot clear its ownership',async()=>{
  const connection=new EventEmitter();connection.process={};const requests=[];
  connection.request=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));const setup=new ConnectionSetup(connection);let first,second;
  try{
    first=setup.check();connection.emit('disconnected');connection.process={};second=setup.check();
    assert.equal(requests.length,2);const checking=setup.checking,state=setup.state;
    requests[0].reject(Error('old connection failure'));await first;assert.equal(setup.checking,checking);assert.equal(setup.state,state);
    requests[1].resolve({requiresOpenaiAuth:false,account:null});await second;assert.equal(setup.state.phase,'ready');assert.equal(setup.state.authMode,'external');assert.equal(setup.checking,null);
  }finally{for(const request of requests)request.resolve({requiresOpenaiAuth:false,account:null});await Promise.allSettled([first,second]);setup.dispose();}
});

test('login cannot start from an authentication read invalidated while awaiting its result',async()=>{
  const connection=new EventEmitter();connection.process={};let resolve,starts=0,opened=0;
  connection.request=method=>method==='account/read'?new Promise(done=>{resolve=done;}):method==='account/login/start'?(starts++,Promise.resolve({type:'chatgpt',loginId:'unexpected',authUrl:'https://auth.openai.com/authorize'})):Promise.resolve({});
  const setup=new ConnectionSetup(connection,{openExternal:async()=>{opened++;}});
  try{const pending=setup.startLogin();connection.emit('disconnected');resolve({requiresOpenaiAuth:true,account:null});await pending;assert.equal(starts,0);assert.equal(opened,0);assert.equal(setup.attempt,null);assert.equal(setup.state.phase,'error');}
  finally{setup.dispose();}
});

test('login completion retries an account change once and never emits authentication from a stale retry',async()=>{
  for(const secondChange of [false,true]){
    const connection=new EventEmitter();connection.process={};const reads=[];let validating=false,authenticated=0;
    connection.request=method=>method==='account/read'?(validating?new Promise(resolve=>reads.push(resolve)):Promise.resolve({requiresOpenaiAuth:true,account:null})):Promise.resolve({type:'chatgpt',loginId:'owned-login',authUrl:'https://auth.openai.com/authorize'});
    const setup=new ConnectionSetup(connection,{openExternal:async()=>{}});setup.on('authenticated',()=>authenticated++);
    try{
      await setup.startLogin();validating=true;const pending=setup.completeLogin(setup.attempt,{loginId:'owned-login',success:true});
      connection.emit('notification',{method:'account/updated',params:{authMode:'chatgpt'}});reads[0]({requiresOpenaiAuth:true,account:{type:'chatgpt'}});
      for(let i=0;i<10&&reads.length<2;i++)await Promise.resolve();assert.equal(reads.length,2);
      if(secondChange)connection.emit('notification',{method:'account/updated',params:{authMode:'chatgpt'}});
      reads[1]({requiresOpenaiAuth:true,account:{type:'chatgpt'}});await pending;
      assert.equal(reads.length,2);assert.equal(authenticated,secondChange?0:1);assert.equal(setup.state.phase,secondChange?'idle':'ready');
    }finally{setup.dispose();}
  }
});

test('native/MCP images become bounded owned references, deduplicate and survive Store reload',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-images-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let decodes=0;
  const library=new ResponseImages(path.join(root,'images'),{validate:async p=>{decodes++;p.thumbnail=p.imageFiles[0].source;return p;}});
  const [image]=await library.capture({type:'imageGeneration',id:'native',status:'completed',result:png.toString('base64')});assert.equal(image.status,'ready');assert.equal(image.width,2);assert.ok(!JSON.stringify(image).includes(png.toString('base64')));
  const [mcp]=await library.capture({type:'mcpToolCall',id:'mcp',status:'completed',result:{content:[{type:'image',data:png.toString('base64')}]}});assert.equal(mcp.id,image.id);assert.equal(fs.readdirSync(library.root).length,1);assert.equal(decodes,2);
  const store=new Store(path.join(root,'store'),{demo:false});store.data.messages=[{id:'assistant',role:'assistant',text:'',status:'completed',images:[image]}];store.save();const restored=new Store(store.directory,{});assert.equal(restored.data.messages[0].images[0].id,image.id);assert.ok(library.read(image).bytes.equals(png));
  const toString=Buffer.prototype.toString;t.mock.method(Buffer.prototype,'toString',function(encoding,...args){if(encoding==='base64')throw Error('Binary cache read must not encode base64');return toString.call(this,encoding,...args);});
  assert.ok(library.read(image).bytes.equals(png));
  fs.writeFileSync(library.read(image).file,'changed');assert.throws(()=>library.read(image),/변경/);assert.throws(()=>library.read({id:'../../outside',mime:'image/png'}),/정보/);
});

test('invalid/oversized images and unowned saved paths fail before decode; interrupted images do not spin after restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-images-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let decodes=0;
  const library=new ResponseImages(path.join(root,'images'),{validate:async()=>{decodes++;throw Error('invalid bitmap');}}),wide=Buffer.from(png);wide.writeUInt32BE(50000,16);
  for(const result of ['data:image/svg+xml;base64,PHN2Zy8+',wide.toString('base64')])assert.equal((await library.capture({type:'imageGeneration',id:'bad',status:'completed',result}))[0].status,'failed');assert.equal(decodes,0);
  fs.mkdirSync(path.join(root,'workspace'));fs.writeFileSync(path.join(root,'outside.png'),png);
  assert.equal((await library.capture({type:'imageGeneration',id:'path',status:'completed',result:'',savedPath:path.join(root,'outside.png')},{workspace:path.join(root,'workspace')}))[0].status,'failed');assert.equal(decodes,0);
  fs.symlinkSync(path.join(root,'outside.png'),path.join(root,'workspace/link.png'));assert.equal((await library.capture({type:'imageGeneration',id:'path',status:'completed',result:'',savedPath:path.join(root,'workspace/link.png')},{workspace:path.join(root,'workspace')}))[0].status,'failed');
  const store=new Store(path.join(root,'store'),{});store.data.messages=[{id:'a',role:'assistant',text:'',status:'queued',images:[{itemId:'unfinished',status:'pending'}]}];store.save();assert.equal(new Store(store.directory,{}).data.messages[0].images[0].status,'failed');
});

test('login timeout cancels its owned attempt without signing out the shared CLI cache',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const transport=new EventEmitter();transport.process={};const calls=[];
  transport.request=async(method,params)=>{calls.push({method,params});return method==='account/read'?{requiresOpenaiAuth:true,account:null}:method==='account/login/start'?{type:'chatgpt',loginId:'timeout-owned',authUrl:'https://auth.openai.com/authorize'}:{};};
  const setup=new ConnectionSetup(transport,{openExternal:async()=>{}});try{await setup.startLogin();t.mock.timers.tick(300000);await Promise.resolve();assert.equal(setup.attempt,null);assert.equal(setup.state.phase,'login-required');assert.ok(calls.some(c=>c.method==='account/login/cancel'&&c.params.loginId==='timeout-owned'));assert.ok(!calls.some(c=>c.method==='account/logout'));}finally{setup.dispose();}
});

test('an unavailable image folder disables image storage while leaving existing external files intact',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-images-folder-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'external');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'keep'),'preserve');fs.symlinkSync(target,path.join(root,'images'));
  const library=new ResponseImages(path.join(root,'images'),{validate:async()=>{throw Error('must not decode');}});assert.ok(library.error);assert.equal((await library.capture({type:'imageGeneration',id:'unavailable',status:'completed',result:png.toString('base64')}))[0].status,'failed');assert.equal(fs.readFileSync(path.join(target,'keep'),'utf8'),'preserve');
});

test('account-wide rate limits update without an active turn and drop private account fields',async()=>{
  const connection=new EventEmitter();connection.process={};connection.request=async()=>({accountId:'SECRET_ACCOUNT',rateLimits:{primary:{usedPercent:23,windowDurationMins:300,resetsAt:2000000000}},rateLimitsByLimitId:{codex:{limitName:'Codex',primary:{usedPercent:23,windowDurationMins:300,resetsAt:2000000000},secondary:null},image:{primary:{usedPercent:40}}}});
  const setup=new ConnectionSetup(connection);await setup.readUsage();assert.equal(setup.usage.buckets.length,2);assert.equal(setup.usage.buckets[0].primary.usedPercent,23);assert.equal(JSON.stringify(setup.usage).includes('SECRET_ACCOUNT'),false);
  connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'image',primary:{usedPercent:50}}}});assert.equal(setup.usage.buckets.find(item=>item.id==='image').primary.usedPercent,50);assert.equal(setup.usage.buckets.find(item=>item.id==='codex').primary.usedPercent,23);
  setup.usage.checkedAt=1234;connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{primary:null,secondary:null}}});assert.equal(setup.usage.checkedAt,1234);assert.equal(setup.usage.status,'stale');
  connection.emit('notification',{method:'account/updated',params:{authMode:'apiKey'}});assert.deepEqual(setup.usage.buckets,[]);
  connection.request=async()=>{const error=Error('unsupported');error.code=-32601;throw error;};await setup.readUsage();assert.equal(setup.usage.status,'unsupported');setup.dispose();
});

test('usage reads cannot restore the previous account after logout, disconnect or disposal',async()=>{
  for(const change of ['logout','disconnect','dispose']){
    const connection=new EventEmitter();connection.process={};let resolve;
    connection.request=()=>new Promise(done=>{resolve=done;});const setup=new ConnectionSetup(connection),pending=setup.readUsage();
    if(change==='logout')connection.emit('notification',{method:'account/updated',params:{authMode:null}});
    else if(change==='disconnect')connection.emit('disconnected');else setup.dispose();
    resolve({rateLimits:{primary:{usedPercent:23}}});await pending;
    assert.deepEqual(setup.usage.buckets,[]);assert.notEqual(setup.usage.status,'ready');assert.equal(setup.usageWork,null);setup.dispose();
  }
});

test('newer quota events survive both stale read responses and stale read errors',async()=>{
  const connection=new EventEmitter();connection.process={};const setup=new ConnectionSetup(connection);
  try{
    for(const fail of [false,true]){
      let resolve,reject;connection.request=()=>new Promise((done,failed)=>{resolve=done;reject=failed;});const pending=setup.readUsage();
      connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:31}}}});
      const latest=setup.usage;
      if(fail){const error=Error('old unsupported response');error.code=-32601;reject(error);}else resolve({rateLimits:{primary:{usedPercent:23}}});
      await pending;assert.equal(setup.usage,latest);assert.equal(setup.usage.status,'ready');assert.equal(setup.usage.buckets[0].primary.usedPercent,31);
    }
  }finally{setup.dispose();}
});

test('a quota event preserves its bucket while the pending full read supplies the other buckets',async t=>{
  const connection=new EventEmitter();connection.process={};let resolve,clock=1000;t.mock.method(Date,'now',()=>clock);
  connection.request=()=>new Promise(done=>{resolve=done;});const setup=new ConnectionSetup(connection);
  try{
    const pending=setup.readUsage();clock=2000;connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:31}}}});
    clock=3000;resolve({rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:23}},image:{limitId:'image',primary:{usedPercent:40}}}});await pending;
    assert.equal(setup.usage.buckets.find(item=>item.id==='codex').primary.usedPercent,31);assert.equal(setup.usage.buckets.find(item=>item.id==='image').primary.usedPercent,40);
    assert.equal(setup.usage.buckets.find(item=>item.id==='codex').checkedAt,2000);assert.equal(setup.usage.buckets.find(item=>item.id==='image').checkedAt,1000);assert.equal(setup.usage.checkedAt,1000);assert.equal(setup.usageRead,null);
    const older=setup.readUsage();connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:32}}}});connection.emit('notification',{method:'account/updated',params:{authMode:null}});
    resolve({rateLimitsByLimitId:{image:{primary:{usedPercent:45}}}});await older;assert.deepEqual(setup.usage.buckets,[]);
  }finally{setup.dispose();}
});

test('quota event tracking stays bounded and uncertain data cannot restore an affected bucket',async()=>{
  const connection=new EventEmitter();connection.process={};let resolve;connection.request=()=>new Promise(done=>{resolve=done;});const setup=new ConnectionSetup(connection);
  try{
    setup.updateUsage({rateLimits:{limitId:'codex',primary:{usedPercent:31}}});const pending=setup.readUsage();
    connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:null,secondary:null}}});
    resolve({rateLimitsByLimitId:{codex:{primary:{usedPercent:23}},image:{primary:{usedPercent:40}}}});await pending;assert.equal(setup.usage.status,'stale');assert.equal(setup.usage.buckets.find(item=>item.id==='codex').primary.usedPercent,31);assert.equal(setup.usage.buckets.find(item=>item.id==='image').primary.usedPercent,40);
    const many=setup.readUsage();for(let index=0;index<17;index++)connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'bucket-'+index,primary:{usedPercent:index}}}});
    assert.equal(setup.usageRead.updatedIds.size,16);assert.equal(setup.usageRead.allChanged,true);const latest=setup.usage;
    resolve({rateLimits:{limitId:'old-bucket',primary:{usedPercent:99}}});await many;assert.equal(setup.usage,latest);assert.equal(setup.usage.buckets.length,16);
    const nodes=new Map([['#refresh-usage',{}],['#usage-status',{}]]),source=fs.readFileSync(path.join(__dirname,'../src/ui/renderer.mjs'),'utf8'),vm=require('node:vm');
    const context=vm.createContext({state:{accountUsage:{...setup.usage,status:'stale'},usageLoading:false},document:{querySelector:id=>nodes.get(id)}});
    vm.runInContext(source.split('\n').find(line=>line.trim().startsWith('const usage=state.accountUsage'))+'\n'+source.split('\n').find(line=>line.includes("document.querySelector('#usage-status').textContent=")),context);
    assert.doesNotMatch(nodes.get('#usage-status').textContent,/연결이 끊/);assert.match(nodes.get('#usage-status').textContent,/다시 확인/);
  }finally{setup.dispose();}
});

test('real-mode probe reports response and cleanup outcomes independently without masking failures',async t=>{
  const vm=require('node:vm'),root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-probe-outcomes-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=fs.readFileSync(path.join(__dirname,'../scripts/real-buddy-modes-smoke.cjs'),'utf8');
  for(const mode of ['success','cleanup-failure','response-failure']){
    let sequence=0,result,stopped=false;const removed=[];
    class Probe extends EventEmitter{
      async connect(){}
      async request(method,params){
        if(method==='model/list')return{data:[{model:'gpt-5.6-luna'}]};
        if(method==='thread/start')return{thread:{id:'probe-'+(++sequence)},model:'gpt-5.6-luna'};
        if(['turn/start','review/start'].includes(method)){
          this.emit('notification',{method:'item/completed',params:{threadId:params.threadId,item:method==='review/start'?{type:'exitedReviewMode',review:'fixture review'}:{type:'agentMessage',text:'fixture plan'}}});
          this.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{status:mode==='response-failure'?'failed':'completed'}}});
          return{turn:{id:'probe-turn'},reviewThreadId:params.threadId};
        }
        if(method==='thread/delete'){removed.push(params.threadId);if(mode==='cleanup-failure')throw Error('fixture deletion failure');return{};}
        throw Error('Unexpected fixture request '+method);
      }
      stop(){stopped=true;}
    }
    const process={env:{ONGGI_SMOKE_ROOT:root},exitCode:0};
    const context=vm.createContext({__dirname:path.join(__dirname,'../scripts'),process,setTimeout,clearTimeout,console:{log(){},error(){}},require:name=>name==='../src/codex.cjs'?{CodexConnection:Probe}:name==='../src/connection-setup.cjs'?{ConnectionSetup:{findExecutable:()=>'/fixture'}}:name==='node:fs'?{...fs,writeFileSync:(file,text)=>{assert.equal(file,path.join(root,'buddy-real-modes.json'));result=JSON.parse(text);}}:require(name)});
    await vm.runInContext(source,context);assert.equal(stopped,true);assert.equal(result.workspaceRemoved,true);
    assert.equal(result.responsePassed,mode!=='response-failure');assert.equal(result.cleanupPassed,mode!=='cleanup-failure');assert.equal(result.passed,mode==='success');assert.equal(process.exitCode,mode==='success'?0:1);
    assert.deepEqual(removed,mode==='response-failure'?['probe-1']:['probe-1','probe-2']);
  }
});

test('usage reads coalesce within their owner and do not block or clear a newer account/process read',async()=>{
  for(const change of ['process','account','disconnect'])for(const order of ['old-first','new-first'])for(const oldError of [false,true]){
    const connection=new EventEmitter();connection.process={};const requests=[];
    connection.request=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));const setup=new ConnectionSetup(connection);
    try{
      const first=setup.readUsage(),duplicate=setup.readUsage();assert.equal(requests.length,1);
      if(change==='process')connection.process={};
      if(change==='account')connection.emit('notification',{method:'account/updated',params:{authMode:'chatgpt'}});
      if(change==='disconnect'){connection.emit('disconnected');connection.process={};}
      const second=setup.readUsage();assert.equal(requests.length,2);const owner=setup.usageWork;
      const old=()=>oldError?requests[0].reject(Error('old read failed')):requests[0].resolve({rateLimits:{primary:{usedPercent:99}}});
      if(order==='old-first'){old();await first;assert.equal(setup.usageWork,owner);assert.equal(setup.usageRead,owner);}
      connection.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'image',primary:{usedPercent:12}}}});
      requests[1].resolve({rateLimitsByLimitId:{codex:{primary:{usedPercent:25}},image:{limitId:'image',primary:{usedPercent:98}}}});await second;
      if(order==='new-first'){old();await first;}
      await duplicate;assert.equal(setup.usageWork,null);assert.equal(setup.usageRead,null);assert.equal(setup.usage.buckets.find(item=>item.id==='codex').primary.usedPercent,25);assert.equal(setup.usage.buckets.find(item=>item.id==='image').primary.usedPercent,12);
    }finally{for(const request of requests)request.resolve({});setup.dispose();}
  }
});

test('concurrent image commits enforce the shared cache budget and deduplicate identical images',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-image-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const library=new ResponseImages(path.join(root,'images'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}});
  const padding=path.join(library.root,'padding'),descriptor=fs.openSync(padding,'wx');try{fs.ftruncateSync(descriptor,512*1024*1024-png.length-1);}finally{fs.closeSync(descriptor);}
  const different=Buffer.from(png);different[different.length-1]^=1;
  let release,entered;const blocked=new Promise(resolve=>{entered=resolve;}),write=fs.promises.writeFile;
  t.mock.method(fs.promises,'writeFile',async(...args)=>{if(!release){await new Promise(resolve=>{release=resolve;entered();});}return write(...args);});
  const first=library.capture({type:'imageGeneration',id:'first',status:'completed',result:png.toString('base64')});await blocked;
  const second=library.capture({type:'imageGeneration',id:'second',status:'completed',result:different.toString('base64')});release();
  const results=(await Promise.all([first,second])).flat();assert.deepEqual(results.map(item=>item.status),['ready','failed']);assert.match(results[1].error,/512MiB/);
  const used=fs.readdirSync(library.root).reduce((sum,file)=>sum+fs.statSync(path.join(library.root,file)).size,0);assert.ok(used<=512*1024*1024);assert.equal(library.saveWork,null);
  const repeated=(await Promise.all([library.capture({type:'imageGeneration',id:'same-1',status:'completed',result:png.toString('base64')}),library.capture({type:'imageGeneration',id:'same-2',status:'completed',result:png.toString('base64')})])).flat();assert.ok(repeated.every(item=>item.status==='ready'));assert.equal(fs.readdirSync(library.root).length,2);
  const paddingDescriptor=fs.openSync(padding,'r+');try{fs.ftruncateSync(paddingDescriptor,512*1024*1024);}finally{fs.closeSync(paddingDescriptor);}
  assert.equal((await library.capture({type:'imageGeneration',id:'existing-over-budget',status:'completed',result:png.toString('base64')}))[0].status,'ready');
});

test('image commit failures release waiting captures and clean temporary files',async t=>{
  const write=fs.promises.writeFile;
  for(const failedWrite of [1,2]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-image-write-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const preview=Buffer.from(png);preview[preview.length-1]^=1;
    const library=new ResponseImages(root,{validate:async candidate=>{candidate.thumbnail='data:image/png;base64,'+preview.toString('base64');}});
    let writes=0;const mock=t.mock.method(fs.promises,'writeFile',async(...args)=>{await write(...args);if(++writes===failedWrite)throw Error('fixture disk full');});
    try{
      const results=(await Promise.all([library.capture({type:'imageGeneration',id:'failed',status:'completed',result:png.toString('base64')}),library.capture({type:'imageGeneration',id:'next',status:'completed',result:png.toString('base64')})])).flat();
      assert.deepEqual(results.map(item=>item.status),['failed','ready']);assert.equal(library.saveWork,null);assert.equal(fs.readdirSync(root).length,2);assert.ok(library.read(results[1]).bytes.equals(png));
    }finally{mock.mock.restore();}
  }
});

test('corrupt stored image/attachment/skill identifiers fail closed while original text and valid references survive',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-stored-id-types-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const images=new ResponseImages(path.join(root,'images'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),[image]=await images.capture({type:'imageGeneration',id:'owned',status:'completed',result:png.toString('base64')});assert.equal(image.status,'ready');
  const {AttachmentStore}=require('../src/attachments.cjs'),attachments=new AttachmentStore(path.join(root,'attachments'),images),source=path.join(root,'note.txt');fs.writeFileSync(source,'note');const [attachment]=await attachments.import([source]);
  const store=new Store(path.join(root,'store'),{demo:true});
  for(const field of ['id','previewId']){
    const invalid={...image,[field]:[image[field]]};store.data.messages=[{id:'reply',role:'assistant',text:'keep response',status:'completed',images:[invalid,image]}];store.save();
    const restored=store.readHistory(store.data.activeConversationId);assert.equal(restored.messages[0].text,'keep response');assert.equal(restored.messages[0].images[0].status,'failed');assert.equal(restored.messages[0].images[1].status,'ready');
  }
  for(const field of ['id','hash','extension']){
    store.data.messages=[{id:'question',role:'user',text:'keep question',status:'completed',attachments:[{...attachment,[field]:[attachment[field]]},attachment],skill:{name:'fixture',path:source,hash:[attachment.hash]}}];store.save();
    const restored=store.readHistory(store.data.activeConversationId);assert.equal(restored.messages[0].text,'keep question');assert.equal(restored.messages[0].attachments.length,1);assert.equal(restored.messages[0].attachments[0].id,attachment.id);assert.equal(restored.messages[0].skill,undefined);
  }
  const imageAttachment={...attachment,kind:'image',mime:'image/png',width:2,height:2,hash:image.id,previewId:[image.previewId]};store.data.messages=[{id:'image-question',role:'user',text:'preserve image question',status:'completed',attachments:[imageAttachment]}];store.save();assert.equal(store.readHistory(store.data.activeConversationId).messages[0].attachments.length,0);
  assert.throws(()=>store.readHistory([store.data.activeConversationId]),/ID/);assert.throws(()=>images.read({id:[image.id],mime:image.mime}),/정보/);
  assert.throws(()=>attachments.read({...attachment,hash:[attachment.hash]}),/정보/);assert.throws(()=>attachments.read({...attachment,extension:[attachment.extension]}),/경로/);
  assert.ok(fs.readFileSync(source).equals(Buffer.from('note')));assert.ok(images.read(image).bytes.equals(png));
});
