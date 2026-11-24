const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {parseArgs,createFixture}=require('../scripts/store-cost-benchmark.cjs');
const root=path.join(__dirname,'..'),benchmark=path.join(root,'scripts/store-cost-benchmark.cjs');

function lab(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-benchmark-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  for(const label of ['before','after']){
    const project=path.join(directory,label);fs.mkdirSync(path.join(project,'src'),{recursive:true});fs.copyFileSync(path.join(root,'package.json'),path.join(project,'package.json'));
    for(const name of fs.readdirSync(path.join(root,'src')).filter(name=>name.endsWith('.cjs')))fs.copyFileSync(path.join(root,'src',name),path.join(project,'src',name));
    fs.writeFileSync(path.join(project,'src/marker.cjs'),'module.exports='+JSON.stringify(label+'-worker')+';\n');
    const worker=path.join(project,'src/store-worker.cjs'),source=fs.readFileSync(worker,'utf8');fs.writeFileSync(worker,source.replace('snapshot:store.snapshot','snapshot:store.snapshot,benchmarkMarker:require("./marker.cjs")'));
  }
  fs.mkdirSync(path.join(directory,'temporary'));return directory;
}

test('benchmark rejects individual Store paths and malformed arguments before running',()=>{
  for(const args of [[],['--before',path.join(root,'src/store.cjs')],['--before',root,'--samples','0'],['--before',root,'--warmup','-1'],['--before',root,'--sizes','31'],['--before',root,'--cases','unknown'],['--before',root,'--instrumentation','maybe'],['--before',root,'--shapes','unknown'],['--before',root,'--samples','1','--samples','2'],['--before',root,'--reverse'],['--before',root,'--expectations','invalid'],['--before',root,'--reverse-slots','--reverse-slots']])assert.throws(()=>parseArgs(args));
});

test('fixtures are deterministic, contain UTF-8/escapes and vary message count independently of source',()=>{
  const first=createFixture(.03,'long'),same=createFixture(.03,'long'),short=createFixture(.03,'short');assert.deepEqual(first,same);
  const longMessages=JSON.parse(first.histories[0].text).messages,shortMessages=JSON.parse(short.histories[0].text).messages;
  assert.ok(shortMessages.length>longMessages.length);assert.match(longMessages[0].text,/한글/);assert.ok(longMessages[0].text.includes('\n'));assert.ok(first.histories.every(history=>Buffer.byteLength(history.text)<32*1024*1024));
});

