#!/usr/bin/env node
const readline = require('node:readline');
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({ input:process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') { const text = JSON.stringify({ id:message.id,result:{userAgent:'fake'} })+'\n'; process.stdout.write(text.slice(0,7)); setTimeout(() => process.stdout.write(text.slice(7)),5); }
  if (message.method === 'thread/start') send({ id:message.id,result:{thread:{id:'thread-test'}} });
  if (message.method === 'turn/start') {
    send({ id:message.id,result:{turn:{id:'turn-test'}} });
    send({ method:'turn/started',params:{threadId:'thread-test',turn:{id:'turn-test'}} });
    send({ method:'item/agentMessage/delta',params:{threadId:'thread-test',turnId:'turn-test',itemId:'item-test',delta:message.params.input[0].text} });
    send({ id:90,method:'item/commandExecution/requestApproval',params:{threadId:'thread-test',turnId:'turn-test',command:'example command'} });
  }
  if (message.id === 90 && message.result) send({ method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'completed'}} });
  if (message.method === 'turn/interrupt') { send({ id:message.id,result:{} }); send({ method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'interrupted'}} }); }
  if (message.method === 'crash') process.exit(2);

  if(message.method==='large-response') {
    const text=JSON.stringify({id:message.id,result:{text:'한'.repeat(3*1024*1024)}})+'\n';
    for(let offset=0;offset<text.length;offset+=32768)process.stdout.write(text.slice(offset,offset+32768));
  }
  if(message.method==='batch-response')process.stdout.write(JSON.stringify({id:message.id,result:{text:'x'.repeat(80)}})+'\n'+JSON.stringify({method:'test/notice',params:{text:'x'.repeat(80)}})+'\n');
  if(message.method==='oversized-response')process.stdout.write(JSON.stringify({id:message.id,result:{text:'한'.repeat(100)}})+'\n');
});
