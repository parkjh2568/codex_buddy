const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const {readBoundedFile}=require('../src/bounded-file.cjs');
const root=path.join(__dirname,'..'),outputBase=path.resolve(process.env.ONGGI_SMOKE_ROOT||path.join(root,'artifacts/integration-smoke'));
const cases=[['expansion','--buddy-expansion-smoke'],['attachments','--attachments-smoke'],['connection-images','--connection-image-smoke'],['assets',null],['models','--model-smoke'],['history','--history-smoke'],['timing','--timing-smoke'],['delete','--delete-smoke'],['performance','--performance-smoke'],['buddy','--buddy-features-smoke'],['floating','--floating-smoke'],['stability','--stability-smoke'],['lifecycle','--buddy-lifecycle-smoke'],['zero-pack','--buddy-lifecycle-smoke','--no-pack-fixture'],['chat-ui','--chat-ui-smoke']];
const resultFiles={expansion:'buddy-expansion.json',attachments:'ui-verification.json','connection-images':'connection-image-smoke.json',assets:'asset-validation-smoke.json',models:'model-ui-smoke.json',history:'history-ui-smoke.json',timing:'timing-ui-smoke.json',delete:'deletion-ui-smoke.json',performance:'performance-ui-smoke.json',buddy:'buddy-features-smoke.json',floating:'floating-ui-smoke.json',stability:'stability-ui-smoke.json',lifecycle:'buddy-lifecycle-smoke.json','zero-pack':'buddy-zero-pack-smoke.json','chat-ui':'chat-ui-smoke.json'};
const args=process.argv.slice(2),quick=args.includes('--quick'),changed=args.includes('--changed'),interactive=args.includes('--interactive'),requested=args.filter(arg=>!['--quick','--changed','--interactive'].includes(arg));
if(requested.some(name=>!cases.some(c=>c[0]===name)))throw Error('Unknown smoke case or option. Available: --quick, --changed, --interactive, '+cases.map(c=>c[0]).join(', '));
const selected=cases.filter(([name])=>requested.length?requested.includes(name):!quick||['expansion','attachments','history','stability','chat-ui'].includes(name));
const cacheFile=path.join(root,'artifacts/integration-smoke/last-success.json'),lockFile=path.join(root,'artifacts/integration-smoke/runner.lock'),started=Date.now();let cache={version:1,cases:{}},lock;
fs.mkdirSync(path.dirname(lockFile),{recursive:true});
try{lock=fs.openSync(lockFile,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const recoveryFile=lockFile+'.recovery';let recovery;
  try{recovery=fs.openSync(recoveryFile,'wx',0o600);}catch{throw Error('Smoke lock recovery is active or was interrupted; inspect '+recoveryFile);}
  try{
  fs.writeFileSync(recovery,JSON.stringify({pid:process.pid,at:started}));
  const before=fs.lstatSync(lockFile);if(!before.isFile()||before.isSymbolicLink()||before.size>512)throw Error('Smoke runner lock needs manual inspection: '+lockFile);
  let owner;try{owner=JSON.parse(readBoundedFile(lockFile,512).toString('utf8'));}catch{throw Error('Smoke runner is starting or its lock needs inspection: '+lockFile);}
  if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('Smoke runner lock needs manual inspection: '+lockFile);
  try{process.kill(owner.pid,0);throw Error('Another smoke runner is active (PID '+owner.pid+'). Run GUI checks sequentially.');}
  catch(check){if(check.code!=='ESRCH')throw check;}
  const current=fs.lstatSync(lockFile);if(['dev','ino','size','mtimeMs','ctimeMs'].some(key=>current[key]!==before[key]))throw Error('Smoke runner lock changed; retry after the other runner ends.');
  fs.unlinkSync(lockFile);lock=fs.openSync(lockFile,'wx',0o600);
  }finally{try{const owned=fs.fstatSync(recovery),current=fs.lstatSync(recoveryFile);if(current.dev===owned.dev&&current.ino===owned.ino)fs.unlinkSync(recoveryFile);}finally{fs.closeSync(recovery);}}
}
try{
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:started}));
try{const saved=JSON.parse(readBoundedFile(cacheFile,1024*1024).toString('utf8'));if(saved.version===1&&saved.cases&&typeof saved.cases==='object'&&!Array.isArray(saved.cases))cache=saved;}catch{}
fs.mkdirSync(outputBase,{recursive:true});
const output=process.env.ONGGI_SMOKE_ROOT?outputBase:fs.mkdtempSync(path.join(outputBase,'run-'));console.log('RESULT_DIRECTORY',output);
function snapshotInputs(){
  const snapshot={sourceHashes:{},scriptHashes:{},fixtureHashes:{},assetHashes:{},environment:{platform:process.platform,arch:process.arch,node:process.version,os:os.release(),electron:require('electron/package.json').version,variables:{}}};
  for(const [directory,key]of [['src','sourceHashes'],['scripts','scriptHashes'],['test/fixtures','fixtureHashes'],['characters','assetHashes'],['skins','assetHashes'],['assets','assetHashes']]){
    for(const entry of fs.readdirSync(path.join(root,directory),{recursive:true,withFileTypes:true}).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name))))if(entry.isFile()){
      const file=path.join(entry.parentPath,entry.name);snapshot[key][path.relative(root,file)]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  for(const file of ['package.json','package-lock.json'])snapshot.assetHashes[file]=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  for(const key of Object.keys(process.env).sort())if((key.startsWith('ONGGI_')&&!['ONGGI_SMOKE_ROOT','ONGGI_SMOKE_QUICK'].includes(key))||/^(?:NODE_|ELECTRON_|DYLD_|LD_|LC_)/.test(key)||['CODEX_HOME','PATH','HOME','USERPROFILE','TMPDIR','TMP','TEMP','LOCALAPPDATA','APPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR','SystemRoot','WINDIR','PATHEXT','NODE','CI','DISPLAY','WAYLAND_DISPLAY','LANG','TZ'].includes(key))snapshot.environment.variables[key]=createHash('sha256').update(process.env[key]).digest('hex');
  return snapshot;
}
const inputs=snapshotInputs(),fingerprint=createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),results=[],updates={},electron=require('electron');let invalidated=false;
if(!interactive)console.log('화면을 열지 않습니다. --changed의 동일 입력 통과 증거만 재사용하며, 새 GUI 실행에는 명시적인 --interactive가 필요합니다.');
const progress={status:'running',passed:false,profile:quick?'quick':'full',changed,interactive,realModel:false,results,...inputs};fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify(progress,null,2));
for(const [name,flag,extra]of selected){
  const mode=name==='chat-ui'&&quick?'quick':'full',key=name+':'+mode,previous=cache.cases[key]??(mode==='quick'?cache.cases[name+':full']:null);
  if(changed&&previous?.fingerprint===fingerprint&&Number.isFinite(previous.at)&&started>=previous.at&&started-previous.at<=86400000&&previous.record?.name===name&&(previous.record.mode===mode||mode==='quick'&&previous.record.mode==='full')&&previous.record.exitCode===0&&previous.record.featurePassed===true&&previous.record.profileRemoved===true&&!previous.record.error&&!previous.record.signal){
    results.push({...previous.record,reused:true,executed:false,evidenceAt:new Date(previous.at).toISOString()});console.log('REUSE',name,mode);fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify({...progress,at:new Date().toISOString()},null,2));continue;
  }
  if(!interactive){results.push({name,mode,exitCode:null,executed:false,reused:false,blocked:true,featurePassed:false,profileRemoved:false,error:'최근의 동일 입력 통과 증거가 없습니다. GUI 재실행에는 --interactive가 필요합니다.'});process.exitCode=2;console.error('BLOCKED',name,'--interactive 필요');fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify({...progress,at:new Date().toISOString()},null,2));continue;}
  if(!invalidated){try{fs.unlinkSync(cacheFile);}catch(error){if(error.code!=='ENOENT')throw Error('Cannot invalidate prior smoke receipts: '+error.message);}invalidated=true;}
  const profileRoot=fs.mkdtempSync(path.join(output,name+'-')),env={...process.env,ONGGI_SMOKE_ROOT:profileRoot};delete env.ONGGI_NATIVE_NOTICE_REVIEW;delete env.ONGGI_SMOKE_QUICK;
  if(mode==='quick')env.ONGGI_SMOKE_QUICK='1';
  const childArgs=name==='assets'?[path.join(__dirname,'asset-validation-smoke.cjs')]:[root,flag,...(extra?[extra]:[]),'--interactive'],startedAt=new Date().toISOString(),caseStarted=Date.now();
  const log=fs.openSync(path.join(output,name+'.log'),'w');let result;
  console.log('START',name,mode);
  try{result=spawnSync(electron,childArgs,{cwd:root,env,stdio:['ignore',log,log],timeout:150000,killSignal:'SIGKILL',windowsHide:true});}catch(error){result={status:null,error};}finally{fs.closeSync(log);}
  const record={name,args:childArgs,mode,profileRoot,startedAt,elapsedMs:Date.now()-caseStarted,exitCode:result.status,signal:result.signal??null,error:result.error?.message??null,profileRemoved:false,executed:true,reused:false};results.push(record);updates[key]=null;
  try{
    const verification=JSON.parse(fs.readFileSync(path.join(profileRoot,resultFiles[name]),'utf8'));
    record.featurePassed=verification.status==='passed'||verification.passed===true;
    if(!record.featurePassed||verification.status&&verification.status!=='passed'||verification.passed===false)throw Error('Case did not report a completed successful verification');
    if(name==='chat-ui'&&mode==='full'&&verification.results?.actualThirtySecondWait!==true)throw Error('Full chat UI must verify the real 30-second lifetime');
  }catch(error){record.featurePassed=false;record.error=[record.error,'Result verification failed: '+error.message].filter(Boolean).join('; ');}
  const caseResults=path.join(output,name);fs.mkdirSync(caseResults,{recursive:true});
  try{for(const entry of fs.readdirSync(profileRoot,{withFileTypes:true}))if(entry.isFile())fs.copyFileSync(path.join(profileRoot,entry.name),path.join(caseResults,entry.name));}
  catch(error){record.error=[record.error,'Result preservation failed: '+error.message].filter(Boolean).join('; ');}
  if(record.exitCode===0&&!record.signal&&!record.error){
    try{fs.rmSync(profileRoot,{recursive:true,force:true});record.profileRemoved=true;}
    catch(error){record.error='Profile cleanup failed: '+error.message;}
  }
  if(record.exitCode===0&&!record.signal&&!record.error&&record.featurePassed&&record.profileRemoved){updates[key]={fingerprint,at:Date.now(),record};if(mode==='full')updates[name+':quick']=null;}
  console.log('DONE',name,record.exitCode??record.error??record.signal);
  if(record.exitCode!==0||record.signal||record.error){process.exitCode=1;console.error(record.error??record.signal??record.exitCode);console.error(fs.readFileSync(path.join(output,name+'.log'),'utf8').slice(-4000));}
  if(record.error||record.exitCode!==0||record.signal){updates[name+':full']=null;updates[name+':quick']=null;}
  fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify({...progress,at:new Date().toISOString()},null,2));
}
let inputsStable=false;try{inputsStable=JSON.stringify(snapshotInputs())===JSON.stringify(inputs);}catch(error){console.error('Smoke input recheck failed:',error.message);}
if(!inputsStable){process.exitCode=1;console.error('Smoke inputs changed during the run; results will not be reused.');}
if(!inputsStable)cache.cases={};
for(const [key,value]of Object.entries(updates)){delete cache.cases[key];if(inputsStable&&value)cache.cases[key]=value;}
const passed=inputsStable&&results.every(r=>r.exitCode===0&&!r.signal&&!r.error&&r.featurePassed&&r.profileRemoved);
fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify({at:new Date().toISOString(),status:passed?'passed':results.some(r=>r.blocked)?'blocked':'failed',passed,profile:quick?'quick':'full',changed,interactive,inputsStable,elapsedMs:Date.now()-started,executed:results.filter(r=>r.executed).length,reused:results.filter(r=>r.reused).length,blocked:results.filter(r=>r.blocked).length,realModel:false,results,...inputs},null,2));
if(invalidated)try{
  fs.mkdirSync(path.dirname(cacheFile),{recursive:true});const temporary=cacheFile+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(cache),{flag:'wx',mode:0o600});fs.renameSync(temporary,cacheFile);}finally{fs.rmSync(temporary,{force:true});}
}catch(error){console.error('Smoke reuse cache was not saved:',error.message);}
}finally{
  try{const owned=fs.fstatSync(lock),current=fs.lstatSync(lockFile);if(current.dev===owned.dev&&current.ino===owned.ino)fs.unlinkSync(lockFile);}finally{fs.closeSync(lock);}
}
