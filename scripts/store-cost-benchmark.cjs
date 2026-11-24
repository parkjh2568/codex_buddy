const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{fork}=require('node:child_process');
const allCases=['constructor','read','unchanged','settings','first-worker','warm-worker','open-other','open-same','new'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function parseArgs(args){
  const config={before:null,after:path.resolve(__dirname,'..'),output:null,samples:20,warmup:3,timeoutMs:120000,graceMs:500,sizes:[1,30],cases:allCases,instrumentation:['off','on'],shapes:['long'],expectations:'before',reverseSlots:false,tempRoot:os.tmpdir()};
  const names={'--before':'before','--after':'after','--output':'output','--samples':'samples','--warmup':'warmup','--timeout-ms':'timeoutMs','--grace-ms':'graceMs','--sizes':'sizes','--cases':'cases','--instrumentation':'instrumentation','--shapes':'shapes','--expectations':'expectations','--temp-root':'tempRoot'},seen=new Set();
  for(let i=0;i<args.length;i++){
    const name=args[i];if(name==='--reverse-slots'){if(seen.has('reverseSlots'))throw Error('Duplicate --reverse-slots');seen.add('reverseSlots');config.reverseSlots=true;continue;}const key=names[name];if(!key||seen.has(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --before <project-directory> [--after <project-directory>] [--output <json>] [--samples N] [--warmup N] [--sizes 1,30] [--cases '+allCases.join(',')+'] [--instrumentation off,on] [--shapes long,short] [--temp-root directory] [--timeout-ms N] [--grace-ms N] [--expectations before|after] [--reverse-slots]');
    seen.add(key);const value=args[++i];config[key]=['samples','warmup','timeoutMs','graceMs'].includes(key)?Number(value):['sizes','cases','instrumentation','shapes'].includes(key)?value.split(','):key==='expectations'?value:path.resolve(value);
  }
  if(!config.before)throw Error('--before requires a complete project directory; individual Store files are not supported.');
  if(!Number.isSafeInteger(config.samples)||config.samples<1||config.samples>1000||!Number.isSafeInteger(config.warmup)||config.warmup<0||config.warmup>100)throw Error('Invalid samples/warmup');
  if(!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<10||config.timeoutMs>600000||!Number.isSafeInteger(config.graceMs)||config.graceMs<10||config.graceMs>10000)throw Error('Invalid timeout/grace milliseconds');
  config.sizes=config.sizes.map(Number);if(config.sizes.some(n=>!Number.isFinite(n)||n<.001||n>30)||new Set(config.sizes).size!==config.sizes.length)throw Error('Sizes must be distinct MiB values between 0.001 and 30.');
  if(!['before','after'].includes(config.expectations))throw Error('Invalid expectations timing');
  for(const [key,allowed]of [['cases',allCases],['instrumentation',['off','on']],['shapes',['long','short']]])if(config[key].some(value=>!allowed.includes(value))||new Set(config[key]).size!==config[key].length)throw Error('Invalid '+key);
  for(const root of [config.before,config.after])if(!fs.statSync(root).isDirectory()||!fs.statSync(path.join(root,'src/store.cjs')).isFile()||!fs.statSync(path.join(root,'src/store-worker.cjs')).isFile()||!fs.statSync(path.join(root,'package.json')).isFile())throw Error('Each source must be a project directory with package.json and src/store.cjs + store-worker.cjs.');
  if(config.output&&fs.existsSync(config.output))throw Error('Output already exists; choose a new file.');
  if(!fs.statSync(config.tempRoot).isDirectory())throw Error('Temporary parent must be a directory.');return config;
}

function createFixture(sizeMiB,shape){
  const timestamp=1700000000000,ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'],target=Math.floor(sizeMiB*1024*1024),textBytes=shape==='short'?400:99000;
  const messages=[];let estimated=150;
  while(estimated<target){
    const index=messages.length,message={id:'message-'+index,role:index%2?'assistant':'user',text:'한글 \\ "\n'+ 'x'.repeat(Math.max(1,Math.min(textBytes,target-estimated-150))),status:'completed',createdAt:timestamp,mode:'demo'};
    const bytes=Buffer.byteLength(JSON.stringify(message))+1;messages.push(message);estimated+=bytes;
  }
  const histories=ids.map((id,index)=>({id,text:JSON.stringify({id,source:'onggi_bot',threadId:'synthetic-'+index,messages})}));
  for(const history of histories)assert.ok(Buffer.byteLength(history.text)<=32*1024*1024,'Fixture exceeds the existing history limit');
  const state=JSON.stringify({version:2,settings:{demo:true,workspace:'/synthetic-workspace',codexPath:'/synthetic-codex'},activeConversationId:ids[0],conversations:ids.map((id,index)=>({id,source:'onggi_bot',threadId:'synthetic-'+index,title:'Synthetic '+index,titleSource:'manual',createdAt:timestamp,updatedAt:timestamp,mode:'demo',messageCount:messages.length,workspace:'/synthetic-workspace',codexPath:'/synthetic-codex'}))});
  return{state,histories};
}

async function stopRunner(runner,graceMs){
  runner.stopping=true;
  for(const [signal,timeout]of [['SIGTERM',graceMs],['SIGKILL',Math.max(graceMs,1000)]]){
    if(runner.exited||runner.failedSpawn)return;
    try{runner.child.kill(signal);}catch(error){runner.failure??=error;}
    const ended=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),timeout);runner.ended.then(()=>{clearTimeout(timer);resolve(true);});});
    if(ended)return;
  }
  throw Error('Benchmark runner termination could not be confirmed; temporary files must be preserved.');
}

