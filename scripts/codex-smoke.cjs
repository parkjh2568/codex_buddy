const fs = require('node:fs');
const path = require('node:path');
const { CodexConnection } = require('../src/codex.cjs');
const bridge = new CodexConnection();
const timer = setTimeout(() => { console.error('CODEX_SMOKE_TIMEOUT'); bridge.stop(); process.exit(1); }, 90000);
(async () => {
  const executable = process.env.ONGGI_CODEX_PATH ?? 'codex';
  const cwd = path.join(__dirname, '..');
  await bridge.connect(executable, cwd);
  const params = { cwd, sandbox:'read-only', approvalPolicy:'on-request', approvalsReviewer:'user' };
  const created = await bridge.request('thread/start',params);
  const threadId = created.thread.id;
  bridge.on('request', r => {
    if (r.method.endsWith('/requestApproval')) bridge.respond(r.id,r.method === 'item/permissions/requestApproval' ? { permissions:{} } : { decision:'decline' });
    else bridge.write({ id:r.id,error:{code:-32601,message:'Smoke test does not accept tool requests'} });
  });
  let output='';
  bridge.on('notification', m => { if (m.method === 'item/completed' && m.params.item.type === 'agentMessage') output=m.params.item.text; });
  for (const prompt of ['한국어로 짧게 답해줘. 이 대화에서 내 캐릭터 이름은 옹기봇이야. 그 이름만 답해줘. 도구는 사용하지 마.', '방금 말한 내 캐릭터 이름을 한 단어로만 다시 답해줘. 도구는 사용하지 마.']) {
    output='';
    const done=new Promise((resolve,reject)=>{
      const listener=m=>{if(m.method==='turn/completed'){bridge.off('notification',listener);m.params.turn.status==='completed'?resolve():reject(new Error(JSON.stringify(m.params.turn.error)));}};
      bridge.on('notification',listener);
    });
    await bridge.request('turn/start',{threadId,input:[{type:'text',text:prompt}],sandboxPolicy:{type:'readOnly'}});
    await done;
    if(!output.includes('옹기봇'))throw new Error(`Unexpected reply: ${output}`);
    console.log('CODEX_TURN_OK', output);
    bridge.stop();
    await bridge.connect(executable,cwd);
    await bridge.request('thread/resume',{...params,threadId});
  }
  fs.mkdirSync(path.join(cwd,'artifacts'),{recursive:true});
  fs.writeFileSync(path.join(cwd,'artifacts','codex-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),cliVersion:'0.160.0',threadId,status:'passed',checks:['real response','process reconnect','thread resume','conversation continuity']},null,2));
  console.log('CODEX_SMOKE_OK');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{clearTimeout(timer);bridge.stop();});
