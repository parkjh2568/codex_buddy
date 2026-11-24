const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../scripts/integration-smoke.cjs'),'utf8');
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-runner-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const directory of ['src','scripts','test/fixtures','characters','skins','assets']){fs.mkdirSync(path.join(root,directory),{recursive:true});fs.writeFileSync(path.join(root,directory,'input.txt'),'unchanged');}
  for(const file of ['package.json','package-lock.json'])fs.writeFileSync(path.join(root,file),'{}');
  let sequence=0;
  return{root,cache:path.join(root,'artifacts/integration-smoke/last-success.json'),run(args=[],options={}){
    const output=path.join(root,'output-'+sequence++),calls=[],runtime={argv:['node','integration-smoke.cjs',...(options.nonInteractive?[]:['--interactive']),...args],env:{ONGGI_SMOKE_ROOT:output,...options.env},version:process.version,platform:process.platform,arch:process.arch,pid:process.pid,kill:process.kill.bind(process)};let context,profile;
    context=vm.createContext({__dirname:path.join(root,'scripts'),process:runtime,console:{log(){},error(){}},require:name=>{
      if(name==='node:fs')return{...fs,rmSync:(file,settings)=>{if(options.cleanupFailed&&file===profile)throw Error('injected profile cleanup failure');return fs.rmSync(file,settings);}};
      if(name==='electron')return'/synthetic/electron';if(name==='electron/package.json')return{version:'44.5.1'};
      if(name==='node:child_process')return{spawnSync:(_executable,argv,settings)=>{
        const cases=vm.runInContext('cases',context),entry=cases.find(([,flag,extra])=>extra&&argv.includes(flag)&&argv.includes(extra))??cases.find(([,flag])=>flag?argv.includes(flag):argv[0].endsWith('asset-validation-smoke.cjs')),name=entry[0],resultFile=vm.runInContext('resultFiles',context)[name];profile=settings.env.ONGGI_SMOKE_ROOT;calls.push({name,env:settings.env});
        if(!options.missingResult)fs.writeFileSync(path.join(settings.env.ONGGI_SMOKE_ROOT,resultFile),JSON.stringify({status:options.badResult||options.conflicting?'failed':'passed',...(options.conflicting?{passed:true}:{}),results:{actualThirtySecondWait:options.falseLifetime?false:settings.env.ONGGI_SMOKE_QUICK!=='1'}}));
        if(options.mutate&&calls.length===1)fs.appendFileSync(path.join(root,'src/input.txt'),' changed');
        return options.timeout?{status:null,signal:'SIGKILL',error:Error('ETIMEDOUT')}:{status:options.fail?1:0};
      }};
      return require(name);
    }});
    vm.runInContext(source,context,{filename:'integration-smoke.cjs'});
    return{calls,code:runtime.exitCode??0,result:JSON.parse(fs.readFileSync(path.join(output,'integration.json')))};
  }};
}

test('full smoke always executes 15 cases, strips inherited quick mode and reuses only explicitly',t=>{
  const h=fixture(t),full=h.run([],{env:{ONGGI_SMOKE_QUICK:'1'}});assert.equal(full.calls.length,15);assert.equal(full.result.passed,true);assert.equal(full.result.executed,15);assert.equal(full.result.reused,0);assert.ok(full.calls.every(c=>c.env.ONGGI_SMOKE_QUICK===undefined));
  const reused=h.run(['--changed'],{env:{ONGGI_SMOKE_QUICK:'1'}});assert.equal(reused.calls.length,0);assert.equal(reused.result.reused,15);assert.ok(reused.result.results.every(r=>r.reused&&!r.executed&&r.evidenceAt));
  assert.equal(h.run().calls.length,15);
});

test('quick profile is five cases and its chat proof cannot replace a full 30-second check',t=>{
  const h=fixture(t),quick=h.run(['--quick']);assert.deepEqual(quick.calls.map(c=>c.name),['expansion','attachments','history','stability','chat-ui']);assert.equal(quick.result.profile,'quick');assert.equal(quick.calls.filter(c=>c.env.ONGGI_SMOKE_QUICK==='1').length,1);assert.equal(quick.calls.at(-1).name,'chat-ui');
  const full=h.run(['--changed','chat-ui']);assert.equal(full.calls.length,1);assert.equal(full.calls[0].env.ONGGI_SMOKE_QUICK,undefined);assert.equal(full.result.results[0].mode,'full');
});

test('docs and unit edits keep receipts; runtime, driver, fixture, assets, lock and environment changes invalidate them',t=>{
  const h=fixture(t);h.run(['history']);fs.writeFileSync(path.join(h.root,'README.md'),'documentation');fs.writeFileSync(path.join(h.root,'test/example.test.cjs'),'test source');assert.equal(h.run(['--changed','history']).calls.length,0);
  for(const file of ['src/input.txt','scripts/input.txt','test/fixtures/input.txt','characters/input.txt','skins/input.txt','assets/input.txt','package-lock.json']){fs.appendFileSync(path.join(h.root,file),' edited');assert.equal(h.run(['--changed','history']).calls.length,1,file);}
  for(const key of ['NODE_OPTIONS','CODEX_HOME','PATH','HOME','TMPDIR','DYLD_LIBRARY_PATH'])assert.equal(h.run(['--changed','history'],{env:{[key]:'new-value'}}).calls.length,1,key);
});

