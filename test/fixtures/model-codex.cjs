#!/usr/bin/env node
const readline=require('node:readline');
if(process.argv.includes('--version')){process.stdout.write('codex-cli 0.0.0-fixture\n');process.exit(0);}
let sequence=0,threadSequence=0,modelListCount=0,timer,deltaTimer,hold=false,finishCurrent,skillPath=null;
const threads=new Map();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line), {method,params={},id}=message;
  if(method==='account/read')send({id,result:{account:{type:'chatgpt',email:null,planType:'plus'},requiresOpenaiAuth:true}});
  if(method==='initialize')send({id,result:{userAgent:'model-test'}});
  if(method==='collaborationMode/list')send({id,result:{data:[{name:'Plan',mode:'plan',model:'test-main',reasoningEffort:'high'}]}});
  if(method==='test/set-skill'){skillPath=params.path;send({id,result:{}});}
  if(method==='test/emit'){send(params.frame);send({id,result:{}});}
  if(method==='skills/list')send({id,result:{data:[{cwd:params.cwds[0],errors:[],skills:skillPath?[{name:'fixture-skill',description:'Isolated fixture skill',path:skillPath,enabled:true,scope:'repo'}]:[]}]}});
  if(method==='account/rateLimits/read')send({id,result:{rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:2000000000}},rateLimitsByLimitId:{codex:{limitId:'codex',limitName:'Codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:2000000000},secondary:null}}}});
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
  if(method==='turn/start'||method==='review/start'){
    const review=method==='review/start',input=review?[{type:'text',text:'INTERNAL_REVIEW_WRAPPER: '+params.target.instructions}]:params.input;
    const turnId='model-turn-'+(++sequence);
    const thread=threads.get(params.threadId);
    const turn={id:turnId,status:'inProgress',startedAt:Date.now(),collaborationMode:params.collaborationMode,items:[{type:'userMessage',id:params.clientUserMessageId??'internal-'+turnId,content:input}]};thread.turns.push(turn);
    send({id,result:{turn:{id:turnId},...(review?{reviewThreadId:params.threadId}:{})}});send({method:'turn/started',params:{threadId:params.threadId,turn:{id:turnId}}});
    if(review){const item={type:'enteredReviewMode',id:'review-entry-'+turnId,review:'검토 시작'};turn.items.push(item);send({method:'item/completed',params:{threadId:params.threadId,turnId,item}});}else deltaTimer=setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId:params.threadId,turnId,itemId:'item-'+turnId,delta:'응답 시작'}}),120);
    const finish=()=>{
      finishCurrent=null;clearTimeout(timer);clearTimeout(deltaTimer);
      const text=`## Model snapshot\n\n${params.model} / ${params.effort}\n\nService tier: ${params.serviceTierForTurn}\n\n${input[0].text}`;
      const item=review?{type:'exitedReviewMode',id:'review-exit-'+turnId,review:'FIXTURE_REVIEW_RESULT'}:params.collaborationMode?.mode==='plan'?{type:'plan',id:'item-'+turnId,text:'FIXTURE_PLAN_RESULT'}:{type:'agentMessage',id:'item-'+turnId,text};turn.items.push(item);turn.status='completed';turn.finishedAt=Date.now();
      send({method:'item/completed',params:{threadId:params.threadId,turnId,item}});
      if(review){const echo={type:'agentMessage',id:'review-echo-'+turnId,text:item.review};turn.items.push(echo);send({method:'item/completed',params:{threadId:params.threadId,turnId,item:echo}});}
      send({method:'turn/plan/updated',params:{threadId:params.threadId,turnId,plan:[{step:'fixture complete',status:'completed'}]}});
      send({method:'thread/tokenUsage/updated',params:{threadId:params.threadId,turnId,tokenUsage:{total:{totalTokens:100,inputTokens:60,outputTokens:40},last:{totalTokens:20,inputTokens:12,outputTokens:8},modelContextWindow:200000}}});
      send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'completed'}}});
    };if(hold)finishCurrent=finish;else timer=setTimeout(finish,900);
  }
  if(method==='turn/interrupt'){clearTimeout(timer);clearTimeout(deltaTimer);const turn=threads.get(params.threadId)?.turns.find(t=>t.id===params.turnId);if(turn)turn.status='interrupted';send({id,result:{}});send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});}
  if(id!==undefined&&!['account/read','initialize','collaborationMode/list','test/set-skill','test/emit','skills/list','account/rateLimits/read','model/list','config/read','test/hold','test/complete-current','thread/start','thread/resume','thread/read','turn/start','review/start','turn/interrupt'].includes(method))send({id,error:{code:-32601,message:'Method unavailable'}});
});
