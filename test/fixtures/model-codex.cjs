#!/usr/bin/env node
const readline=require('node:readline');
let sequence=0,threadSequence=0,modelListCount=0,timer,deltaTimer,hold=false,finishCurrent;
const threads=new Map();
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
  if(method==='test/complete-current'){finishCurrent?.();send({id,result:{}});}
  if(method==='thread/start'){
    const thread={id:'model-thread-'+(++threadSequence),threadSource:params.threadSource,turns:[]};threads.set(thread.id,thread);
    send({id,result:{thread,model:params.model??'test-main'}});
  }
  if(method==='thread/resume'||method==='thread/read'){
    const thread=threads.get(params.threadId);
    if(thread)send({id,result:{thread,model:params.model??'test-main'}});
    else send({id,error:{code:-32000,message:'Thread missing'}});
  }
  if(method==='turn/start'){
    const turnId='model-turn-'+(++sequence);
    const thread=threads.get(params.threadId);
    const turn={id:turnId,status:'inProgress',startedAt:Date.now(),items:[{type:'userMessage',id:params.clientUserMessageId,content:params.input}]};thread.turns.push(turn);
    send({id,result:{turn:{id:turnId}}});send({method:'turn/started',params:{threadId:params.threadId,turn:{id:turnId}}});
    deltaTimer=setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId:params.threadId,turnId,itemId:'item-'+turnId,delta:'응답 시작'}}),120);
    const finish=()=>{
      finishCurrent=null;clearTimeout(timer);clearTimeout(deltaTimer);
      const text=`## Model snapshot\n\n${params.model} / ${params.effort}\n\nService tier: ${params.serviceTierForTurn}\n\n${params.input[0].text}`;
      const item={type:'agentMessage',id:'item-'+turnId,text};turn.items.push(item);turn.status='completed';turn.finishedAt=Date.now();
      send({method:'item/completed',params:{threadId:params.threadId,turnId,item}});
      send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'completed'}}});
    };if(hold)finishCurrent=finish;else timer=setTimeout(finish,900);
  }
  if(method==='turn/interrupt'){clearTimeout(timer);clearTimeout(deltaTimer);const turn=threads.get(params.threadId)?.turns.find(t=>t.id===params.turnId);if(turn)turn.status='interrupted';send({id,result:{}});send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});}
});