test('benchmark uses each complete worker bundle, alternates source order, isolates samples and removes temporary profiles',t=>{
  const directory=lab(t),output=path.join(directory,'result.json'),before=path.join(directory,'before'),after=path.join(directory,'after');
  const originals=new Map();for(const project of [before,after])for(const name of ['package.json',...fs.readdirSync(path.join(project,'src')).map(name=>'src/'+name)])originals.set(path.join(project,name),fs.readFileSync(path.join(project,name)));
  const child=spawnSync(process.execPath,[benchmark,'--before',before,'--after',after,'--samples','2','--warmup','1','--sizes','.003','--cases','first-worker,warm-worker','--instrumentation','off,on','--temp-root',path.join(directory,'temporary'),'--output',output],{encoding:'utf8',timeout:30000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(fs.readFileSync(output));assert.equal(result.results.length,8);assert.notEqual(result.sources[0].bundleHash,result.sources[1].bundleHash);
  assert.ok(result.sources[0].sourceHashes['src/marker.cjs']);assert.ok(result.toolHashes['store-benchmark-probe.cjs']);
  assert.equal(new Set(result.results.map(record=>record.fixtureHash)).size,1);
  for(const record of result.results){assert.equal(record.samples.length,2);assert.deepEqual(record.samples[0].sourceOrder,['after','before']);assert.deepEqual(record.samples[1].sourceOrder,['before','after']);for(const sample of record.samples){assert.equal(sample.correctness,true);assert.ok(Number.isInteger(sample.eventLoopSamples));if(!sample.eventLoopSamples)assert.equal(sample.eventLoopMaxMs,null);assert.equal(sample.retainedHeapDelta,null);assert.equal(sample.setup.expectationsMode,'before');assert.equal(sample.setup.preparedExpectationHistories,2);assert.equal(sample.runnerSlot,record.label==='before'?0:1);assert.deepEqual(sample.workerMarkers,[record.label+'-worker']);if(record.instrumentation==='on'){assert.ok(sample.workerMeasurements[0].writes>0);assert.ok(sample.workerMeasurements[0].stages.stringify.calls>0);}else assert.equal(sample.mainProbe,null);}}
  for(const [file,bytes]of originals)assert.ok(fs.readFileSync(file).equals(bytes),file+' changed');assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});

test('all synchronous benchmark cases assert persisted and active state with on/off probes',t=>{
  const directory=lab(t),output=path.join(directory,'result.json');
  const existing=path.join(directory,'existing.json');fs.writeFileSync(existing,'keep');assert.throws(()=>parseArgs(['--before',root,'--output',existing]),/already exists/);assert.equal(fs.readFileSync(existing,'utf8'),'keep');
  const child=spawnSync(process.execPath,[benchmark,'--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--samples','1','--warmup','0','--sizes','.003','--cases','constructor,read,unchanged,settings,open-other,open-same,new','--instrumentation','off,on','--temp-root',path.join(directory,'temporary'),'--output',output],{encoding:'utf8',timeout:30000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,0,child.stderr);const result=JSON.parse(fs.readFileSync(output));assert.equal(result.results.length,28);assert.ok(result.results.every(record=>record.samples[0].correctness));assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});

test('worker failure and correctness failure reject the run and remove all owned temporary files',t=>{
  for(const failure of ['worker','correctness']){
    const directory=lab(t),worker=path.join(directory,'before/src/store-worker.cjs');
    if(failure==='worker')fs.writeFileSync(worker,'throw Error("injected worker startup failure");\n');
    else fs.writeFileSync(worker,fs.readFileSync(worker,'utf8').replace('store.save();','store.data.messages=[];store.save();'));
    const child=spawnSync(process.execPath,[benchmark,'--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--samples','1','--warmup','0','--sizes','.003','--cases','first-worker','--instrumentation','off','--temp-root',path.join(directory,'temporary')],{encoding:'utf8',timeout:10000});
    assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,1,child.stderr);assert.match(child.stderr,failure==='worker'?/injected worker startup failure/:/AssertionError/);assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
  }
});

test('sample timeout escalates a SIGTERM-ignoring runner to SIGKILL and confirms exit before cleanup',t=>{
  if(process.platform==='win32'){t.skip('POSIX SIGTERM handler behavior');return;}
  const directory=lab(t),pidFile=path.join(directory,'runner.pid');let pid;
  fs.writeFileSync(path.join(directory,'before/src/store.cjs'),'process.on("SIGTERM",()=>{});require("node:fs").writeFileSync('+JSON.stringify(pidFile)+',String(process.pid));while(true){}\n');
  t.after(()=>{if(pid)try{process.kill(pid,'SIGKILL');}catch{}});
  const started=performance.now(),child=spawnSync(process.execPath,[benchmark,'--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--samples','1','--warmup','0','--sizes','.003','--cases','constructor','--instrumentation','off','--timeout-ms','500','--grace-ms','50','--temp-root',path.join(directory,'temporary')],{encoding:'utf8',timeout:5000});
  if(fs.existsSync(pidFile))pid=Number(fs.readFileSync(pidFile,'utf8'));
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,1);assert.match(child.stderr,/sample timeout/);assert.ok(performance.now()-started<4000);
  assert.ok(pid>0);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});

test('idle second-runner spawn errors are handled without waiting for an exit that will never arrive',async t=>{
  const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),vm=require('node:vm'),directory=lab(t),children=[];
  const fromBenchmark=require('node:module').createRequire(benchmark),module={exports:{}};
  const mockRequire=name=>name==='node:child_process'?{fork:()=>{
    const child=new EventEmitter();child.stderr=new PassThrough();child.pid=children.length?undefined:12345;child.signals=[];child.send=()=>{};child.kill=signal=>{child.signals.push(signal);process.nextTick(()=>child.emit('exit',null,signal));return true;};children.push(child);
    if(children.length===2)process.nextTick(()=>child.emit('error',Object.assign(Error('injected idle spawn EAGAIN'),{code:'EAGAIN'})));return child;
  }}:fromBenchmark(name);
  vm.runInNewContext(fs.readFileSync(benchmark,'utf8'),{require:mockRequire,module,__dirname:path.dirname(benchmark),process,Buffer,console,setTimeout,clearTimeout});
  const config=parseArgs(['--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--samples','1','--warmup','0','--sizes','.003','--cases','constructor','--instrumentation','off','--timeout-ms','500','--grace-ms','20','--temp-root',path.join(directory,'temporary')]);
  await assert.rejects(module.exports.run(config),/injected idle spawn EAGAIN/);assert.equal(children.length,2);assert.deepEqual(children[0].signals,['SIGTERM']);assert.deepEqual(children[1].signals,[]);assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});

test('missing or unreadable probe hashes fail before creating benchmark temporary files',async t=>{
  const vm=require('node:vm'),directory=lab(t),fromBenchmark=require('node:module').createRequire(benchmark),module={exports:{}};
  const mockRequire=name=>name==='node:fs'?{...fs,readFileSync:(file,...args)=>{if(file===path.join(root,'scripts/store-benchmark-probe.cjs'))throw Object.assign(Error('injected probe permission failure'),{code:'EACCES'});return fs.readFileSync(file,...args);}}:fromBenchmark(name);
  vm.runInNewContext(fs.readFileSync(benchmark,'utf8'),{require:mockRequire,module,__dirname:path.dirname(benchmark),process,Buffer,console,setTimeout,clearTimeout});
  const config=parseArgs(['--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--temp-root',path.join(directory,'temporary')]);await assert.rejects(module.exports.run(config),/injected probe permission failure/);assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});

