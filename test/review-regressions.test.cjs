const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events');

test('integration requires successful evidence, clean exit and profile cleanup independently',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-integration-outcomes-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const scenario of ['passed','missing-result','failed-result','conflicting-result','bad-exit','cleanup-failed']){
    const output=path.join(root,scenario),process={argv:['node','integration','models'],env:{ONGGI_SMOKE_ROOT:output},exitCode:0};let profile;
    const injectedFs={...fs,rmSync:(file,options)=>{if(scenario==='cleanup-failed'&&file===profile)throw Error('injected profile cleanup failure');return fs.rmSync(file,options);}};
    const spawnSync=(_executable,_args,options)=>{
      profile=options.env.ONGGI_SMOKE_ROOT;
      if(scenario!=='missing-result')fs.writeFileSync(path.join(profile,'model-ui-smoke.json'),JSON.stringify({status:scenario==='failed-result'||scenario==='conflicting-result'?'failed':'passed',...(scenario==='conflicting-result'?{passed:true}:{})}));
      return{status:scenario==='bad-exit'?1:0,signal:null};
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/integration-smoke.cjs'),'utf8'),{__dirname:path.join(__dirname,'../scripts'),process,console:{log(){},error(){}},require:name=>name==='electron'?'/fixture/electron':name==='node:child_process'?{spawnSync}:name==='node:fs'?injectedFs:require(name)});
    const result=JSON.parse(fs.readFileSync(path.join(output,'integration.json'))),record=result.results[0];
    assert.equal(result.passed,scenario==='passed',scenario);assert.equal(process.exitCode,scenario==='passed'?0:1,scenario);
    assert.equal(record.profileRemoved,scenario==='passed',scenario);assert.equal(fs.existsSync(profile),scenario!=='passed',scenario);
    if(scenario==='bad-exit'||scenario==='cleanup-failed')assert.equal(record.featurePassed,true);
  }
});

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
