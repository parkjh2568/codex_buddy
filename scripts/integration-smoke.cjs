const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),outputBase=path.resolve(process.env.ONGGI_SMOKE_ROOT||path.join(root,'artifacts/integration-smoke'));
const cases=[['expansion','--buddy-expansion-smoke'],['attachments','--attachments-smoke'],['connection-images','--connection-image-smoke'],['assets',null],['models','--model-smoke'],['history','--history-smoke'],['timing','--timing-smoke'],['delete','--delete-smoke'],['performance','--performance-smoke'],['buddy','--buddy-features-smoke'],['floating','--floating-smoke'],['stability','--stability-smoke'],['lifecycle','--buddy-lifecycle-smoke'],['zero-pack','--buddy-lifecycle-smoke','--no-pack-fixture'],['chat-ui','--chat-ui-smoke']];
const resultFiles={expansion:'buddy-expansion.json',attachments:'ui-verification.json','connection-images':'connection-image-smoke.json',assets:'asset-validation-smoke.json',models:'model-ui-smoke.json',history:'history-ui-smoke.json',timing:'timing-ui-smoke.json',delete:'deletion-ui-smoke.json',performance:'performance-ui-smoke.json',buddy:'buddy-features-smoke.json',floating:'floating-ui-smoke.json',stability:'stability-ui-smoke.json',lifecycle:'buddy-lifecycle-smoke.json','zero-pack':'buddy-zero-pack-smoke.json','chat-ui':'chat-ui-smoke.json'};
const requested=process.argv.slice(2);if(requested.some(name=>!cases.some(c=>c[0]===name)))throw Error('Unknown smoke case. Available: '+cases.map(c=>c[0]).join(', '));
fs.mkdirSync(outputBase,{recursive:true});
const output=process.env.ONGGI_SMOKE_ROOT?outputBase:fs.mkdtempSync(path.join(outputBase,'run-'));console.log('RESULT_DIRECTORY',output);
const sourceHashes={},scriptHashes={},fixtureHashes={};
for(const [directory,hashes]of [['src',sourceHashes],['scripts',scriptHashes],['test/fixtures',fixtureHashes]])for(const entry of fs.readdirSync(path.join(root,directory),{recursive:true,withFileTypes:true}))if(entry.isFile()){const file=path.join(entry.parentPath,entry.name);hashes[path.relative(root,file)]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
const results=[],electron=require('electron');
for(const [name,flag,extra]of cases){
  if(requested.length&&!requested.includes(name))continue;
  const profileRoot=fs.mkdtempSync(path.join(output,name+'-'));
  const env={...process.env,ONGGI_SMOKE_ROOT:profileRoot};delete env.ONGGI_NATIVE_NOTICE_REVIEW;
  const args=name==='assets'?[path.join(__dirname,'asset-validation-smoke.cjs')]:[root,flag,...(extra?[extra]:[])],startedAt=new Date().toISOString(),started=Date.now();
  const log=fs.openSync(path.join(output,name+'.log'),'w');let result;
  console.log('START',name);
  try{result=spawnSync(electron,args,{cwd:root,env,stdio:['ignore',log,log],timeout:150000,killSignal:'SIGKILL',windowsHide:true});}finally{fs.closeSync(log);}
  const record={name,args,profileRoot,startedAt,elapsedMs:Date.now()-started,exitCode:result.status,signal:result.signal,error:result.error?.message??null,profileRemoved:false};results.push(record);
  try{
    const verification=JSON.parse(fs.readFileSync(path.join(profileRoot,resultFiles[name]),'utf8'));
    record.featurePassed=verification.status==='passed'||verification.passed===true;
    if(!record.featurePassed||verification.status&&verification.status!=='passed'||verification.passed===false)throw Error('Case did not report a completed successful verification');
  }catch(error){record.featurePassed=false;record.error=[record.error,'Result verification failed: '+error.message].filter(Boolean).join('; ');}
  const caseResults=path.join(output,name);fs.mkdirSync(caseResults,{recursive:true});
  for(const entry of fs.readdirSync(profileRoot,{withFileTypes:true}))if(entry.isFile())fs.copyFileSync(path.join(profileRoot,entry.name),path.join(caseResults,entry.name));
  if(record.exitCode===0&&!record.signal&&!record.error){
    try{fs.rmSync(profileRoot,{recursive:true,force:true});record.profileRemoved=true;}
    catch(error){record.error='Profile cleanup failed: '+error.message;}
  }
  fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify({at:new Date().toISOString(),passed:results.every(r=>r.exitCode===0&&!r.signal&&!r.error&&r.featurePassed&&r.profileRemoved),realModel:false,results,sourceHashes,scriptHashes,fixtureHashes},null,2));
  console.log('DONE',name,record.exitCode??record.error??record.signal);
  if(record.exitCode!==0||record.signal||record.error){process.exitCode=1;console.error(record.error??record.signal??record.exitCode);console.error(fs.readFileSync(path.join(output,name+'.log'),'utf8').slice(-4000));}
}
