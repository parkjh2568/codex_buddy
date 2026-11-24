const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),launcher=fs.readFileSync(path.join(root,'scripts/interactive-smoke.cjs'),'utf8');
function run(args,result={status:0}){
  const calls=[],runtime={argv:['node','interactive-smoke.cjs',...args],env:{},platform:process.platform},errors=[];let electronLoads=0;
  vm.runInNewContext(launcher,{__dirname:path.join(root,'scripts'),process:runtime,console:{error:value=>errors.push(value)},require:name=>name==='electron'?(electronLoads++,'/fake/electron'):name==='node:child_process'?{spawnSync:(executable,argv,options)=>{calls.push({executable,argv:[...argv],options});return result;}}:require(name)});
  return{code:runtime.exitCode??0,calls,errors,electronLoads};
}
test('npm GUI launchers refuse to load or spawn Electron without an explicit interactive option',()=>{
  const scripts=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts;assert.equal(scripts.start,'npm run build && electron .');assert.equal(scripts.demo,'npm run build && electron . --demo');
  for(const args of [['app','--smoke'],['app','--real-smoke'],['assets'],['package','--installed'],['packaged-resources','/test/app.asar'],['inputs']]){const result=run(args);assert.equal(result.code,2);assert.equal(result.calls.length,0);assert.equal(result.electronLoads,0);assert.match(result.errors.join(' '),/--interactive/);}
  assert.throws(()=>run(['unknown','--interactive']),/Unknown UI verification target/);
});
test('interactive launchers preserve arguments and errors while keeping script parsers free of the authorization option',()=>{
  const app=run(['app','--history-smoke','--interactive','--verify-floating-restore']);assert.equal(app.code,0);assert.deepEqual(app.calls[0].argv,[root,'--history-smoke','--verify-floating-restore','--interactive']);assert.equal(app.calls[0].options.cwd,root);assert.equal(app.calls[0].options.stdio,'inherit');
  const archive='/test/path with spaces/app.asar';assert.deepEqual(run(['package','--interactive','--archive',archive]).calls[0].argv,[path.join(root,'scripts/verify-package.cjs'),'--archive',archive]);assert.deepEqual(run(['packaged-resources',archive,'--interactive']).calls[0].argv,[path.join(root,'scripts/packaged-resource-smoke.cjs'),archive]);
  assert.equal(run(['assets','--interactive'],{status:7}).code,7);assert.equal(run(['assets','--interactive'],{status:null,signal:'SIGTERM'}).code,1);assert.match(run(['assets','--interactive'],{status:null,error:Error('launch failed')}).errors.join(' '),/launch failed/);
});
test('direct development smoke and notification entry points stop before app startup without opt-in',()=>{
  const mainFile=path.join(root,'src/main.cjs'),source=fs.readFileSync(mainFile,'utf8').split('const nativeNoticeReview=')[0],fromMain=createRequire(mainFile);
  for(const packaged of [false,true])for(const args of [[],['--demo'],['--smoke'],['--attachments-smoke'],['--model-smoke'],['--native-notification-review']])for(const interactive of [false,true]){
    const errors=[],stopped=Error('stopped'),shouldStop=!interactive&&(args.includes('--native-notification-review')||!packaged&&args.some(arg=>arg==='--smoke'||arg.endsWith('-smoke'))),execute=()=>vm.runInNewContext(source,{__dirname:path.dirname(mainFile),process:{argv:['electron',root,...args,...(interactive?['--interactive']:[])]},console:{error:value=>errors.push(value)},require:name=>name==='electron'?{app:{isPackaged:packaged,exit:code=>{assert.equal(code,2);throw stopped;}}}:fromMain(name)});
    if(shouldStop){assert.throws(execute,error=>error===stopped);assert.match(errors.join(' '),/--interactive/);}else assert.doesNotThrow(execute);
  }
});
