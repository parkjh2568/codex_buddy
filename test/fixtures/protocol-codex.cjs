const readline = require('node:readline');
let turnNumber=0;
readline.createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') process.stdout.write(JSON.stringify({id:message.id,result:{}}) + '\n');
  if (message.method === 'test/emit') {process.stdout.write(JSON.stringify(message.params.frame) + '\n');process.stdout.write(JSON.stringify({id:message.id,result:{}})+'\n');}
  if(message.method==='turn/start'){
    const turn={id:'own-turn-'+(++turnNumber)},event={method:'turn/started',params:{threadId:message.params.threadId,turn}};
    if(message.params.oldBeforeResponse)process.stdout.write(JSON.stringify({method:'turn/started',params:{threadId:message.params.threadId,turn:{id:'previous-turn'}}})+'\n');
    if(message.params.beforeResponse)process.stdout.write(JSON.stringify(event)+'\n');
    if(message.params.earlyImageBytes)process.stdout.write(JSON.stringify({method:'item/completed',params:{threadId:message.params.threadId,turnId:turn.id,item:{id:'image',type:'imageGeneration',status:'completed',result:'A'.repeat(message.params.earlyImageBytes)}}})+'\n');
    if(message.params.earlyControlBytes)process.stdout.write(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:message.params.threadId,turnId:turn.id,itemId:'reply',delta:'a'.repeat(message.params.earlyControlBytes)}})+'\n');
    if(message.params.earlyCompletion){process.stdout.write(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:message.params.threadId,turnId:turn.id,itemId:'reply',delta:'kept'}})+'\n');process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:message.params.threadId,turn:{id:turn.id,status:'completed'}}})+'\n');}
    process.stdout.write(JSON.stringify({id:message.id,result:{turn}})+'\n');
    if(message.params.oldAfterResponse)process.stdout.write(JSON.stringify({method:'turn/started',params:{threadId:message.params.threadId,turn:{id:'previous-turn'}}})+'\n');
    if(!message.params.beforeResponse)process.stdout.write(JSON.stringify(event)+'\n');
  }
  if(message.method==='turn/interrupt')process.stdout.write(JSON.stringify({id:message.id,result:message.params})+'\n');
});
