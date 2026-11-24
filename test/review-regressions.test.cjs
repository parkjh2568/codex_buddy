const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events');

test('real-delete smoke clears completion timers/listeners on RPC failure and records cleanup failure',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-smoke-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const timers=new Map();let timerId=0,bridge;
  class Probe extends EventEmitter{
    constructor(){super();bridge=this;this.stopped=false;}
    async connect(){}
    async request(method){
      if(method==='thread/start')return{thread:{id:'owned-test',threadSource:'onggi_bot',cwd:path.join(root,'delete-real-workspace')}};
      if(method==='turn/start')throw Error('injected start failure');
      if(method==='thread/delete')throw Error('injected cleanup failure');
      throw Error('Unexpected request');
    }
    stop(){this.stopped=true;}
  }
  const process={env:{ONGGI_SMOKE_ROOT:root},exitCode:0};
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/codex-delete-smoke.cjs'),'utf8'),{require:name=>name==='../src/codex.cjs'?{CodexConnection:Probe}:require(name),__dirname:path.join(__dirname,'../scripts'),process,console:{log(){},error(){}},setTimeout:(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
  assert.equal(process.exitCode,1);assert.equal(bridge.stopped,true);assert.equal(timers.size,0);assert.equal(bridge.listenerCount('notification'),0);
  const result=JSON.parse(fs.readFileSync(path.join(root,'real-delete-smoke.json'),'utf8'));assert.equal(result.status,'failed');assert.equal(result.createdForTest,'owned-test');assert.match(result.cleanup,/cleanup failure/);
});

test('native floating screenshot failure is caught in the callback and never records passed',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-native-smoke-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const module={exports:{}},handlers=new Map();let tick,bounds={x:450,y:250,width:120,height:143},quit=0,exit=0,cleared=0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/native-floating-smoke.cjs'),'utf8'),{module,require,__dirname:path.join(__dirname,'../scripts'),process:{platform:'darwin',env:{ONGGI_SMOKE_ROOT:root}},console:{log(){},error(){}},setTimeout:callback=>{callback();return 1;},setInterval:callback=>{tick=callback;return 2;},clearInterval:()=>cleared++});
  await module.exports({app:{quit:()=>quit++,exit:code=>{exit=code;}},pet:{webContents:{executeJavaScript:async()=>{},send(){}},setPosition(){},getBounds:()=>bounds,on:(event,handler)=>handlers.set(event,handler)},panel:{hide(){},isVisible:()=>true,webContents:{capturePage:async()=>{throw Error('injected screenshot failure');}}},screen:{getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1000,height:800}})},getDrag:()=>true});
  bounds={...bounds,x:-10};handlers.get('move')();bounds={...bounds,x:950};handlers.get('move')();await tick();
  assert.equal(quit,0);assert.equal(exit,1);assert.ok(cleared>0);const result=JSON.parse(fs.readFileSync(path.join(root,'native-floating-smoke.json'),'utf8'));assert.equal(result.status,'failed');assert.match(result.error,/screenshot failure/);
});

test('image decoder stops at the aggregate pixel budget and releases each decoded image/window',async()=>{
  let decoded=0,closed=0,destroyed=0;
  class Window{
    constructor(){this.webContents={setWindowOpenHandler(){},on(){},once(){},session:{setPermissionRequestHandler(){}},executeJavaScript:async source=>vm.runInNewContext(source,{Uint8Array,atob:source=>Buffer.from(source,'base64').toString('binary'),Blob:class Blob{},createImageBitmap:async()=>{decoded++;return{width:2,height:2,close:()=>closed++};}})};}
    async loadFile(){}
    isDestroyed(){return false;}
    destroy(){destroyed++;}
  }
  const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/asset-validator.cjs'),'utf8'),{require:name=>name==='electron'?{BrowserWindow:Window}:require(name),module,__dirname:path.join(__dirname,'../src'),setTimeout,clearTimeout});
  const pack={manifest:{states:{}},imageFiles:['one','two','three'].map(file=>({file,source:'data:image/png;base64,AA==',width:2,height:2,frameCount:1})),assets:{},animationFrames:[]};
  await assert.rejects(new module.exports.AssetValidator().validate(pack,10000,{maxPixels:5}),/픽셀 예산/);
  assert.equal(decoded,2);assert.equal(closed,2);assert.equal(destroyed,1);assert.equal(pack.decoded,undefined);
});

test('delete fixture explicitly completes held owned turns and never replays completed or interrupted turns',async t=>{
  const {CodexConnection}=require('../src/codex.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-delete-fixture-control-')),bridge=new CodexConnection(),notifications=[];
  t.after(async()=>{const child=bridge.process,closed=child&&child.exitCode===null&&child.signalCode===null?new Promise(resolve=>child.once('exit',resolve)):null;bridge.stop();if(closed)await closed;fs.rmSync(root,{recursive:true,force:true});});
  bridge.on('notification',message=>notifications.push(message));await bridge.connect(path.join(__dirname,'fixtures/delete-codex.cjs'),root);
  const threadId=(await bridge.request('thread/start',{threadSource:'onggi_bot'})).thread.id,input=[{type:'text',text:'held persona snapshot'}];await bridge.request('test/hold',{enabled:true});
  const first=(await bridge.request('turn/start',{threadId,input,model:'test-main',effort:'low',collaborationMode:{settings:{developer_instructions:'preserved instructions'}}})).turn.id;
  await new Promise(resolve=>setTimeout(resolve,950));assert.equal((await bridge.request('thread/read',{threadId})).thread.turns[0].status,'inProgress');assert.equal(notifications.filter(message=>message.method==='turn/completed').length,0);
  await assert.rejects(bridge.request('test/complete-current',{threadId,turnId:'foreign-turn'}),/own/);await bridge.request('test/complete-current',{threadId,turnId:first});await bridge.request('test/complete-current',{});
  const second=(await bridge.request('turn/start',{threadId,input,model:'test-small',effort:'medium'})).turn.id;await bridge.request('turn/interrupt',{threadId,turnId:second});await bridge.request('test/complete-current',{});await bridge.request('turn/interrupt',{threadId,turnId:second});
  const third=(await bridge.request('turn/start',{threadId,input,model:'test-main',effort:'high'})).turn.id;await assert.rejects(bridge.request('test/complete-current',{threadId,turnId:second}),/own/);await bridge.request('test/complete-current',{threadId,turnId:third});
  await bridge.request('test/hold',{enabled:false});const fourth=(await bridge.request('turn/start',{threadId,input,model:'test-main',effort:'low'})).turn.id;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{bridge.off('notification',completed);reject(Error('Default fixture timer did not complete'));},3000);const completed=message=>{if(message.method==='turn/completed'&&message.params.turn.id===fourth){clearTimeout(timer);bridge.off('notification',completed);resolve();}};bridge.on('notification',completed);});
  const completions=notifications.filter(message=>message.method==='turn/completed');assert.deepEqual(completions.map(message=>message.params.turn.id),[first,second,third,fourth]);assert.deepEqual(completions.map(message=>message.params.turn.status),['completed','interrupted','completed','completed']);
  const persisted=JSON.parse(fs.readFileSync(path.join(root,'delete-fixture-threads.json'),'utf8')).threads[0][1].turns;assert.deepEqual(persisted.map(turn=>turn.status),['completed','interrupted','completed','completed']);assert.equal(persisted[0].personaInstructions,'preserved instructions');assert.equal(persisted[0].items[1].text.includes('test-main / low'),true);assert.equal(persisted[1].items.length,1);
});
