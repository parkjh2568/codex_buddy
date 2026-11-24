const fs = require('node:fs');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const { CodexConnection } = require('../src/codex.cjs');
const bridge = new CodexConnection({experimentalApi:true});
const executable = process.env.ONGGI_CODEX_PATH ?? 'codex',cwd = path.join(__dirname, '..');
const outputDirectory=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(cwd,'artifacts')),runId=randomUUID();fs.mkdirSync(outputDirectory,{recursive:true});
const resultFile=path.join(outputDirectory,'codex-smoke.json');let cliVersion=null,threadId=null,runError=null,archived=false,cleanupError=null;
fs.writeFileSync(resultFile,JSON.stringify({verifiedAt:new Date().toISOString(),runId,status:'running',realModel:true},null,2));
const timer = setTimeout(() => {
  console.error('CODEX_SMOKE_TIMEOUT');bridge.stop();
  try{fs.writeFileSync(resultFile,JSON.stringify({verifiedAt:new Date().toISOString(),runId,status:'failed',realModel:true,threadId,error:'CODEX_SMOKE_TIMEOUT',responsePassed:false,cleanupPassed:archived,cleanupError:threadId&&!archived?'Hard timeout prevented thread archive':null},null,2));}finally{process.exit(1);}
},90000);
(async () => {
  try{
    try{cliVersion=execFileSync(executable,['--version'],{encoding:'utf8',shell:false,windowsHide:true,timeout:5000}).trim().slice(0,200);}catch{}
    await bridge.connect(executable, cwd);
    const params = { cwd, sandbox:'read-only', approvalPolicy:'on-request', approvalsReviewer:'user' };
    const created = await bridge.request('thread/start',params);
    if(typeof created?.thread?.id!=='string'||!created.thread.id)throw Error('Disposable thread identity was not returned');threadId=created.thread.id;
    bridge.on('request', r => {
      if (r.method.endsWith('/requestApproval')) bridge.respond(r.id,r.method === 'item/permissions/requestApproval' ? { permissions:{},scope:'turn' } : { decision:'decline' });
      else bridge.write({ id:r.id,error:{code:-32601,message:'Smoke test does not accept tool requests'} });
    });
    let output='',outputTurnId=null,completed;
    bridge.on('notification',m=>{if(m.params?.threadId!==threadId)return;if(m.method==='item/completed'&&m.params.item.type==='agentMessage'){output=m.params.item.text;outputTurnId=m.params.turnId;}if(m.method==='turn/completed')completed=m.params.turn;});
    for (const prompt of ['한국어로 짧게 답해줘. 이 대화에서 내 캐릭터 이름은 옹기봇이야. 그 이름만 답해줘. 도구는 사용하지 마.', '방금 말한 내 캐릭터 이름을 한 단어로만 다시 답해줘. 도구는 사용하지 마.']) {
      output='';outputTurnId=null;completed=null;
      const {turn}=await bridge.request('turn/start',{threadId,input:[{type:'text',text:prompt}],sandboxPolicy:{type:'readOnly'}});
      const deadline=Date.now()+60000;while(!completed&&bridge.process&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
      if(completed?.id!==turn.id||completed.status!=='completed')throw Error('Owned response did not complete: '+JSON.stringify(completed));
      if(outputTurnId!==turn.id)throw Error('Output belongs to a different probe turn');
      if(!output.includes('옹기봇'))throw new Error(`Unexpected reply: ${output}`);
      console.log('CODEX_TURN_OK', output);
      bridge.stop();
      await bridge.connect(executable,cwd);
      await bridge.request('thread/resume',{...params,threadId});
    }
    completed=null;
    const {turn}=await bridge.request('turn/start',{threadId,input:[{type:'text',text:'도구를 사용하지 말고 1부터 1000까지 숫자를 차례로 모두 출력해줘.'}],sandboxPolicy:{type:'readOnly'}});
    await bridge.interrupt({threadId,turnId:turn.id});
    const deadline=Date.now()+10000;while(!completed&&bridge.process&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
    if(completed?.id!==turn.id||completed.status!=='interrupted')throw Error('Owned turn did not report interrupted');
  }catch(error){runError=error;console.error(error.message);}
  finally{
    if(threadId)try{await bridge.connect(executable,cwd);await bridge.request('thread/archive',{threadId},5000);archived=true;}catch(error){cleanupError=error.message;console.error('Verification thread archive failed',threadId,error.message);}
    clearTimeout(timer);bridge.stop();
    const responsePassed=!runError,cleanupPassed=!threadId||archived,status=responsePassed&&cleanupPassed?'passed':'failed';
    fs.writeFileSync(resultFile,JSON.stringify({verifiedAt:new Date().toISOString(),runId,cliVersion,threadId,status,realModel:true,responsePassed,cleanupPassed,cleanupError,...(runError?{error:runError.message}:{}),checks:status==='passed'?['real response','process reconnect','thread resume','conversation continuity','owned turn interrupt','test thread archived']:[]},null,2));
    if(status==='passed')console.log('CODEX_SMOKE_OK');else process.exitCode=1;
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
