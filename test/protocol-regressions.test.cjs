const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {CodexConnection}=require('../src/codex.cjs');

test('protocol identities have an exact UTF-8 bound without truncating or aliasing keys',async t=>{
  const fixture=path.join(__dirname,'fixtures/protocol-codex.cjs');
  for(const value of ['', 'x'.repeat(1025), '한'.repeat(342)])for(const field of ['item','delta','thread','turn','nested-turn']){
    const bridge=new CodexConnection();
    try{
      await bridge.connect(fixture,__dirname);
      const frame=field==='item'?{method:'item/completed',params:{item:{id:value,type:'agentMessage',text:'kept'}}}:field==='nested-turn'?{method:'turn/started',params:{threadId:'owned',turn:{id:value}}}:{method:'item/agentMessage/delta',params:{itemId:'normal',delta:'kept',...(field==='delta'?{itemId:value}:field==='thread'?{threadId:value}:{turnId:value})}};
      await assert.rejects(bridge.request('test/emit',{frame}),/식별자/);assert.equal(bridge.process,null);assert.equal(bridge.pending.size,0);
    }finally{bridge.stop();}
  }
  const bridge=new CodexConnection();t.after(()=>bridge.stop());await bridge.connect(fixture,__dirname);const ids=['x'.repeat(1024),'한'.repeat(341)+'x'];assert.ok(ids.every(id=>Buffer.byteLength(id)===1024));
  const received=[];bridge.on('notification',message=>received.push(message));
  for(const id of ids)await bridge.request('test/emit',{frame:{method:'item/agentMessage/delta',params:{threadId:'owned',turnId:'turn',itemId:id,delta:'kept'}}});
  assert.deepEqual(received.map(message=>message.params.itemId),ids);assert.equal(new Set(received.map(message=>message.params.itemId)).size,2);
});

test('an oversized start response cannot establish an unbounded interrupt identity',async()=>{
  for(const id of ['', '한'.repeat(342)]){
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(chunk);if(request.id!==undefined)Promise.resolve().then(()=>child.stdout.write(JSON.stringify({id:request.id,result:request.method==='initialize'?{}:{turn:{id}}})+'\n'));done();}});
    const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/codex.cjs'),'utf8'),{require:name=>name==='node:child_process'?{spawn:()=>child}:require(name),module,process,Buffer,setTimeout,clearTimeout,performance});
    const bridge=new module.exports.CodexConnection();await bridge.connect('/mock-codex',__dirname);
    await assert.rejects(bridge.request('turn/start',{threadId:'owned'}),/시작 응답 ID/);assert.equal(bridge.active,null);assert.equal(bridge.pending.size,0);assert.equal(child.killed,true);
  }
});

test('model fixture guards held completion, interrupted replay and ownership across normal and review turns',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-model-owned-')),bridge=new CodexConnection(),events=[];
  t.after(async()=>{const child=bridge.process,closed=child?new Promise(resolve=>child.once('exit',resolve)):null;bridge.stop();if(closed)await closed;fs.rmSync(root,{recursive:true,force:true});});
  bridge.on('notification',message=>{if(message.method==='turn/completed')events.push(message.params.turn);});await bridge.connect(path.join(__dirname,'fixtures/model-codex.cjs'),root);
  const threadId=(await bridge.request('thread/start',{})).thread.id,input=[{type:'text',text:'owned fixture'}];await bridge.request('test/hold',{enabled:true});
  const first=(await bridge.request('turn/start',{threadId,input})).turn.id;await bridge.request('turn/interrupt',{threadId,turnId:'foreign'});
  await assert.rejects(bridge.request('test/complete-current',{threadId,turnId:'foreign'}),/own/);await bridge.request('turn/interrupt',{threadId,turnId:first});await bridge.request('test/complete-current',{});await bridge.request('turn/interrupt',{threadId,turnId:first});
  const second=(await bridge.request('review/start',{threadId,target:{instructions:'review fixture'}})).turn.id;
  await assert.rejects(bridge.request('test/complete-current',{threadId,turnId:first}),/own/);await bridge.request('test/complete-current',{threadId,turnId:second});await bridge.request('test/complete-current',{});
  await bridge.request('test/hold',{enabled:false});const third=(await bridge.request('turn/start',{threadId,input})).turn.id;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{bridge.off('notification',finished);reject(Error('Natural fixture completion missing'));},3000);const finished=message=>{if(message.method==='turn/completed'&&message.params.turn.id===third){clearTimeout(timer);bridge.off('notification',finished);resolve();}};bridge.on('notification',finished);});
  assert.deepEqual(events.map(event=>[event.id,event.status]),[[first,'interrupted'],[second,'completed'],[third,'completed']]);
  const turns=(await bridge.request('thread/read',{threadId})).thread.turns;assert.deepEqual(turns.map(turn=>turn.status),['interrupted','completed','completed']);assert.equal(turns[0].items.length,1);assert.ok(turns[1].items.some(item=>item.type==='exitedReviewMode'));
});

