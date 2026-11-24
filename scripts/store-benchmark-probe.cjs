const fs=require('node:fs'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');

// This probe is confined to benchmark child processes. Stage durations are inclusive.
function installProbe(){
  const restores=[];let active=false,stages={},writeBytes=0,writes=0;
  for(const [owner,key,label]of [[fs,'readSync','read'],[fs,'readFileSync','readFile'],[fs,'writeFileSync','write'],[JSON,'parse','parse'],[JSON,'stringify','stringify'],[TextDecoder.prototype,'decode','decode'],[crypto.Hash.prototype,'update','shaUpdate'],[crypto.Hash.prototype,'digest','shaDigest']]){
    const original=owner[key];
    owner[key]=function(...args){
      if(!active)return original.apply(this,args);
      const start=performance.now();let success=false;
      try{const value=original.apply(this,args);success=true;return value;}
      finally{const entry=stages[label]??={calls:0,ms:0};entry.calls++;entry.ms+=performance.now()-start;if(label==='write'&&success){writeBytes+=typeof args[1]==='string'?Buffer.byteLength(args[1],typeof args[2]==='string'?args[2]:args[2]?.encoding):args[1].byteLength;writes++;}}
    };
    restores.push(()=>{owner[key]=original;});
  }
  return{start(){stages={};writeBytes=0;writes=0;active=true;},stop(){active=false;return{stages,writeBytes,writes};},restore(){active=false;for(const restore of restores.reverse())restore();}};
}
function queueControlProbe(){
  let timer,resolveDone;const queuedAt=performance.now(),done=new Promise(resolve=>{resolveDone=resolve;});
  timer=setTimeout(()=>{timer=null;resolveDone(performance.now()-queuedAt);},0);
  return{done,cancel(){if(timer!==null){clearTimeout(timer);timer=null;resolveDone(null);}}};
}
module.exports={installProbe,queueControlProbe};
