const fs=require('node:fs'),path=require('node:path');
const {parentPort,workerData}=require('node:worker_threads');
const {readBoundedFile}=require('./bounded-file.cjs');
const historyDirectory=workerData.historyDirectory;

parentPort.on('message',message=>{
  const reply={id:message?.id,bytes:0,scanned:false};
  try{
    if(typeof historyDirectory!=='string'||!path.isAbsolute(historyDirectory)||path.resolve(historyDirectory)!==historyDirectory||typeof message?.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(message.id)||typeof message.query!=='string'||!message.query.trim()||message.query.length>200||!Number.isSafeInteger(message.remainingBytes)||message.remainingBytes<0||message.remainingBytes>32*1024*1024)throw Error('검색 요청 형식을 확인해주세요.');
    let messages;
    if(Object.prototype.hasOwnProperty.call(message,'activeMessages')){
      if(!Array.isArray(message.activeMessages))throw Error('검색 메시지 형식을 확인해주세요.');
      const size=Buffer.byteLength(JSON.stringify({messages:message.activeMessages}));
      if(size>message.remainingBytes){reply.limited=true;parentPort.postMessage(reply);return;}
      reply.bytes=size;messages=message.activeMessages;
    }else{
      if(fs.realpathSync(historyDirectory)!==historyDirectory)throw Error('대화 폴더 경로가 변경됐어요.');
      const file=path.join(historyDirectory,message.id+'.json'),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||!Number.isSafeInteger(stat.size)||stat.size<0)throw Error('검색 기록 경로를 확인해주세요.');
      if(stat.size>message.remainingBytes){reply.limited=true;parentPort.postMessage(reply);return;}
      reply.bytes=stat.size;
      const bytes=readBoundedFile(file,stat.size);reply.bytes=bytes.length;
      const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!saved||saved.id!==message.id||saved.source!=='onggi_bot'||!Array.isArray(saved.messages))throw Error('검색 기록 형식을 확인해주세요.');
      messages=saved.messages;
    }
    const query=message.query.trim().toLocaleLowerCase(),ids=new Set();
    for(const item of messages){
      if(!item||typeof item.id!=='string'||!item.id||item.id.length>256||ids.has(item.id)||!['user','assistant','system'].includes(item.role)||typeof item.text!=='string')continue;
      ids.add(item.id);const at=item.text.toLocaleLowerCase().indexOf(query);
      if(at!==-1){reply.match=item.text.slice(Math.max(0,at-30),at+120).replace(/\s+/g,' ');break;}
    }
    reply.scanned=true;
  }catch(error){reply.error=error.code==='ENOENT'?'missing':['EACCES','EPERM'].includes(error.code)?'permission':'unreadable';}
  parentPort.postMessage(reply);
});
