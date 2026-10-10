const fs=require('node:fs'),path=require('node:path');
const {CodexConnection}=require('../src/codex.cjs'),{loadPack}=require('../src/packs.cjs'),{PersonaLibrary}=require('../src/personas.cjs');
const root=path.join(__dirname,'..'),cwd=path.join(root,'artifacts','persona-real-workspace');fs.mkdirSync(cwd,{recursive:true});
const library=new PersonaLibrary(path.join(root,'artifacts','persona-real-files',String(Date.now())),['onggi-clip','onggi-sprout'].map(id=>loadPack(path.join(root,'characters',id))));
const bridge=new CodexConnection({experimentalApi:true}),results=[],owned=[];
const executable=process.env.ONGGI_CODEX_PATH??'codex',model='gpt-5.6-luna';
bridge.on('request',request=>{bridge.write({id:request.id,error:{code:-32601,message:'Persona verification does not allow tools or approvals'}});});
(async()=>{
  let threadId=null,response=null;
  await bridge.connect(executable,cwd);
  for(const character of ['onggi-clip','onggi-sprout']){
    for(const mode of ['friendly','warm-long','concise','blunt']){
      const persona=library.resolve(character,mode,'옹기봇'),params={cwd,model,sandbox:'read-only',approvalPolicy:'on-request',approvalsReviewer:'user',};
      if(!threadId)response=await bridge.request('thread/start',{...params,threadSource:'onggi_bot'});
      threadId=response.thread.id;if(!owned.includes(threadId))owned.push(threadId);
      if(typeof response.model==='string'&&response.model!==model)throw Error('CLI selected a different model '+response.model);
      let output='',dispose;const started=Date.now();
      const done=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{bridge.off('notification',listener);reject(Error('Persona model response timeout'));},120000);
        const listener=message=>{
          if(message.params?.threadId!==threadId)return;
          if(message.method==='item/completed'&&message.params.item.type==='agentMessage')output=message.params.item.text;
          if(message.method==='turn/completed'){clearTimeout(timer);bridge.off('notification',listener);message.params.turn.status==='completed'?resolve():reject(Error(JSON.stringify(message.params.turn.error)));}
        };bridge.on('notification',listener);dispose=()=>{clearTimeout(timer);bridge.off('notification',listener);};
      });
      try{await bridge.request('turn/start',{threadId,input:[{type:'text',text:'내 책상에 종이와 컵이 섞여 있어. 오늘 5분 안에 정리하는 방법을 네 말투로 알려줘. 도구를 사용하지 마.'}],model,effort:'high',serviceTierForTurn:'default',collaborationMode:{mode:'default',settings:{model,reasoning_effort:'high',developer_instructions:persona.instructions}},sandboxPolicy:{type:'readOnly'},approvalPolicy:'on-request',approvalsReviewer:'user'});}catch(error){dispose();throw error;}
      await done;if(!output.trim())throw Error('Empty model response');
      const row={character,mode,threadId,model:response.model??model,processId:bridge.process.pid,effort:'high',hash:persona.hash,output,elapsedMs:Date.now()-started};results.push(row);
      fs.writeFileSync(path.join(root,'artifacts','persona-real-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'running',results},null,2));
      console.log('REAL_PERSONA_RESPONSE',JSON.stringify(row));
    }
  }
  const checks=[];
  for(const character of ['onggi-clip','onggi-sprout']){
    const rows=results.filter(r=>r.character===character),concise=rows.find(r=>r.mode==='concise').output,warm=rows.find(r=>r.mode==='warm-long').output,blunt=rows.find(r=>r.mode==='blunt').output;
    const check={character,sameThread:new Set(rows.map(r=>r.threadId)).size===1,conciseLength:Array.from(concise).length,conciseNoEmoji:!/[\p{Extended_Pictographic}]/u.test(concise),warmLength:Array.from(warm).length,bluntNoHonorific:!/(입니다|합니다|해요|하세요|드려요|드릴게요)/.test(blunt)};
    if(!check.sameThread||check.conciseLength>180||!check.conciseNoEmoji||check.warmLength<350||!check.bluntNoHonorific)throw Error('Persona output fidelity check failed '+JSON.stringify(check));checks.push(check);
  }
  fs.writeFileSync(path.join(root,'artifacts','persona-real-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',sameProcess:new Set(results.map(r=>r.processId)).size===1,sameThreadAcrossCharacters:new Set(results.map(r=>r.threadId)).size===1,transport:'turn/start.collaborationMode.settings.developer_instructions',results,checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;fs.writeFileSync(path.join(root,'artifacts','persona-real-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'failed',error:error.message,results},null,2));}).finally(async()=>{
  for(const threadId of owned)try{await bridge.connect(executable,cwd);await bridge.request('thread/archive',{threadId});}catch(error){console.error('Verification thread archive failed',threadId,error.message);}
  bridge.stop();
});
