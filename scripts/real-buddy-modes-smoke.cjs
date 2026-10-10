const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {CodexConnection}=require('../src/codex.cjs'),{ConnectionSetup}=require('../src/connection-setup.cjs');
(async()=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'my-budy-real-modes-')),codex=new CodexConnection({experimentalApi:true}),threads=[],results=[];
  const out=path.join(path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'../artifacts')),'buddy-real-modes.json'),model='gpt-5.6-luna',cleanup=[];let requestsDenied=0,runError=null,workspaceRemoved=false;
  codex.on('request',request=>{requestsDenied++;if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(request.method))codex.respond(request.id,{decision:'decline'});else if(request.method==='item/permissions/requestApproval')codex.respond(request.id,{permissions:{},scope:'turn'});else codex.write({id:request.id,error:{code:-32601,message:'No tool or input requests in this read-only compatibility probe'}});});
  try{
    await codex.connect(ConnectionSetup.findExecutable(),workspace);
    const catalog=await codex.request('model/list',{});assert.ok(catalog.data.some(entry=>entry.model===model),'Requested existing default model was unavailable');
    for(const purpose of ['plan','review']){
      const start=await codex.request('thread/start',{cwd:workspace,model,sandbox:'read-only',approvalPolicy:'on-request',approvalsReviewer:'user',threadSource:'onggi_bot',config:{model_reasoning_effort:'high',review_model:model,service_tier:'default'},developerInstructions:'This is a small compatibility probe. Do not use tools, read files, access the network or modify anything. Answer briefly in Korean.'});
      const threadId=start.thread.id;threads.push(threadId);const items=[];let resolve,reject;
      const completion=new Promise((done,failed)=>{resolve=done;reject=failed;}),timer=setTimeout(()=>reject(Error('Real mode completion timed out')),120000);
      const notification=message=>{if(message.params?.threadId!==threadId)return;if(message.method==='item/completed'&&['agentMessage','plan','enteredReviewMode','exitedReviewMode'].includes(message.params.item.type))items.push({type:message.params.item.type,text:String(message.params.item.text??message.params.item.review??'').slice(0,4000)});if(message.method==='turn/completed')resolve(message.params.turn);};codex.on('notification',notification);
      try{
        const response=purpose==='plan'?await codex.request('turn/start',{threadId,input:[{type:'text',text:'호환성 검사입니다. 도구 없이 요구 확인과 결과 검증이라는 두 단계 계획을 각각 한 문장으로 작성해주세요.'}],model,effort:'high',serviceTierForTurn:'default',collaborationMode:{mode:'plan',settings:{model,reasoning_effort:'high',developer_instructions:'실행할 단계, 의존성, 검증 기준과 예외 처리 계획을 작성한다. 계획만으로 파일 변경 권한을 얻지 않는다. 이 검사는 도구 없이 짧게 답한다.'}},approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'}}):await codex.request('review/start',{threadId,delivery:'inline',target:{type:'custom',instructions:'호환성 검사입니다. 도구와 파일을 사용하지 말고 다음 코드의 null 입력 문제만 한 문장으로 검토해주세요: function size(value) { return value.length; }'}});
        assert.equal(purpose==='review'?response.reviewThreadId:threadId,threadId);const finished=await completion;assert.equal(finished.status,'completed',finished.error?.message);
        assert.ok(items.some(item=>['agentMessage','plan','exitedReviewMode'].includes(item.type)&&item.text.trim()),'No visible mode result');if(purpose==='review')assert.ok(items.some(item=>item.type==='exitedReviewMode'),'No review exit result');
        results.push({purpose,requestedModel:model,conversationModel:start.model,reviewModelOverride:purpose==='review'?model:null,status:finished.status,items});console.log('REAL_BUDDY_MODE_OK',purpose,items.map(item=>item.type).join(','));
      }finally{clearTimeout(timer);codex.off('notification',notification);}
    }
  }catch(error){runError=error;
  }finally{
    for(const threadId of threads){
      try{await codex.request('thread/delete',{threadId},10000);cleanup.push({threadId,deleted:true});}
      catch{cleanup.push({threadId,deleted:false});console.error('Created probe thread cleanup did not complete');}
    }
    codex.stop();try{fs.rmSync(workspace,{recursive:true,force:true});workspaceRemoved=true;}catch{console.error('Temporary probe workspace cleanup did not complete');}
    const responsePassed=!runError&&results.length===2,cleanupPassed=workspaceRemoved&&cleanup.every(item=>item.deleted);
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),passed:responsePassed&&cleanupPassed,responsePassed,cleanupPassed,cleanup,workspaceRemoved,realModel:true,readOnly:true,emptyWorkspace:true,sharedConfigModified:false,requestsDenied,results,...(runError?{error:runError.message.slice(0,300)}:{})},null,2));
    if(runError)throw runError;if(!cleanupPassed)throw Error('Probe response completed but cleanup failed; inspect the result JSON.');
  }
})().catch(error=>{console.error('REAL_BUDDY_MODES_FAILED',error.message);process.exitCode=1;});
