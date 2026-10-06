#!/usr/bin/env node
const readline=require('node:readline');
let sequence=0,threadSequence=0,modelListCount=0,timer,deltaTimer;
const fs=require('node:fs');const path=require('node:path');
const file=path.join(process.cwd(),'delete-fixture-threads.json');
let saved={};if(fs.existsSync(file))saved=JSON.parse(fs.readFileSync(file,'utf8'));
threadSequence=saved.threadSequence??0;sequence=saved.sequence??0;
const threads=new Map(saved.threads??[]);
let failNextDelete=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line), {method,params={},id}=message;
  if(method==='initialize')send({id,result:{userAgent:'model-test'}});
  if(method==='model/list')send({id,result:{data:[
    {model:'test-main',id:'test-main',displayName:'Test Main',isDefault:true,hidden:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],serviceTiers:[{id:'priority',name:'Fast',description:'Test fast speed; increased usage'}]},
    {model:'test-small',id:'test-small',displayName:'Test Small',isDefault:false,hidden:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}
    ,...(++modelListCount>=3?[{model:'test-new',displayName:'New CLI Model',hidden:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]:[])
  ],nextCursor:null}});
  if(method==='config/read')send({id,result:{config:{model:'test-main',model_reasoning_effort:'high'}}});
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
    const turnId='model-turn-'+(++sequence);
    const thread=threads.get(params.threadId);
    const turn={id:turnId,status:'inProgress',startedAt:Date.now(),items:[{type:'userMessage',id:params.clientUserMessageId,content:params.input}]};thread.turns.push(turn);
    send({id,result:{turn:{id:turnId}}});send({method:'turn/started',params:{threadId:params.threadId,turn:{id:turnId}}});
    deltaTimer=setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId:params.threadId,turnId,itemId:'item-'+turnId,delta:'응답 시작'}}),120);
    timer=setTimeout(()=>{
      const text=`## Model snapshot\n\n${params.model} / ${params.effort}\n\nService tier: ${params.serviceTierForTurn}\n\n${params.input[0].text}`;
      const item={type:'agentMessage',id:'item-'+turnId,text};turn.items.push(item);turn.status='completed';
      send({method:'item/completed',params:{threadId:params.threadId,turnId,item}});
      fs.writeFileSync(file,JSON.stringify({threadSequence,sequence,threads:[...threads]}));
      send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'completed'}}});
    },900);
  }
  if(method==='turn/interrupt'){clearTimeout(timer);clearTimeout(deltaTimer);const turn=threads.get(params.threadId)?.turns.find(t=>t.id===params.turnId);if(turn)turn.status='interrupted';send({id,result:{}});send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});}
});
