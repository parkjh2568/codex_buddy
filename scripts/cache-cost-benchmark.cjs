const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks'),{deflateSync}=require('node:zlib');

async function run(){
  const allCases=['new-file-1','new-file-8','duplicate-file-1','duplicate-file-8','new-image-1','new-image-8','duplicate-image-1','duplicate-image-8','mixed'];
  let counts=[0],cases=['new-file-1','duplicate-file-1','mixed'],samples=1,payloadBytes=1024,output=null,tempParent=os.tmpdir(),instrumentation=true;
  for(let index=2;index<process.argv.length;index++){
    const option=process.argv[index],value=process.argv[++index];if(!value)throw Error('Each option requires a value.');
    if(option==='--files'){counts=value.split(',').map(Number);if(!counts.length||counts.some(n=>!Number.isSafeInteger(n)||n<0||n>10000)||new Set(counts).size!==counts.length)throw Error('--files requires unique counts from 0 through 10000.');}
    else if(option==='--cases'){cases=value==='all'?allCases:value.split(',');if(!cases.length||cases.some(name=>!allCases.includes(name))||new Set(cases).size!==cases.length)throw Error('Unknown or repeated cache case.');}
    else if(option==='--samples'){samples=Number(value);if(!Number.isSafeInteger(samples)||samples<1||samples>50)throw Error('--samples requires 1 through 50.');}
    else if(option==='--bytes'){payloadBytes=Number(value);if(!Number.isSafeInteger(payloadBytes)||payloadBytes<1||payloadBytes>4*1024*1024)throw Error('--bytes requires 1 through 4194304 (eight files stay within 32MiB).');}
    else if(option==='--output')output=path.resolve(value);
    else if(option==='--temp-parent')tempParent=path.resolve(value);
    else if(option==='--instrumentation'){if(!['on','off'].includes(value))throw Error('--instrumentation requires on or off.');instrumentation=value==='on';}
    else throw Error('Unknown option: '+option);
  }
  if(output&&fs.existsSync(output))throw Error('Output already exists; refusing to overwrite it.');
  const sourceFiles=['src/cache-quota.cjs','src/attachments.cjs','src/response-images.cjs','src/bounded-file.cjs'],sourceHashes={};
  for(const file of sourceFiles)sourceHashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex');
  const toolFile=path.join(__dirname,'cache-cost-benchmark.cjs'),toolHash=crypto.createHash('sha256').update(fs.readFileSync(toolFile)).digest('hex');
  const nativeHash=crypto.createHash,restore=[],linked=new Set(),root=fs.mkdtempSync(path.join(tempParent,'onggi-cache-benchmark-')),results=[];
  let active=null,boundedDepth=0;
  try{
    // Probe only this isolated Node process. Stages overlap and must not be summed.
    if(instrumentation){
      for(const name of ['lstatSync','statSync','fstatSync','linkSync','unlinkSync']){
        const original=fs[name];
        fs[name]=function(...args){const metric=active,start=performance.now();try{const result=original.apply(this,args);if(metric){if(name.endsWith('statSync'))metric.syncStatCalls++;if(name==='linkSync'){metric.links++;linked.add(args[0]);}if(name==='unlinkSync')metric.unlinks++;}return result;}finally{if(metric){const ms=performance.now()-start;if(name==='linkSync')metric.stages.linkMs+=ms;else if(!boundedDepth&&linked.has(args[0]))metric.stages.cleanupMs+=ms;}}};
        restore.push(()=>{fs[name]=original;});
      }
      const read=fs.readSync;fs.readSync=function(...args){const metric=active,start=performance.now();try{const count=read.apply(this,args);if(metric){metric.syncReadCalls++;metric.syncReadBytes+=count;}return count;}finally{if(metric)metric.stages.syncReadMs+=performance.now()-start;}};restore.push(()=>{fs.readSync=read;});
      const write=fs.promises.writeFile;fs.promises.writeFile=async function(target,data,...args){const metric=active,start=performance.now();try{const result=await write.call(this,target,data,...args);if(metric){metric.successfulWriteCalls++;metric.successfulPayloadWriteBytes+=typeof data==='string'?Buffer.byteLength(data):data.byteLength;}return result;}finally{if(metric)metric.stages.stagingWriteMs+=performance.now()-start;}};restore.push(()=>{fs.promises.writeFile=write;});
      crypto.createHash=function(...args){const hash=nativeHash.apply(this,args),update=hash.update,digest=hash.digest;
        hash.update=function(data,...rest){const metric=active,start=performance.now();try{const result=update.call(this,data,...rest);if(metric){metric.hashUpdates++;metric.hashInputBytes+=typeof data==='string'?Buffer.byteLength(data,rest[0]):data.byteLength;}return result;}finally{if(metric)metric.stages.hashMs+=performance.now()-start;}};
        hash.digest=function(...rest){const metric=active,start=performance.now();try{return digest.apply(this,rest);}finally{if(metric)metric.stages.hashMs+=performance.now()-start;}};return hash;
      };restore.push(()=>{crypto.createHash=nativeHash;});
    }
    const bounded=require('../src/bounded-file.cjs'),readBoundedFile=bounded.readBoundedFile;
    if(instrumentation){bounded.readBoundedFile=function(file,...args){const metric=active,start=performance.now();boundedDepth++;try{const bytes=readBoundedFile(file,...args);if(metric)metric.boundedReadBytes+=bytes.length;return bytes;}finally{boundedDepth--;if(metric){const ms=performance.now()-start;metric.stages.boundedReadMs+=ms;if(linked.has(file))metric.stages.cleanupMs+=ms;}}};restore.push(()=>{bounded.readBoundedFile=readBoundedFile;});}
    const {CacheQuotaBatch}=require('../src/cache-quota.cjs'),{ResponseImages}=require('../src/response-images.cjs'),{AttachmentStore}=require('../src/attachments.cjs');
    if(instrumentation)for(const name of ['prepare','verify']){
      const original=CacheQuotaBatch.prototype[name];
      if(name==='prepare')CacheQuotaBatch.prototype[name]=async function(...args){const metric=active,start=performance.now();if(metric)metric.prepareCalls++;try{return await original.apply(this,args);}finally{if(metric)metric.stages.prepareMs+=performance.now()-start;}};
      else CacheQuotaBatch.prototype[name]=function(...args){const metric=active,start=performance.now();if(metric)metric.verifyCalls++;try{return original.apply(this,args);}finally{if(metric)metric.stages.verifyMs+=performance.now()-start;}};
      restore.push(()=>{CacheQuotaBatch.prototype[name]=original;});
    }
    const pngs=[];
    for(let index=0;index<8;index++){
      const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
      const chunks=[Buffer.from([137,80,78,71,13,10,26,10])];
      for(const [type,data]of [['IHDR',header],['IDAT',deflateSync(Buffer.from([0,index*23,90,150,255]))],['IEND',Buffer.alloc(0)]]){
        const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length,0);chunk.write(type,4);data.copy(chunk,8);let crc=0xffffffff;
        for(const byte of chunk.subarray(4,8+data.length)){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}chunk.writeUInt32BE((crc^0xffffffff)>>>0,8+data.length);chunks.push(chunk);
      }
      pngs.push(Buffer.concat(chunks));
    }
    for(const count of counts)for(const scenario of cases)for(let sample=0;sample<samples;sample++){
      const directory=path.join(root,`${count}-${scenario}-${sample}`),imageRoot=path.join(directory,'images'),fileRoot=path.join(directory,'files');fs.mkdirSync(directory);
      const images=new ResponseImages(imageRoot,{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),attachments=new AttachmentStore(fileRoot,images);
      for(const folder of [fileRoot,imageRoot])for(let index=0;index<count;index++)fs.writeFileSync(path.join(folder,'fixture-'+index+'.bin'),'existing cache fixture '+index);
      let input;
      if(scenario==='mixed')input=[{name:'first.txt',bytes:Buffer.alloc(payloadBytes,11)},{name:'image.png',bytes:pngs[0]},{name:'last.txt',bytes:Buffer.alloc(payloadBytes,12)}];
      else input=Array.from({length:Number(scenario.at(-1))},(_,index)=>({name:`input-${index}.${scenario.includes('image')?'png':'txt'}`,bytes:scenario.includes('image')?pngs[index]:Buffer.alloc(payloadBytes,index+1)}));
      if(scenario.startsWith('duplicate'))await attachments.import(input);
      const before=new Map(),expected=new Map();
      for(const folder of [fileRoot,imageRoot]){
        expected.set(folder,new Set(fs.readdirSync(folder)));
        for(const name of expected.get(folder)){const file=path.join(folder,name);before.set(file,{bytes:fs.readFileSync(file),stat:fs.statSync(file)});}
      }
      for(const item of input){const hash=nativeHash('sha256').update(item.bytes).digest('hex');expected.get(item.name.endsWith('.png')?imageRoot:fileRoot).add(hash+(item.name.endsWith('.png')?'.png':'.txt'));}
      const fixtureHash=nativeHash('sha256').update(JSON.stringify({count,scenario,payloadBytes,inputs:input.map(item=>({name:item.name,hash:nativeHash('sha256').update(item.bytes).digest('hex')})),existing:[...before].map(([file,snapshot])=>({name:path.relative(directory,file),hash:nativeHash('sha256').update(snapshot.bytes).digest('hex')}))})).digest('hex');
      linked.clear();
      const metric={prepareCalls:0,verifyCalls:0,syncStatCalls:0,syncReadCalls:0,syncReadBytes:0,hashUpdates:0,hashInputBytes:0,boundedReadBytes:0,links:0,unlinks:0,successfulWriteCalls:0,successfulPayloadWriteBytes:0,stages:{prepareMs:0,verifyMs:0,hashMs:0,syncReadMs:0,boundedReadMs:0,linkMs:0,cleanupMs:0,stagingWriteMs:0}};
      const memory=process.memoryUsage(),cpu=process.cpuUsage(),start=performance.now();let callbackDelayMs;
      const callback=new Promise(resolve=>setTimeout(()=>{callbackDelayMs=performance.now()-start;resolve();},0));active=instrumentation?metric:null;
      let imported,operationMs,operationCpuMs,afterMemory;
      try{imported=await attachments.import(input);operationMs=performance.now()-start;operationCpuMs=Object.values(process.cpuUsage(cpu)).reduce((sum,value)=>sum+value,0)/1000;afterMemory=process.memoryUsage();}finally{active=null;await callback;}
      assert.equal(imported.length,input.length);
      for(let index=0;index<input.length;index++){
        const item=input[index],record=imported[index],hash=nativeHash('sha256').update(item.bytes).digest('hex'),folder=item.name.endsWith('.png')?imageRoot:fileRoot;
        assert.equal(record.hash,hash);assert.equal(record.name,item.name);assert.equal(record.bytes,item.bytes.length);assert.equal(record.kind,item.name.endsWith('.png')?'image':'file');
        assert.deepEqual(fs.readFileSync(path.join(folder,hash+(record.kind==='image'?'.png':'.txt'))),item.bytes);
        if(record.kind==='image'){assert.equal(record.previewId,hash);assert.equal(record.width,1);assert.equal(record.height,1);}
      }
      for(const [file,snapshot]of before){assert.deepEqual(fs.readFileSync(file),snapshot.bytes);const stat=fs.lstatSync(file);assert.equal(stat.isFile(),true);assert.equal(stat.isSymbolicLink(),false);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(stat[key],snapshot.stat[key]);}
      for(const [folder,names]of expected)assert.deepEqual(fs.readdirSync(folder).sort(),[...names].sort());
      assert.equal(CacheQuotaBatch.activeRoots,0);
      if(instrumentation&&scenario.startsWith('duplicate')){assert.equal(metric.prepareCalls,0);assert.equal(metric.verifyCalls,0);assert.equal(metric.successfulPayloadWriteBytes,0);}
      results.push({existingFilesPerRoot:count,scenario,sample,fixtureHash,inputBytes:input.reduce((sum,item)=>sum+item.bytes.length,0),operationMs,firstCallbackDelayMs:callbackDelayMs,cpuMs:operationCpuMs,rssBeforeBytes:memory.rss,rssAfterBytes:afterMemory.rss,heapDeltaBytes:afterMemory.heapUsed-memory.heapUsed,probe:instrumentation?metric:null,verified:true});
      fs.rmSync(directory,{recursive:true,force:true});
    }
    for(const file of sourceFiles)assert.equal(nativeHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),sourceHashes[file],'Product source changed during the benchmark.');
    assert.equal(nativeHash('sha256').update(fs.readFileSync(toolFile)).digest('hex'),toolHash,'Benchmark tool changed during the run.');
    const result={schemaVersion:1,node:process.version,platform:process.platform,architecture:process.arch,instrumentation,sourceHashes,toolHash,output,temporaryRoot:root,samplesPerCase:samples,counts,cases,payloadBytes,notes:['Synthetic temporary profiles; no Electron, GUI, model or external service calls.','Image validator is a fixture and echoes the source as preview; real decode and distinct preview generation costs are not measured. Duplicate cases are seeded through the same store, so its image validation cache is warm.','Each count is existing files per cache root. Mixed is file/image/file across the distinct normal cache roots, not concurrent/shared-root contention. Fresh profiles are used per sample; setup and verification are outside operationMs. Preflight reads and stats all existing files in both roots, so this is warm filesystem metadata/data, not cold I/O. No warmups or comparison acceptance are implied.','Stage times are inclusive and overlap; cleanup includes linked temporary reads, lstat and unlink. Do not sum stages as total time.','syncStatCalls excludes asynchronous FileHandle.stat calls. syncReadMs measures only readSync calls; boundedReadMs includes its complete safety checks and overlaps syncReadMs. Hash time covers update/digest, not allocation or createHash.','Successful write bytes count resolved fs.promises.writeFile payloads, excluding failed partial writes, metadata and physical disk traffic.','First callback is one timer scheduled immediately before import, not maximum pause, Electron IPC or physical input latency. Callback waiting is excluded from operationMs.','RSS endpoints and heap delta are not peak, retained memory, leak rate or battery evidence. Desktop load and power are not controlled.','Default run is a small smoke only; 1000/10000 file matrices, repeated comparisons, quota boundaries, error races and real image decode require separate work.'],results};
    return result;
  }finally{active=null;for(const undo of restore.reverse())undo();fs.rmSync(root,{recursive:true,force:true});}
}

if(require.main===module)run().then(result=>{
  if(result.output)fs.writeFileSync(result.output,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result.output?{output:result.output,records:result.results.length,verified:result.results.every(item=>item.verified),temporaryRoot:result.temporaryRoot}:result));
}).catch(error=>{console.error(error.message);process.exitCode=1;});