test('control callback calibration distinguishes synchronous blocking from an asynchronous wait',async()=>{
  const {queueControlProbe}=require('../scripts/store-benchmark-probe.cjs');
  const noop=queueControlProbe(),noopDelay=await noop.done;assert.ok(Number.isFinite(noopDelay)&&noopDelay>=0);noop.cancel();
  const sync=queueControlProbe(),started=performance.now();while(performance.now()-started<30){}const syncOperationMs=performance.now()-started,syncDelay=await sync.done;assert.ok(syncDelay>=30);assert.ok(syncDelay>=syncOperationMs);sync.cancel();
  let firedDuringWait=false;const asyncProbe=queueControlProbe();asyncProbe.done.then(()=>{firedDuringWait=true;});const asyncStart=performance.now();await new Promise(resolve=>setTimeout(resolve,30));const asyncOperationMs=performance.now()-asyncStart;assert.equal(firedDuringWait,true);const asyncDelay=await asyncProbe.done;assert.ok(asyncDelay<=asyncOperationMs);asyncProbe.cancel();
});

test('canceling a control probe clears its owned timer once and settles its wait',async t=>{
  const {queueControlProbe}=require('../scripts/store-benchmark-probe.cjs'),clear=t.mock.method(globalThis,'clearTimeout'),probe=queueControlProbe();probe.cancel();probe.cancel();assert.equal(await probe.done,null);assert.equal(clear.mock.callCount(),1);
});

test('runner callback calibration observes a synchronous 30ms settings fixture without adding the callback wait to operation time',t=>{
  const directory=lab(t),file=path.join(directory,'after/src/store.cjs'),output=path.join(directory,'callback.json');
  fs.appendFileSync(file,'\nconst benchmarkOriginalSave=Store.prototype.save;Store.prototype.save=function(options){if(options?.includeHistory===false){const start=performance.now();while(performance.now()-start<30){}}return benchmarkOriginalSave.call(this,options);};\n');
  const child=spawnSync(process.execPath,[benchmark,'--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--samples','1','--warmup','0','--sizes','.003','--cases','settings','--instrumentation','off','--temp-root',path.join(directory,'temporary'),'--output',output],{encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,0,child.stderr);const result=JSON.parse(fs.readFileSync(output));assert.equal(result.schemaVersion,4);
  const before=result.results[0].samples[0],after=result.results[1].samples[0];assert.ok(Number.isFinite(before.controlCallbackMs)&&before.controlCallbackMs>=0);assert.ok(after.controlCallbackMs>=30);assert.ok(after.controlCallbackMs>=after.ms);assert.equal(after.correctness,true);assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});

test('deferred expectations preserve every operation check while reverse slots leave request order and fixtures unchanged',t=>{
  const directory=lab(t),output=path.join(directory,'deferred.json');
  const child=spawnSync(process.execPath,[benchmark,'--before',path.join(directory,'before'),'--after',path.join(directory,'after'),'--samples','1','--warmup','0','--sizes','.003','--instrumentation','off,on','--expectations','after','--reverse-slots','--temp-root',path.join(directory,'temporary'),'--output',output],{encoding:'utf8',timeout:30000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(fs.readFileSync(output));assert.equal(result.schemaVersion,4);assert.equal(result.results.length,36);assert.equal(result.config.expectations,'after');assert.equal(result.config.reverseSlots,true);assert.equal(new Set(result.results.map(record=>record.fixtureHash)).size,1);
  for(const record of result.results){
    const sample=record.samples[0];assert.equal(sample.correctness,true);assert.equal(sample.runnerSlot,record.label==='before'?1:0);assert.deepEqual(sample.sourceOrder,['before','after']);assert.equal(sample.setup.expectationsMode,'after');assert.equal(sample.setup.preparedExpectationHistories,0);assert.ok(sample.validationExpectationsMs>=0);
    for(const key of ['fixtureReadParseMs','profileWriteMs','expectationsMs','storePrepareMs','warmWorkerPrepareMs','gcMs','totalMs'])assert.ok(Number.isFinite(sample.setup[key])&&sample.setup[key]>=0,key);
    for(const key of ['beforeSetup','afterFixture','afterProfileWrite','afterExpectations','afterStore','afterWarmWorker','beforeGc','afterGc','beforeOperation']){assert.ok(sample.setup.memory[key].rss>0,key);assert.ok(sample.setup.memory[key].heapUsed>0,key);}
    assert.equal(sample.setup.memory.beforeOperation.rss,sample.rssBefore);assert.ok(result.notes.some(note=>note.includes('cannot remove still-live fixtures')));
  }
  assert.deepEqual(fs.readdirSync(path.join(directory,'temporary')),[]);
});
