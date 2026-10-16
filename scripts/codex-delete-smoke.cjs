const fs=require('node:fs');const path=require('node:path');const {CodexConnection}=require('../src/codex.cjs');
(async()=>{
  const bridge=new CodexConnection();let createdId,artifactRoot,identityVerified=false;
  try{
    artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
    fs.writeFileSync(path.join(artifactRoot,'real-delete-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'running'},null,2));
    const executable='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
    const workspace=path.join(artifactRoot,'delete-real-workspace');fs.mkdirSync(workspace,{recursive:true});
    await bridge.connect(executable,workspace);
    const response=await bridge.request('thread/start',{cwd:workspace,threadSource:'onggi_bot',model:'gpt-5.6-luna',approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'read-only'});
    createdId=response.thread.id;
    if(!createdId||response.thread.threadSource!=='onggi_bot'||response.thread.cwd!==workspace)throw new Error('Disposable thread identity was not verified');
    identityVerified=true;
    let timer,notification;
    const completion=new Promise(resolve=>{
      timer=setTimeout(()=>resolve(new Error('Disposable turn timed out')),60000);
      notification=message=>{if(message.method==='turn/completed'&&message.params.threadId===createdId){clearTimeout(timer);resolve(message.params.turn.status==='completed'?null:new Error('Disposable turn did not complete'));}};
      bridge.on('notification',notification);
    });
    try{
      await bridge.request('turn/start',{threadId:createdId,input:[{type:'text',text:'삭제 기능 검증용입니다. 확인이라는 단어만 답하고 도구는 쓰지 마세요.'}],model:'gpt-5.6-luna',effort:'high',serviceTierForTurn:'default',approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'}});
      const failure=await completion;if(failure)throw failure;
    }finally{clearTimeout(timer);bridge.off('notification',notification);}
    const before=await bridge.request('thread/read',{threadId:createdId,includeTurns:false});
    const rollout=before.thread.path;
    if(!rollout||!fs.existsSync(rollout))throw new Error('Disposable persisted rollout was not verified');
    if(before.thread.id!==createdId)throw new Error('Wrong disposable thread');
    const deleted=[];bridge.on('notification',m=>{if(m.method==='thread/deleted')deleted.push(m.params.threadId);});
    await bridge.request('thread/delete',{threadId:createdId});
    if(fs.existsSync(rollout))throw new Error('CLI rollout still exists after deletion');
    for(let i=0;i<20&&!deleted.includes(createdId);i++)await new Promise(r=>setTimeout(r,50));
    let absent=false;try{await bridge.request('thread/read',{threadId:createdId,includeTurns:false});}catch(e){absent=/not found|not loaded|not exist|missing|No rollout/i.test(e.message);if(!absent)throw e;}
    if(!absent)throw new Error('Deleted thread can still be read');
    let idempotent=true,repeatError=null;try{await bridge.request('thread/delete',{threadId:createdId});}catch(e){idempotent=false;repeatError={message:e.message,code:e.code};}
    const result={verifiedAt:new Date().toISOString(),status:'passed',createdForTest:createdId,notificationObserved:deleted.includes(createdId),readAfterDeleteRejected:absent,idempotent,repeatError,noModelInference:false,persistedRolloutRemoved:true};
    fs.writeFileSync(path.join(artifactRoot,'real-delete-smoke.json'),JSON.stringify(result,null,2));console.log('REAL_DISPOSABLE_CLI_DELETE_OK',JSON.stringify(result));
  }catch(error){
    let cleanup=null;
    if(identityVerified){try{await bridge.request('thread/delete',{threadId:createdId},5000);cleanup='deleted';}catch(failure){cleanup=failure.message;}}
    if(artifactRoot){try{fs.writeFileSync(path.join(artifactRoot,'real-delete-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'failed',error:error.message,createdForTest:createdId??null,cleanup},null,2));}catch{}}
    console.error('REAL_DELETE_SMOKE_FAILED',error.message,createdId?{disposableThread:createdId,cleanup}:{});process.exitCode=1;
  }
  finally{bridge.stop();}
})();