test('standalone Codex smoke replaces previous evidence and reports response and archive failure separately',async t=>{
  for(const mode of ['success','connect-failure','response-failure','cleanup-failure']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-codex-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'codex-smoke.json');fs.writeFileSync(file,JSON.stringify({status:'passed',runId:'old'}));let probe,turns=0,archives=0;const timers=new Map();
    class Probe extends EventEmitter{
      constructor(){super();probe=this;}
      async connect(){if(mode==='connect-failure')throw Error('injected connection failure');this.process={pid:1};}
      async request(method,params){
        if(method==='thread/start')return{thread:{id:'owned'}};
        if(method==='thread/resume')return{};
        if(method==='thread/archive'){archives++;if(mode==='cleanup-failure')throw Error('injected archive failure');return{};}
        if(method==='turn/start'){
          if(mode==='response-failure')throw Error('injected response failure');const id='turn-'+(++turns);
          if(turns<3){this.emit('notification',{method:'item/completed',params:{threadId:params.threadId,turnId:id,item:{type:'agentMessage',text:'옹기봇'}}});this.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id,status:'completed'}}});}return{turn:{id}};
        }throw Error('Unexpected probe method '+method);
      }
      async interrupt(target){this.emit('notification',{method:'turn/completed',params:{threadId:target.threadId,turn:{id:target.turnId,status:'interrupted'}}});}
      stop(){this.stopped=true;this.process=null;}
    }
    const process={env:{ONGGI_SMOKE_ROOT:root},exitCode:0};
    await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/codex-smoke.cjs'),'utf8'),{require:name=>name==='../src/codex.cjs'?{CodexConnection:Probe}:name==='node:child_process'?{execFileSync:()=> 'codex-cli 1.0.0'}:require(name),__dirname:path.join(__dirname,'../scripts'),process,console:{log(){},error(){}},setTimeout:(callback,ms)=>{timers.set(1,{callback,ms});return 1;},clearTimeout:id=>timers.delete(id)});
    const result=JSON.parse(fs.readFileSync(file));assert.notEqual(result.runId,'old');assert.equal(result.status,mode==='success'?'passed':'failed');assert.equal(process.exitCode,mode==='success'?0:1);assert.equal(result.responsePassed,['success','cleanup-failure'].includes(mode));assert.equal(result.cleanupPassed,mode!=='cleanup-failure');assert.equal(archives,mode==='connect-failure'?0:1);assert.equal(probe.stopped,true);assert.equal(timers.size,0);
    if(mode==='response-failure')assert.match(result.error,/response failure/);if(mode==='cleanup-failure')assert.match(result.cleanupError,/archive failure/);
  }
});

test('persona smoke final success requires both all responses and archival cleanup',async t=>{
  for(const mode of ['success','response-failure','cleanup-failure']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let probe,archives=0,timerId=0,turnSequence=0;const timers=new Map();
    class Probe extends EventEmitter{
      constructor(){super();probe=this;this.process={pid:1};}
      async connect(){}
      async request(method,params){
        if(method==='thread/start')return{thread:{id:'owned'},model:'gpt-5.6-luna'};
        if(method==='thread/archive'){archives++;if(mode==='cleanup-failure')throw Error('injected archive failure');return{};}
        if(method==='turn/start'){
          if(mode==='response-failure')throw Error('injected response failure');const turnId='persona-turn-'+(++turnSequence),modeId=params.collaborationMode.settings.developer_instructions,text=modeId==='warm-long'?'따뜻한 설명 '.repeat(100):modeId==='blunt'?'정리해':'정리';
          this.emit('notification',{method:'item/completed',params:{threadId:params.threadId,turnId,item:{type:'agentMessage',text}}});this.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'completed'}}});return{turn:{id:turnId}};
        }throw Error('Unexpected probe method '+method);
      }
      stop(){this.stopped=true;}
    }
    const process={env:{ONGGI_SMOKE_ROOT:root},exitCode:0};
    await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/persona-real-smoke.cjs'),'utf8'),{require:name=>name==='../src/codex.cjs'?{CodexConnection:Probe}:name==='../src/packs.cjs'?{loadPack:()=>({})}:name==='../src/personas.cjs'?{PersonaLibrary:class{resolve(character,mode){return{instructions:mode,hash:'a'.repeat(64)};}}}:require(name),__dirname:path.join(__dirname,'../scripts'),process,console:{log(){},error(){}},setTimeout:(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
    const result=JSON.parse(fs.readFileSync(path.join(root,'persona-real-smoke.json')));assert.equal(result.status,mode==='success'?'passed':'failed');assert.equal(process.exitCode,mode==='success'?0:1);assert.equal(result.responsePassed,mode!=='response-failure');assert.equal(result.cleanupPassed,mode!=='cleanup-failure');assert.equal(archives,1);assert.equal(probe.stopped,true);assert.equal(probe.listenerCount('notification'),0);assert.equal(timers.size,0);
    if(mode==='cleanup-failure'){assert.equal(result.results.length,8);assert.match(result.cleanup[0].error,/archive failure/);}
  }
});

