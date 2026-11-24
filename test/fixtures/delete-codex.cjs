#!/usr/bin/env node
const readline=require('node:readline');
let sequence=0,threadSequence=0,modelListCount=0,hold=false,activeTurn=null;
const fs=require('node:fs');const path=require('node:path');
const file=path.join(process.cwd(),'delete-fixture-threads.json');
let saved={};if(fs.existsSync(file))saved=JSON.parse(fs.readFileSync(file,'utf8'));
threadSequence=saved.threadSequence??0;sequence=saved.sequence??0;
const threads=new Map(saved.threads??[]);
let failNextDelete=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line), {method,params={},id}=message;
  if(method==='account/read')send({id,result:{account:{type:'chatgpt',email:null,planType:'plus'},requiresOpenaiAuth:true}});
  if(method==='initialize')send({id,result:{userAgent:'model-test'}});
  if(method==='model/list')send({id,result:{data:[
    {model:'test-main',id:'test-main',displayName:'Test Main',isDefault:true,hidden:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],serviceTiers:[{id:'priority',name:'Fast',description:'Test fast speed; increased usage'}]},
    {model:'test-small',id:'test-small',displayName:'Test Small',isDefault:false,hidden:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}
    ,...(++modelListCount>=3?[{model:'test-new',displayName:'New CLI Model',hidden:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]:[])
  ],nextCursor:null}});
  if(method==='config/read')send({id,result:{config:{model:'test-main',model_reasoning_effort:'high'}}});
  if(method==='test/hold'){hold=params.enabled===true;send({id,result:{}});}
  if(method==='test/complete-current'){
    if(activeTurn&&(params.threadId!==undefined&&params.threadId!==activeTurn.threadId||params.turnId!==undefined&&params.turnId!==activeTurn.turnId))send({id,error:{code:-32602,message:'Held fixture turn does not own this completion'}});
    else{activeTurn?.finish();send({id,result:{}});}
  }
  if(method==='thread/start'){
    const thread={id:'model-thread-'+(++threadSequence),threadSource:params.threadSource,turns:[]};threads.set(thread.id,thread);fs.writeFileSync(file,JSON.stringify({threadSequence,sequence,threads:[...threads]}));
    send({id,result:{thread,model:params.model??'test-main'}});
  }
  if(method==='thread/resume'||method==='thread/read'){
    const thread=threads.get(params.threadId);
    if(thread)send({id,result:{thread,model:params.model??'test-main'}});
    else send({id,error:{code:-32600,message:'thread not loaded: '+params.threadId}});
  }
  if(method==='test/fail-next-delete'){failNextDelete=true;send({id,result:{}});}
  if(method==='thread/delete'){
    if(failNextDelete){failNextDelete=false;send({id,error:{code:-32000,message:'Test CLI delete failed'}});}
    else if(!threads.has(params.threadId))send({id,error:{code:-32600,message:'no rollout found for thread id '+params.threadId}});
    else {threads.delete(params.threadId);fs.writeFileSync(file,JSON.stringify({threadSequence,sequence,threads:[...threads]}));send({method:'thread/deleted',params:{threadId:params.threadId}});send({id,result:{}});}
  }
  if(method==='turn/start'){
    if(activeTurn){send({id,error:{code:-32000,message:'A fixture turn is already active'}});return;}
    const turnId='model-turn-'+(++sequence);
    const thread=threads.get(params.threadId);
    const turn={id:turnId,status:'inProgress',startedAt:Date.now(),personaInstructions:params.collaborationMode?.settings.developer_instructions,items:[{type:'userMessage',id:params.clientUserMessageId,content:params.input}]};thread.turns.push(turn);
    send({id,result:{turn:{id:turnId}}});send({method:'turn/started',params:{threadId:params.threadId,turn:{id:turnId}}});
    const operation={threadId:params.threadId,turnId,timer:null,deltaTimer:null,finish:null};activeTurn=operation;
    operation.deltaTimer=setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId:params.threadId,turnId,itemId:'item-'+turnId,delta:'응답 시작'}}),120);
    operation.finish=()=>{
      if(turn.status!=='inProgress'||activeTurn!==operation)return;
      clearTimeout(operation.timer);clearTimeout(operation.deltaTimer);activeTurn=null;
      const text=`## Model snapshot\n\n${params.model} / ${params.effort}\n\nService tier: ${params.serviceTierForTurn}\n\n${params.input[0].text}`;
      const item={type:'agentMessage',id:'item-'+turnId,text};turn.items.push(item);turn.status='completed';
      send({method:'item/completed',params:{threadId:params.threadId,turnId,item}});
      fs.writeFileSync(file,JSON.stringify({threadSequence,sequence,threads:[...threads]}));
      send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'completed'}}});
    };if(!hold)operation.timer=setTimeout(operation.finish,900);
  }
  if(method==='turn/interrupt'){
    const turn=threads.get(params.threadId)?.turns.find(t=>t.id===params.turnId);
    if(turn?.status==='inProgress'&&activeTurn?.threadId===params.threadId&&activeTurn.turnId===params.turnId){clearTimeout(activeTurn.timer);clearTimeout(activeTurn.deltaTimer);activeTurn=null;turn.status='interrupted';fs.writeFileSync(file,JSON.stringify({threadSequence,sequence,threads:[...threads]}));send({id,result:{}});send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});}
    else send({id,result:{}});
  }
});
