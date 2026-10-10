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
