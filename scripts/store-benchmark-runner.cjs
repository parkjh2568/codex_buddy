const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const threads=require('node:worker_threads');
const {installProbe,queueControlProbe}=require('./store-benchmark-probe.cjs');
const [projectRoot,workRoot,instrumentation]=process.argv.slice(2),NativeWorker=threads.Worker;
let postMs=0,workerMeasurements=[],workerMarkers=[];
threads.Worker=class extends NativeWorker{
  constructor(file,options){
    super(instrumentation==='on'?path.join(__dirname,'store-benchmark-worker.cjs'):file,instrumentation==='on'?{...options,workerData:{...options.workerData,benchmarkTarget:file}}:options);
    this.on('message',message=>{if(message.benchmarkProbe)workerMeasurements.push(message.benchmarkProbe);if(message.benchmarkMarker)workerMarkers.push(message.benchmarkMarker);});
  }
  postMessage(...args){const start=performance.now();try{return super.postMessage(...args);}finally{postMs+=performance.now()-start;}}
};
const {Store}=require(path.join(projectRoot,'src/store.cjs'));
const probe=instrumentation==='on'?installProbe():null;
let requestCount=0;
process.on('message',async request=>{
  const profile=path.join(workRoot,'profile-'+requestCount++);let store,histogram,readResult,controlProbe;
  try{
    const setupStarted=performance.now(),setup={memory:{beforeSetup:process.memoryUsage()}};let phaseStarted=setupStarted;
    const fixture=JSON.parse(fs.readFileSync(request.fixture,'utf8'));
    setup.fixtureReadParseMs=performance.now()-phaseStarted;setup.memory.afterFixture=process.memoryUsage();phaseStarted=performance.now();
    fs.mkdirSync(path.join(profile,'conversations'),{recursive:true});
    fs.writeFileSync(path.join(profile,'state.json'),fixture.state);
    for(const history of fixture.histories)fs.writeFileSync(path.join(profile,'conversations',history.id+'.json'),history.text);
    setup.profileWriteMs=performance.now()-phaseStarted;setup.memory.afterProfileWrite=process.memoryUsage();
    const first=fixture.histories[0],second=fixture.histories[1];let expected,expectedOther;phaseStarted=performance.now();
    if((request.expectations??'before')==='before'){expected=JSON.parse(first.text);expectedOther=JSON.parse(second.text);}
    setup.expectationsMode=request.expectations??'before';setup.preparedExpectationHistories=setup.expectationsMode==='before'?2:0;setup.expectationsMs=performance.now()-phaseStarted;setup.memory.afterExpectations=process.memoryUsage();phaseStarted=performance.now();
    if(request.case!=='constructor')store=new Store(profile,{});
    setup.storePrepareMs=performance.now()-phaseStarted;setup.memory.afterStore=process.memoryUsage();phaseStarted=performance.now();
    if(request.case==='warm-worker')await store.saveAsync();
    setup.warmWorkerPrepareMs=performance.now()-phaseStarted;setup.memory.afterWarmWorker=process.memoryUsage();
    if(request.case==='settings')store.data.settings.skinId='night';
    if(request.case==='warm-worker'||request.case==='first-worker')store.data.messages[0].text+=' changed';
    postMs=0;workerMeasurements=[];workerMarkers=[];setup.memory.beforeGc=process.memoryUsage();phaseStarted=performance.now();globalThis.gc?.();setup.gcMs=performance.now()-phaseStarted;setup.memory.afterGc=process.memoryUsage();
    histogram=monitorEventLoopDelay({resolution:1});histogram.enable();await new Promise(resolve=>setTimeout(resolve,5));histogram.reset();
    setup.totalMs=performance.now()-setupStarted;const memory=process.memoryUsage(),cpu=process.cpuUsage();setup.memory.beforeOperation=memory;controlProbe=queueControlProbe();probe?.start();const start=performance.now();
    if(request.case==='constructor')store=new Store(profile,{});
    else if(request.case==='read')readResult=store.readHistory(first.id);
    else if(request.case==='unchanged')store.save();
    else if(request.case==='settings')store.save({includeHistory:false});
    else if(request.case==='first-worker'||request.case==='warm-worker')await store.saveAsync();
    else if(request.case==='open-other')store.openConversation(second.id);
    else if(request.case==='open-same')store.openConversation(first.id);
    else if(request.case==='new')store.newConversation();
    else throw Error('Unknown benchmark case');
    const ms=performance.now()-start,measurement=probe?.stop()??null,cpuUsage=process.cpuUsage(cpu),memoryAfter=process.memoryUsage();
    const controlCallbackMs=await controlProbe.done;controlProbe=null;
    await new Promise(resolve=>setTimeout(resolve,5));const eventLoopSamples=histogram.count,eventLoopMaxMs=eventLoopSamples?histogram.max/1e6:null;histogram.disable();histogram=null;
    phaseStarted=performance.now();if((request.expectations??'before')==='after'){expected=JSON.parse(first.text);expectedOther=JSON.parse(second.text);}const validationExpectationsMs=performance.now()-phaseStarted;
    assert.equal(store.writeBlocked,false,store.warning);assert.equal(store.warning,null);
    const diskState=JSON.parse(fs.readFileSync(path.join(profile,'state.json'),'utf8'));
    const diskFirst=JSON.parse(fs.readFileSync(path.join(profile,'conversations',first.id+'.json'),'utf8'));
    const diskOther=JSON.parse(fs.readFileSync(path.join(profile,'conversations',second.id+'.json'),'utf8'));
    assert.deepEqual(diskOther,expectedOther);
    const wanted=request.case==='first-worker'||request.case==='warm-worker'?{...expected,messages:expected.messages.map((message,index)=>index?message:{...message,text:message.text+' changed'})}:expected;
    assert.deepEqual(diskFirst,wanted);if(request.case==='read')assert.deepEqual(readResult,expected);
    if(request.case==='new'){assert.equal(store.data.activeConversationId,null);assert.equal(diskState.activeConversationId,null);assert.equal(store.data.messages.length,0);}
    else{const target=request.case==='open-other'?expectedOther:wanted;assert.equal(store.data.activeConversationId,target.id);assert.equal(diskState.activeConversationId,target.id);assert.deepEqual(store.data.messages,target.messages);assert.equal(store.data.threadId,target.threadId);}
    if(request.case==='settings'){assert.equal(diskState.settings.skinId,'night');assert.equal(store.data.settings.skinId,'night');}
    await store.closeWorker();store=null;
    fs.rmSync(profile,{recursive:true,force:true});
    process.send({ok:true,requestId:request.requestId,sample:{ms,controlCallbackMs,setup,validationExpectationsMs,cpuMs:(cpuUsage.user+cpuUsage.system)/1000,postMs,eventLoopMaxMs,eventLoopSamples,gcUsed:typeof globalThis.gc==='function',retainedHeapDelta:null,heapDelta:memoryAfter.heapUsed-memory.heapUsed,rssBefore:memory.rss,rssAfter:memoryAfter.rss,mainProbe:measurement,workerMeasurements,workerMarkers,correctness:true}});
  }catch(error){
    controlProbe?.cancel();probe?.stop();histogram?.disable();
    if(store)await store.closeWorker().catch(()=>{});
    fs.rmSync(profile,{recursive:true,force:true});
    process.send({ok:false,requestId:request.requestId,error:error.stack});
  }
});