test('real input probe invalidates previous success before startup and records every terminal outcome',async t=>{
  for(const mode of ['success','missing-cli','connect-failure','turn-failure']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-input-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'real-input-verification.json');fs.writeFileSync(file,JSON.stringify({passed:true,runId:'old'}));let probe,exited=0,quit=0;const timers=new Map();
    class Probe extends EventEmitter{
      constructor(){super();probe=this;}
      async connect(){if(mode==='connect-failure')throw Error('injected connection failure');}
      async request(method,params){
        if(method==='thread/start'){assert.equal(params.ephemeral,true);return{thread:{id:'owned'}};}
        if(method==='turn/start'){
          if(mode==='turn-failure')throw Error('injected turn failure');const marker=fs.readFileSync(JSON.parse(params.input.at(-1).text.split('\n').at(-1))[0].path,'utf8').match(/ONGGI_[a-f0-9]+/)[0];
          this.emit('notification',{method:'item/completed',params:{threadId:params.threadId,item:{id:'reply',type:'agentMessage',text:JSON.stringify({color:'blue',marker})}}});this.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id:'turn',status:'completed'}}});return{turn:{id:'turn'}};
        }throw Error('Unexpected probe method '+method);
      }
      stop(){this.stopped=true;}
    }
    const app={setPath(){},on(){},whenReady:()=>Promise.resolve(),quit:()=>quit++,exit:code=>{exited=code;}},process={env:{ONGGI_SMOKE_ROOT:root}};
    await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/real-input-smoke.cjs'),'utf8'),{require:name=>name==='electron'?{app,nativeImage:{createFromBitmap:()=>({toPNG:()=>Buffer.from('fixture png')})}}:name==='../src/codex.cjs'?{CodexConnection:Probe}:name==='../src/connection-setup.cjs'?{ConnectionSetup:{findExecutable:()=>mode==='missing-cli'?null:'/mock-codex'}}:name==='../src/attachments.cjs'?{AttachmentStore:class{async import(files){return files.map(file=>({file,name:path.basename(file),bytes:8}));}read(item){return{file:item.file};}}}:name==='../src/response-images.cjs'?{ResponseImages:class{}}:name==='../src/asset-validator.cjs'?{AssetValidator:class{}}:require(name),__dirname:path.join(__dirname,'../scripts'),process,console:{log(){},error(){}},Buffer,setTimeout:(callback,ms)=>{timers.set(1,{callback,ms});return 1;},clearTimeout:id=>timers.delete(id)});
    const result=JSON.parse(fs.readFileSync(file));assert.notEqual(result.runId,'old');assert.equal(result.passed,mode==='success');assert.equal(result.status,mode==='success'?'passed':'failed');assert.equal(exited,mode==='success'?0:1);assert.equal(quit,mode==='success'?1:0);assert.equal(timers.size,0);if(probe)assert.equal(probe.stopped,true);
  }
});

test('hard watchdogs replace running real-probe evidence with a current failure',t=>{
  for(const kind of ['codex','input']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-probe-watchdog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let timeout,exited=0,stopped=false;
    class Probe{connect(){return new Promise(()=>{});}stop(){stopped=true;}}
    const app={setPath(){},on(){},whenReady:()=>new Promise(()=>{}),exit:code=>{exited=code;}},process={env:{ONGGI_SMOKE_ROOT:root},exit:code=>{exited=code;}};
    const script=kind==='codex'?'codex-smoke.cjs':'real-input-smoke.cjs';
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts',script),'utf8'),{require:name=>name==='electron'?{app}:name==='../src/codex.cjs'?{CodexConnection:Probe}:name==='node:child_process'?{execFileSync:()=> 'codex-cli 1.0.0'}:name==='../src/asset-validator.cjs'?{AssetValidator:class{}}:require(name),__dirname:path.join(__dirname,'../scripts'),process,console:{log(){},error(){}},setTimeout:callback=>{timeout=callback;return 1;},clearTimeout(){}});
    const file=path.join(root,kind==='codex'?'codex-smoke.json':'real-input-verification.json'),running=JSON.parse(fs.readFileSync(file));assert.equal(running.status,'running');timeout();
    const result=JSON.parse(fs.readFileSync(file));assert.equal(result.runId,running.runId);assert.equal(result.status,'failed');assert.match(result.error,/TIMEOUT/);assert.equal(exited,1);if(kind==='codex')assert.equal(stopped,true);
  }
});