async function run(config){
  const toolFiles=['store-cost-benchmark.cjs','store-benchmark-runner.cjs','store-benchmark-worker.cjs','store-benchmark-probe.cjs'],toolHashes=Object.fromEntries(toolFiles.map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))]));
  const temporary=fs.mkdtempSync(path.join(config.tempRoot,'onggi-store-benchmark-')),children=[],pending=new Set(),results=[],sources=[],fixtures=[];
  try{
    for(const [label,root]of [['before',config.before],['after',config.after]]){
      const destination=path.join(temporary,label),sourceHashes={};fs.mkdirSync(path.join(destination,'src'),{recursive:true});
      for(const file of ['package.json',...fs.readdirSync(path.join(root,'src'),{recursive:true}).filter(file=>file.endsWith('.cjs')&&fs.statSync(path.join(root,'src',file)).isFile()).sort().map(file=>'src/'+file)]){
        const bytes=fs.readFileSync(path.join(root,file));sourceHashes[file]=hash(bytes);fs.mkdirSync(path.dirname(path.join(destination,file)),{recursive:true});fs.writeFileSync(path.join(destination,file),bytes,{flag:'wx'});
      }
      sources.push({label,root,destination,sourceHashes,bundleHash:hash(JSON.stringify(sourceHashes))});
    }
    for(const sizeMiB of config.sizes)for(const shape of config.shapes){
      const fixture=createFixture(sizeMiB,shape),file=path.join(temporary,'fixture-'+fixtures.length+'.json'),bytes=JSON.stringify(fixture);
      fs.writeFileSync(file,bytes,{flag:'wx'});const fixtureInfo={sizeMiB,shape,hash:hash(bytes),historyBytes:fixture.histories.map(history=>Buffer.byteLength(history.text)),messages:JSON.parse(fixture.histories[0].text).messages.length};fixtures.push(fixtureInfo);
      for(const instrumentation of config.instrumentation)for(const caseName of config.cases){
        const runners=[];
        for(const sourceIndex of config.reverseSlots?[1,0]:[0,1]){
          const source=sources[sourceIndex],slot=runners.filter(Boolean).length;
          const workRoot=path.join(temporary,'work-'+source.label);fs.mkdirSync(workRoot,{recursive:true});
          const child=fork(path.join(__dirname,'store-benchmark-runner.cjs'),[source.destination,workRoot,instrumentation],{stdio:['ignore','ignore','pipe','ipc']});
          const runner={child,source,slot,exited:false,failedSpawn:false,stopping:false,failure:null,stderr:''};runner.ended=new Promise(resolve=>{runner.resolveEnd=resolve;});children.push(runner);
          // These listeners cover idle runners and failed spawns, including a child that never emits exit.
          child.on('error',error=>{runner.failure??=error;if(!child.pid){runner.failedSpawn=true;runner.resolveEnd();}if(!runner.stopping)for(const finish of pending)finish(error);});
          child.on('exit',(code,signal)=>{runner.exited=true;runner.resolveEnd();if(!runner.stopping){runner.failure??=Error('Benchmark runner exited '+(signal??code)+' '+runner.stderr);for(const finish of pending)finish(runner.failure);}});
          child.stderr?.on('data',chunk=>{runner.stderr=(runner.stderr+chunk.toString()).slice(-16384);});
          runners[sourceIndex]=runner;
        }
        const records=sources.map(source=>({label:source.label,sizeMiB,shape,case:caseName,instrumentation,fixtureHash:fixtureInfo.hash,samples:[]}));
        try{
          for(let iteration=0;iteration<config.warmup+config.samples;iteration++){
            const order=iteration%2?[1,0]:[0,1];
            for(const index of order){
              const runner=runners[index],sample=await new Promise((resolve,reject)=>{
                if(runner.failure||runner.exited||runner.failedSpawn){reject(runner.failure??Error('Benchmark runner is unavailable'));return;}
                const requestId=caseName+'-'+iteration+'-'+index;let done=false;
                const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);runner.child.off('message',onMessage);runner.child.off('exit',onExit);runner.child.off('error',onError);pending.delete(finish);if(error)reject(error);else resolve(value);};
                const onMessage=message=>{if(message.requestId!==requestId)return;finish(message.ok?null:Error(message.error),message.sample);},onExit=(code,signal)=>finish(Error('Benchmark runner exited '+(signal??code)+' '+runner.stderr)),onError=error=>finish(error);
                const timer=setTimeout(()=>finish(Error('Benchmark sample timeout')),config.timeoutMs??120000);pending.add(finish);
                runner.child.on('message',onMessage);runner.child.once('exit',onExit);runner.child.once('error',onError);
                runner.child.send({requestId,case:caseName,fixture:file,expectations:config.expectations??'before'},error=>{if(error)finish(error);});
              });
              if(iteration>=config.warmup)records[index].samples.push({...sample,runnerSlot:runner.slot,iteration:iteration-config.warmup,sourceOrder:order.map(i=>sources[i].label)});
            }
          }
          for(const record of records){const sorted=record.samples.map(sample=>sample.ms).sort((a,b)=>a-b);record.summary={medianMs:sorted.length%2?sorted[Math.floor(sorted.length/2)]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2,p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};results.push(record);}
        }finally{
          const stopped=await Promise.allSettled(runners.map(runner=>stopRunner(runner,config.graceMs??500)));
          for(let i=0;i<runners.length;i++)if(stopped[i].status==='fulfilled')children.splice(children.indexOf(runners[i]),1);
          const failure=stopped.find(result=>result.status==='rejected');if(failure)throw failure.reason;
        }
      }
    }
    return{schemaVersion:4,status:'passed',at:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch,os:os.release(),gcAvailable:typeof globalThis.gc==='function',cpus:os.cpus().map(cpu=>cpu.model),power:'not observed',otherDesktopLoad:'not controlled'},config,sources:sources.map(({destination,...source})=>source),toolHashes,fixtures,results,notes:['Synthetic local Node profiles, no GUI or real model calls.','Alternating before/after request order per iteration; source labels remain fixed. reverseSlots changes process fork order independently of request order. runnerSlot records the fork position, not CPU affinity.',
      'Fresh profile per operation. Setup phase timings and memory checkpoints are outside operation ms. Expectations are parsed before or after the measured operation as explicitly selected; after reduces live expected objects but retains the same fixture strings and checks.',
      'Explicit exposed GC runs once after setup, with before/after memory and duration recorded; this cannot remove still-live fixtures or ensure background GC is idle. No GC events or OS scheduler/page-fault events are observed.','Instrumentation on/off use separate child processes. Inclusive stage durations can overlap; do not add them as total duration. Normalization is included in total, not separately timed.','Worker startup probe includes its constructor/recovery. Warm-worker probe resets at the preceding ACK. postMessage duration is a transport probe in both modes.','controlCallbackMs is monotonic queue-to-callback latency of one 0-delay timer queued immediately before the operation; it is awaited after total ms/CPU/memory sampling and excludes correctness checks. It captures the first callback delay, not all stalls or Electron IPC response time.',
      'The histogram can miss synchronous stalls because of sampling alignment/reset; eventLoopMaxMs is auxiliary and excluded from main-blocking acceptance. A low histogram value does not imply a responsive main loop.',
      '1ms event-loop monitor, first-callback timer and transport probe add overhead in both modes; on mode additionally wraps fs/JSON/TextDecoder/SHA.','Successful writeFileSync payload bytes exclude metadata, physical disk writes and failed partial writes. RSS endpoints are not peak RSS; heap delta is before GC, not retained heap (null). Optional exposed GC runs after setup and outside measurement; gcUsed records it. CPU includes workers but not renderer/CLI.','Warm filesystem cache; fresh profiles do not imply cold I/O. n=20 p95 is the 19th sorted observation, not a production SLO.','Schema v4 setup/lifetime/slot experiments are causality probes on pinned source bundles; they do not retroactively validate a changed product source. No repeated-run stopping rule is chosen by this tool.',
      'Not covered: v1, empty/corrupt/journal recovery, active read failure, 8/24MiB unless selected, metadata-only registry, 5000 conversations, cache quotas, page amplification, fresh-process startup distribution, GUI/physical input and battery.']};
  }finally{
    for(const finish of pending)finish(Error('Benchmark stopped'));
    const stopped=await Promise.allSettled(children.map(runner=>stopRunner(runner,config.graceMs??500)));
    const failure=stopped.find(result=>result.status==='rejected');if(failure)throw Error(failure.reason.message+' Preserved: '+temporary);
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}

if(require.main===module)(async()=>{
  const config=parseArgs(process.argv.slice(2)),result=await run(config);
  if(config.output)fs.writeFileSync(config.output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  for(const record of result.results)console.log(JSON.stringify({label:record.label,sizeMiB:record.sizeMiB,shape:record.shape,case:record.case,instrumentation:record.instrumentation,...record.summary}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={parseArgs,createFixture,run};
