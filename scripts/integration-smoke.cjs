const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(root,'artifacts/integration-smoke'));
const cases=[['expansion','--buddy-expansion-smoke'],['attachments','--attachments-smoke'],['connection-images','--connection-image-smoke'],['assets',null],['models','--model-smoke'],['history','--history-smoke'],['timing','--timing-smoke'],['delete','--delete-smoke'],['performance','--performance-smoke'],['buddy','--buddy-features-smoke'],['floating','--floating-smoke'],['stability','--stability-smoke'],['lifecycle','--buddy-lifecycle-smoke'],['zero-pack','--buddy-lifecycle-smoke','--no-pack-fixture']];
const requested=process.argv.slice(2);if(requested.some(name=>!cases.some(c=>c[0]===name)))throw Error('Unknown smoke case. Available: '+cases.map(c=>c[0]).join(', '));
fs.mkdirSync(output,{recursive:true});
const sourceHashes={};for(const entry of fs.readdirSync(path.join(root,'src'),{recursive:true,withFileTypes:true}))if(entry.isFile()){const file=path.join(entry.parentPath,entry.name);sourceHashes[path.relative(root,file)]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
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
  for(const entry of fs.readdirSync(path.join(root,'artifacts'),{withFileTypes:true}))if(entry.isFile()&&/smoke.*\.json$/.test(entry.name)&&fs.statSync(path.join(root,'artifacts',entry.name)).mtimeMs>=started-1000)fs.copyFileSync(path.join(root,'artifacts',entry.name),path.join(output,entry.name));
  const caseResults=path.join(output,name);fs.mkdirSync(caseResults,{recursive:true});
  for(const entry of fs.readdirSync(profileRoot,{withFileTypes:true}))if(entry.isFile())fs.copyFileSync(path.join(profileRoot,entry.name),path.join(caseResults,entry.name));
  if(record.exitCode===0&&!record.error){fs.rmSync(profileRoot,{recursive:true,force:true});record.profileRemoved=true;}
  fs.writeFileSync(path.join(output,'integration.json'),JSON.stringify({at:new Date().toISOString(),passed:results.every(r=>r.exitCode===0&&!r.error),realModel:false,results,sourceHashes},null,2));
  console.log('DONE',name,record.exitCode??record.error??record.signal);
  if(record.exitCode!==0||record.error){process.exitCode=1;console.error(fs.readFileSync(path.join(output,name+'.log'),'utf8').slice(-4000));}
}
