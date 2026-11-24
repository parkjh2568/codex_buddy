const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');

test('cache benchmark smoke validates file/image new, duplicate and mixed paths without changing product sources',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-benchmark-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const output=path.join(root,'result.json'),child=spawnSync(process.execPath,[path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--files','0,3','--cases','all','--samples','1','--bytes','128','--output',output,'--temp-parent',root],{encoding:'utf8',timeout:20000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,0,child.stderr);const result=JSON.parse(fs.readFileSync(output)),summary=JSON.parse(child.stdout);assert.deepEqual(summary,{output,records:18,verified:true,temporaryRoot:result.temporaryRoot});assert.equal(result.results.length,18);assert.equal(fs.existsSync(result.temporaryRoot),false);assert.deepEqual(fs.readdirSync(root),['result.json']);assert.equal(Object.keys(result.sourceHashes).length,4);
  for(const item of result.results){assert.equal(item.verified,true);assert.match(item.fixtureHash,/^[a-f0-9]{64}$/);assert.ok(item.operationMs>=0);assert.ok(item.firstCallbackDelayMs>=0);assert.ok(item.cpuMs>=0);assert.ok(item.rssAfterBytes>0);assert.ok(item.probe.stages.cleanupMs>=0);assert.ok(item.probe.syncReadBytes>0);if(item.scenario.startsWith('duplicate')){assert.equal(item.probe.links,0);assert.equal(item.probe.prepareCalls,0);assert.equal(item.probe.successfulPayloadWriteBytes,0);}else{assert.ok(item.probe.links>0);assert.ok(item.probe.verifyCalls>0);assert.ok(item.probe.successfulPayloadWriteBytes>0);}}
  assert.match(result.notes.join('\n'),/real decode/);assert.match(result.notes.join('\n'),/inclusive/);
});

test('cache benchmark uninstrumented run returns no stage or syscall claims',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-benchmark-off-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const child=spawnSync(process.execPath,[path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--instrumentation','off','--temp-parent',root],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.instrumentation,false);assert.equal(result.results.length,3);assert.ok(result.results.every(item=>item.probe===null));assert.deepEqual(fs.readdirSync(root),[]);
});

test('cache benchmark refuses existing output and cleans its profile after a final output failure',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-benchmark-errors-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const output=path.join(root,'preserve.json');fs.writeFileSync(output,'preserve exact bytes');
  for(const target of [output,path.join(root,'missing','result.json')]){const child=spawnSync(process.execPath,[path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--cases','new-file-1','--output',target,'--temp-parent',root],{encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.equal(fs.readFileSync(output,'utf8'),'preserve exact bytes');assert.deepEqual(fs.readdirSync(root),['preserve.json']);}
});

test('cache benchmark emits no success artifact when final temporary-root cleanup fails',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-cleanup-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const output=path.join(root,'result.json'),preload=path.join(root,'fail-cleanup.cjs');
  fs.writeFileSync(preload,"const fs=require('node:fs'),path=require('node:path'),remove=fs.rmSync;fs.rmSync=function(file,...args){if(path.dirname(String(file))===process.env.ONGGI_CACHE_TEST_PARENT&&path.basename(String(file)).startsWith('onggi-cache-benchmark-'))throw Error('injected benchmark root cleanup failure');return remove.call(this,file,...args);};");
  const child=spawnSync(process.execPath,['--require',preload,path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--cases','new-file-1','--output',output,'--temp-parent',root],{encoding:'utf8',timeout:10000,env:{...process.env,ONGGI_CACHE_TEST_PARENT:root}});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,1);assert.match(child.stderr,/injected benchmark root cleanup failure/);assert.equal(child.stdout,'');assert.equal(fs.existsSync(output),false);assert.equal(fs.readdirSync(root).filter(name=>name.startsWith('onggi-cache-benchmark-')).length,1);
});

test('cache benchmark restores probes and releases root ownership after success and staging failure',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-probe-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const preload=path.join(root,'audit-probes.cjs');
  fs.writeFileSync(preload,`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),bounded=require(${JSON.stringify(path.join(__dirname,'../src/bounded-file.cjs'))}),{CacheQuotaBatch}=require(${JSON.stringify(path.join(__dirname,'../src/cache-quota.cjs'))});
    if(process.env.ONGGI_CACHE_FAIL_STAGE==='1')fs.promises.writeFile=async()=>{throw Error('injected staging failure');};
    const entries=[...[ 'lstatSync','statSync','fstatSync','linkSync','unlinkSync','readSync'].map(name=>[fs,name,fs[name]]),[fs.promises,'writeFile',fs.promises.writeFile],[crypto,'createHash',crypto.createHash],[bounded,'readBoundedFile',bounded.readBoundedFile],[CacheQuotaBatch.prototype,'prepare',CacheQuotaBatch.prototype.prepare],[CacheQuotaBatch.prototype,'verify',CacheQuotaBatch.prototype.verify]];
    process.on('exit',()=>{const restored=entries.every(([object,key,value])=>object[key]===value);fs.writeFileSync(process.env.ONGGI_CACHE_AUDIT,JSON.stringify({restored,activeRoots:CacheQuotaBatch.activeRoots}));if(!restored||CacheQuotaBatch.activeRoots!==0)process.exitCode=9;});`);
  for(const failure of [false,true]){
    const directory=path.join(root,failure?'failure':'success');fs.mkdirSync(directory);const audit=path.join(directory,'audit.json'),output=path.join(directory,'result.json');
    const child=spawnSync(process.execPath,['--require',preload,path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--cases','new-file-1','--output',output,'--temp-parent',directory],{encoding:'utf8',timeout:10000,env:{...process.env,ONGGI_CACHE_AUDIT:audit,ONGGI_CACHE_FAIL_STAGE:failure?'1':'0'}});
    assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,failure?1:0,child.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(audit)),{restored:true,activeRoots:0});assert.equal(fs.existsSync(output),!failure);assert.equal(fs.readdirSync(directory).some(name=>name.startsWith('onggi-cache-benchmark-')),false);if(failure)assert.match(child.stderr,/injected staging failure/);
  }
});

test('cache benchmark rejects changed tool bytes before publishing a result',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-toolhash-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const output=path.join(root,'result.json'),preload=path.join(root,'change-tool-read.cjs');
  fs.writeFileSync(preload,"const fs=require('node:fs'),read=fs.readFileSync;let seen=0;fs.readFileSync=function(file,...args){const bytes=read.call(this,file,...args);if(String(file).endsWith('/scripts/cache-cost-benchmark.cjs')&&!args.length&&++seen===2)return Buffer.concat([bytes,Buffer.from('changed tool bytes')]);return bytes;};");
  const child=spawnSync(process.execPath,['--require',preload,path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--cases','new-file-1','--output',output,'--temp-parent',root],{encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,1);assert.match(child.stderr,/Benchmark tool changed/);assert.equal(child.stdout,'');assert.equal(fs.existsSync(output),false);assert.equal(fs.readdirSync(root).some(name=>name.startsWith('onggi-cache-benchmark-')),false);
});

test('cache benchmark rejects invalid options before creating temporary profiles',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-benchmark-args-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const args of [['--files','10001'],['--cases','unknown'],['--samples','0'],['--bytes','4194305'],['--instrumentation','maybe']]){const child=spawnSync(process.execPath,[path.join(__dirname,'../scripts/cache-cost-benchmark.cjs'),'--temp-parent',root,...args],{encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.deepEqual(fs.readdirSync(root),[]);}
});