test('failed exit, invalid result and timeout invalidate previous successful receipts',t=>{
  for(const options of [{fail:true},{badResult:true},{missingResult:true},{conflicting:true},{cleanupFailed:true},{timeout:true,missingResult:true}]){
    const h=fixture(t);h.run(['history']);const failed=h.run(['history'],options);assert.equal(failed.code,1);assert.equal(failed.result.passed,false);assert.equal(failed.result.results[0].profileRemoved,false);if(options.fail||options.cleanupFailed)assert.equal(failed.result.results[0].featurePassed,true);assert.ok(fs.existsSync(failed.result.results[0].profileRoot));assert.equal(h.run(['--changed','history']).calls.length,1);
  }
});

test('quick failures also invalidate the stronger cached full case',t=>{
  const h=fixture(t);h.run(['chat-ui']);assert.equal(h.run(['--quick','chat-ui'],{fail:true}).code,1);assert.equal(h.run(['--changed','--quick','chat-ui']).calls.length,1);
});

test('a source change during a run rejects results and prevents receipt reuse',t=>{
  const h=fixture(t);h.run(['history']);const changed=h.run(['history'],{mutate:true});assert.equal(changed.code,1);assert.equal(changed.result.inputsStable,false);assert.equal(changed.result.passed,false);assert.deepEqual(JSON.parse(fs.readFileSync(h.cache)).cases,{});assert.equal(h.run(['--changed','history']).calls.length,1);
});

test('corrupt, expired, future-dated and incomplete receipts fall back to execution',t=>{
  const h=fixture(t);h.run(['history']);fs.writeFileSync(h.cache,'{');assert.equal(h.run(['--changed','history']).calls.length,1);
  for(const offset of [-86400001,60000]){const cache=JSON.parse(fs.readFileSync(h.cache));cache.cases['history:full'].at=Date.now()+offset;fs.writeFileSync(h.cache,JSON.stringify(cache));assert.equal(h.run(['--changed','history']).calls.length,1);}
  const cache=JSON.parse(fs.readFileSync(h.cache));cache.cases['history:full'].record.profileRemoved=false;fs.writeFileSync(h.cache,JSON.stringify(cache));assert.equal(h.run(['--changed','history']).calls.length,1);
});

test('full chat rejects a success JSON that did not verify its real lifetime; unknown options fail before execution',t=>{
  const h=fixture(t);assert.equal(h.run(['chat-ui'],{falseLifetime:true}).result.passed,false);assert.throws(()=>h.run(['--quik']),/Unknown smoke case or option/);
});

test('a live runner lock prevents overlapping GUI runs and a dead owner can be recovered',t=>{
  const h=fixture(t),file=path.join(path.dirname(h.cache),'runner.lock');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({pid:process.pid}));assert.throws(()=>h.run(['history']),/Another smoke runner/);assert.ok(fs.existsSync(file));fs.writeFileSync(file,JSON.stringify({pid:2147483647}));fs.writeFileSync(file+'.recovery',JSON.stringify({pid:process.pid}));assert.throws(()=>h.run(['history']),/lock recovery/);assert.ok(fs.existsSync(file));fs.unlinkSync(file+'.recovery');assert.equal(h.run(['history']).result.passed,true);assert.equal(fs.existsSync(file),false);
});

test('a newer full success supersedes an older quick receipt',t=>{
  const h=fixture(t);h.run(['--quick','chat-ui']);fs.appendFileSync(path.join(h.root,'src/input.txt'),' update');h.run(['chat-ui']);const reused=h.run(['--changed','--quick','chat-ui']);assert.equal(reused.calls.length,0);assert.equal(reused.result.results[0].mode,'full');
});

test('without interactive permission a fresh full or quick run never starts Electron',t=>{
  for(const args of [[],['--quick'],['--changed'],['--changed','--quick']]){
    const h=fixture(t),blocked=h.run(args,{nonInteractive:true});assert.equal(blocked.calls.length,0);assert.equal(blocked.code,2);assert.equal(blocked.result.status,'blocked');assert.equal(blocked.result.passed,false);assert.equal(blocked.result.executed,0);assert.equal(blocked.result.reused,0);assert.equal(blocked.result.blocked,args.includes('--quick')?5:15);assert.equal(fs.existsSync(h.cache),false);assert.equal(fs.existsSync(path.join(path.dirname(h.cache),'runner.lock')),false);
  }
});

test('cache-only mode reuses valid receipts and preserves cache when fresh GUI proof is needed',t=>{
  const h=fixture(t);h.run();const cached=fs.readFileSync(h.cache,'utf8'),reused=h.run(['--changed'],{nonInteractive:true});assert.equal(reused.calls.length,0);assert.equal(reused.result.passed,true);assert.equal(reused.result.reused,15);assert.equal(fs.readFileSync(h.cache,'utf8'),cached);
  fs.appendFileSync(path.join(h.root,'src/input.txt'),' changed');const blocked=h.run(['--changed','--quick'],{nonInteractive:true});assert.equal(blocked.calls.length,0);assert.equal(blocked.code,2);assert.equal(blocked.result.blocked,5);assert.equal(fs.readFileSync(h.cache,'utf8'),cached);
  const resumed=h.run(['--changed','--quick']);assert.equal(resumed.calls.length,5);assert.equal(resumed.result.passed,true);
});
