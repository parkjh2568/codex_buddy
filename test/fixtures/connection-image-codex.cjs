const readline=require('node:readline'),fs=require('node:fs'),path=require('node:path');
const file=path.join(process.cwd(),'connection-fixture.json');let saved={authenticated:false,threads:[],sequence:0};if(fs.existsSync(file))saved=JSON.parse(fs.readFileSync(file));
const threads=new Map(saved.threads.map(t=>[t.id,t]));let login;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const persist=()=>fs.writeFileSync(file,JSON.stringify({...saved,threads:[...threads.values()]}));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4P8EBiBggFAA1rgc9lj6CJAAAAABJRU5ErkJggg==','base64');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const {id,method,params={}}=JSON.parse(line);
  if(method==='initialize')send({id,result:{}});
  if(method==='account/read')send({id,result:{requiresOpenaiAuth:true,account:saved.authenticated?{type:'chatgpt',email:null,planType:'plus'}:null}});
  if(method==='account/login/start'){login='fixture-login';send({id,result:{type:'chatgpt',loginId:login,authUrl:'https://auth.openai.com/authorize?fixture=true'}});}
  if(method==='account/login/cancel'){login=null;send({id,result:{}});}
  if(method==='test/complete-login'){saved.authenticated=true;persist();send({method:'account/login/completed',params:{loginId:login,success:true}});send({method:'account/updated',params:{authMode:'chatgpt',planType:'plus'}});send({id,result:{}});}
  if(method==='test/drop'){send({id,result:{}});setTimeout(()=>process.exit(7),20);}
  if(method==='test/reset-login'){saved.authenticated=false;persist();send({method:'account/updated',params:{authMode:null,planType:null}});send({id,result:{}});}
  if(method==='model/list')send({id,result:{data:[{model:'gpt-5.6-luna',id:'gpt-5.6-luna',displayName:'Test Luna',isDefault:true,hidden:false,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null}});
  if(method==='config/read')send({id,result:{config:{model:'gpt-5.6-luna',model_reasoning_effort:'high'}}});
  if(method==='thread/start'){const thread={id:'fixture-thread-'+(++saved.sequence),threadSource:params.threadSource,turns:[]};threads.set(thread.id,thread);persist();send({id,result:{thread}});}
  if(method==='thread/read'||method==='thread/resume'){const thread=threads.get(params.threadId);if(thread)send({id,result:{thread}});else send({id,error:{code:-32600,message:'thread not loaded: '+params.threadId}});}
  if(method==='turn/start'){
    if(!saved.authenticated){send({id,error:{code:401,message:'Login required'}});return;}
    const thread=threads.get(params.threadId),turn={id:'fixture-turn-'+(++saved.sequence),status:'inProgress',items:[{type:'userMessage',id:params.clientUserMessageId,content:params.input}],startedAt:Date.now()};thread.turns.push(turn);persist();
    send({id,result:{turn:{id:turn.id}}});send({method:'turn/started',params:{threadId:thread.id,turn:{id:turn.id}}});
    const image={id:'generated-'+turn.id,type:'imageGeneration',status:'inProgress',result:''};send({method:'item/started',params:{threadId:thread.id,turnId:turn.id,item:image}});
    setTimeout(()=>{image.status='completed';image.result=png.toString('base64');image.savedPath=path.join(process.cwd(),'fixture-image.png');fs.writeFileSync(image.savedPath,png);turn.items.push(image);turn.status='completed';persist();send({method:'item/completed',params:{threadId:thread.id,turnId:turn.id,item:image}});send({method:'turn/completed',params:{threadId:thread.id,turn:{id:turn.id,status:'completed'}}});},250);
  }
  if(method==='turn/interrupt'){send({id,result:{}});send({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});}
});
