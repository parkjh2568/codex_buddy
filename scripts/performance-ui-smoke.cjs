const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('../src/store.cjs');
module.exports=async({app,panel,store,codex,responseImages,dialog})=>{
  try{
    const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
    await panel.webContents.executeJavaScript(`window.__patches=[];window.onggi.onState(next=>{window.__patches.push({reset:next.messagePatch.reset,upserts:next.messagePatch.upsert.length,ids:next.messagePatch.ids.length,bytes:new TextEncoder().encode(JSON.stringify(next.messagePatch)).length});if(window.__patches.length>30)window.__patches.shift();})`);
    store.data.messages=Array.from({length:1000},(_,i)=>({id:'long-'+i,role:i%2?'assistant':'user',text:`기록 ${i}\n`+'옹기봇의 긴 대화 검증입니다. '.repeat(40),mode:'demo',status:'completed',createdAt:Date.now()-1000+i}));
    const saveStarted=performance.now();store.save();const saveMs=performance.now()-saveStarted;
    const conversationId=store.data.activeConversationId,fullMessageBytes=Buffer.byteLength(JSON.stringify(store.data.messages));
    const initial=await panel.webContents.executeJavaScript(`(async()=>{
      const start=performance.now();await window.onggi.action('sync',{includeCatalog:false});
      const deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelectorAll('.message').length!==100)await new Promise(r=>setTimeout(r,25));
      const messages=document.querySelector('#messages');messages.scrollTop=0;
      return{cards:document.querySelectorAll('.message').length,first:document.querySelector('.message').dataset.id,older:!document.querySelector('#load-older').hidden,uiMs:performance.now()-start,patch:window.__patches.at(-1),height:messages.scrollHeight};
    })()`);
    if(initial.cards!==100||initial.first!=='long-900'||!initial.older||initial.patch.upserts!==100)throw new Error('Initial bounded history failed '+JSON.stringify(initial));
    const older=await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('#load-older').click();const deadline=Date.now()+5000;
      while(Date.now()<deadline&&document.querySelectorAll('.message').length!==200)await new Promise(r=>setTimeout(r,25));
      const ids=[...document.querySelectorAll('.message')].map(m=>m.dataset.id),messages=document.querySelector('#messages');
      return{cards:ids.length,ordered:ids.every((id,i)=>id==='long-'+(800+i)),top:messages.scrollTop,height:messages.scrollHeight,patch:window.__patches.at(-1)};
    })()`);
    if(older.cards!==200||!older.ordered||Math.abs(older.top-(older.height-initial.height))>3)throw new Error('Older page or scroll anchor failed '+JSON.stringify(older));
    store.data.messages.at(-1).text+='\n변경된 답변';
    const delta=await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+5000;
      while(Date.now()<deadline&&!document.querySelector('.message[data-id="long-999"]').textContent.includes('변경된 답변'))await new Promise(r=>setTimeout(r,25));
      return{updated:document.querySelector('.message[data-id="long-999"]').textContent.includes('변경된 답변'),patch:window.__patches.at(-1)};
    })()`);
    if(!delta.updated||delta.patch.upserts!==1||delta.patch.bytes>fullMessageBytes/20)throw new Error('Delta IPC did not reduce payload '+JSON.stringify(delta));
    const unchanged=await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('sync',{includeCatalog:false});await new Promise(r=>setTimeout(r,120));return window.__patches.at(-1);})()`);
    if(unchanged.upserts!==0)throw new Error('Unchanged history was resent');
    const jump=await panel.webContents.executeJavaScript(`(async()=>{
      const messages=document.querySelector('#messages');messages.scrollTop=0;messages.dispatchEvent(new Event('scroll'));
      const shown=!document.querySelector('#jump-latest').hidden;
      document.querySelector('#jump-latest').click();await new Promise(r=>requestAnimationFrame(r));
      return{shown,hidden:document.querySelector('#jump-latest').hidden,bottom:messages.scrollHeight-messages.scrollTop-messages.clientHeight<2};
    })()`);
    if(!jump.shown||!jump.hidden||!jump.bottom)throw new Error('Return to latest response failed '+JSON.stringify(jump));
    store.save();if(new Store(store.directory,{}).data.messages.length!==1000)throw new Error('History was trimmed on disk');
    await panel.webContents.executeJavaScript(`window.onggi.action('new-chat')`);
    await panel.webContents.executeJavaScript(`window.onggi.action('open-conversation',{id:${JSON.stringify(conversationId)}})`);
    const restored=await panel.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelectorAll('.message').length!==100)await new Promise(r=>setTimeout(r,25));return{cards:document.querySelectorAll('.message').length,first:document.querySelector('.message')?.dataset.id};})()`);
    if(restored.cards!==100||restored.first!=='long-900')throw new Error('Reopening history did not reset paging');
    const metrics=app.getAppMetrics().map(p=>({type:p.type,memory:p.memory,cpu:p.cpu}));
    const originalMessages=store.data.messages;
    store.data.messages=Array.from({length:55},(_,i)=>({id:'capacity-'+i,role:'assistant',text:'\u0000'.repeat(100000),mode:'demo',status:'completed'}));
    const largePage=await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+10000;
      while(Date.now()<deadline&&document.querySelectorAll('.message').length!==2)await new Promise(r=>setTimeout(r,30));
      return{cards:document.querySelectorAll('.message').length,first:document.querySelector('.message')?.dataset.id};
    })()`);
    if(largePage.cards!==2||largePage.first!=='capacity-53')throw new Error('Large messages exceeded the initial text budget');
    let capacityRejected=false;
    try {await panel.webContents.executeJavaScript(`window.onggi.action('send',{text:'한도 검증'})`);}catch(error){capacityRejected=error.message.includes('저장 용량');}
    const countAfterRejection=store.data.messages.length;store.data.messages=originalMessages;
    if(!capacityRejected||countAfterRejection!==55)throw new Error('Capacity rejection admitted a ghost question');
    await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);
    await panel.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelectorAll('.message').length!==100)await new Promise(r=>setTimeout(r,25));})()`);
    const rendererCosts=[];
    if(process.env.ONGGI_RENDERER_COST_REVIEW==='1'){
      const original=store.data.messages,originalLimit=panel.messageLimit,originalExpanded=panel.expandedHistory;
      await panel.webContents.executeJavaScript(`(()=>{
        window.__rendererCost={active:false,samples:[],rects:0,metadata:0};
        window.__originalRects=Element.prototype.getClientRects;window.__originalStringify=JSON.stringify;
        Element.prototype.getClientRects=function(...args){if(window.__rendererCost.active)window.__rendererCost.rects++;return window.__originalRects.apply(this,args);};
        JSON.stringify=function(value,...args){if(window.__rendererCost.active&&value&&typeof value==='object'&&value.role&&value.id&&value.text===undefined)window.__rendererCost.metadata++;return window.__originalStringify.call(this,value,...args);};
        window.onggi.onState(next=>{const probe=window.__rendererCost;if(!probe.active||next.messagePatch?.ids.length!==probe.count)return;probe.samples.push({elapsedMs:performance.now()-probe.started,rects:probe.rects,metadata:probe.metadata,upserts:next.messagePatch.upsert.length,cards:document.querySelectorAll('.message').length});probe.active=false;});
      })()`);
      try{for(const count of [100,1000,5000]){
        store.data.messages=Array.from({length:count},(_,i)=>({id:'renderer-cost-'+i,role:i%2?'assistant':'user',text:'고정 기록 '+i,mode:'demo',status:'completed',createdAt:1000+i,...(i%2?{timing:{completedAt:1000+i,renderedAt:1001+i}}:{})}));
        await store.saveAsync();panel.messageView=null;
        await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+10000;while(document.querySelector('.message')?.dataset.id!=='renderer-cost-${Math.max(0,count-100)}'){if(Date.now()>deadline)throw Error('Renderer cost reset did not appear');await new Promise(r=>setTimeout(r,25));}})()`);
        panel.expandedHistory=true;panel.messageLimit=count;
        await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+30000;while(document.querySelectorAll('.message').length!==${count}){if(Date.now()>deadline)throw Error('Renderer cost fixture did not appear');await new Promise(r=>setTimeout(r,25));}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
        const before=process.memoryUsage(),samples=await panel.webContents.executeJavaScript(`(async()=>{const probe=window.__rendererCost;probe.count=${count};probe.samples=[];for(let i=0;i<22;i++){probe.rects=0;probe.metadata=0;probe.started=performance.now();probe.active=true;await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+10000;while(probe.active){if(Date.now()>deadline)throw Error('Renderer cost state timed out');await new Promise(r=>setTimeout(r,1));}await new Promise(r=>setTimeout(r,5));}return probe.samples.slice(2);})()`);
        if(samples.length!==20||samples.some(s=>s.cards!==count||s.upserts!==0))throw Error('Unchanged renderer cost input mismatch');
        rendererCosts.push({count,samples,mainMemoryBefore:before,mainMemoryAfter:process.memoryUsage(),rendererMemory:app.getAppMetrics().find(process=>process.pid===panel.webContents.getOSProcessId())?.memory??null,note:'Warm unchanged sync IPC plus actual renderer state callbacks; first 2 of 22 excluded. Renderer memory uses Electron process metrics in KiB. Not cold startup/model/network latency.'});
      }}finally{
        await panel.webContents.executeJavaScript(`window.__rendererCost.active=false;Element.prototype.getClientRects=window.__originalRects;JSON.stringify=window.__originalStringify;true;`);
        store.data.messages=original;await store.saveAsync();panel.messageView=null;
        await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);
        const deadline=Date.now()+10000;while(panel.messageView===null){if(Date.now()>deadline)throw Error('Renderer cost restore timed out');await new Promise(r=>setTimeout(r,10));}
        panel.expandedHistory=originalExpanded;panel.messageLimit=originalLimit;
        await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('sync',{includeCatalog:false});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})()`);
      }
    }
    const ackCosts=[];
    if(process.env.ONGGI_ACK_COST_REVIEW==='1'){
      const original=store.data.messages,saveAsync=store.saveAsync;
      await panel.webContents.executeJavaScript(`window.__ackCostReset=null;window.onggi.onState(next=>{if(next.messagePatch?.reset)window.__ackCostReset=next.messagePatch.ids[0]??null;});`);
      try{for(const [count,sizeMiB]of [[10,1],[50,8]])for(let sample=0;sample<5;sample++){
        console.log('ACK_COST_SAMPLE_START',JSON.stringify({count,sizeMiB,sample}));
        const text='x'.repeat(Math.floor(sizeMiB*1024*1024/count));
        const prefix='ack-cost-'+count+'-'+sample+'-';
        store.data.messages=Array.from({length:count},(_,i)=>({id:prefix+i,role:'assistant',text:text+i,mode:'demo',status:'completed',createdAt:1000+i,timing:{completedAt:1000+i,renderedAt:1001+i}}));
        await store.saveAsync();await panel.webContents.executeJavaScript(`window.__ackCostReset=null;`);panel.messageView=null;
        await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+10000;while(!window.__ackCostReset?.startsWith(${JSON.stringify(prefix)})){if(Date.now()>deadline)throw Error('ACK cost reset timed out');await new Promise(r=>setTimeout(r,10));}})()`);
        panel.expandedHistory=true;panel.messageLimit=count;
        await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('sync',{includeCatalog:false});const deadline=Date.now()+10000;while(document.querySelectorAll('.message').length!==${count}){if(Date.now()>deadline)throw Error('ACK cost cards timed out');await new Promise(r=>setTimeout(r,10));}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
        let saves=0,ticks=0,lastTick=performance.now(),maxTickMs=0;store.saveAsync=function(...args){saves++;return saveAsync.apply(this,args);};
        const timer=setInterval(()=>{const now=performance.now();maxTickMs=Math.max(maxTickMs,now-lastTick);lastTick=now;ticks++;},10),cpu=process.cpuUsage(),started=performance.now();
        try{
          for(const message of store.data.messages)delete message.timing.renderedAt;
          await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);
          const deadline=Date.now()+15000;while(store.data.messages.some(message=>message.timing.renderedAt===undefined)||store.saving){if(Date.now()>deadline){const renderer=await panel.webContents.executeJavaScript(`({hidden:document.hidden,cards:[...document.querySelectorAll('.message')].map(card=>({id:card.dataset.id,visible:card.getClientRects().length>0})),chatHidden:document.querySelector('#chat-tab').hidden})`);throw Error('ACK cost acknowledgement timed out '+JSON.stringify({count,sizeMiB,sample,saves,visible:panel.isVisible(),tab:panel.activeTab,writeBlocked:store.writeBlocked,saving:Boolean(store.saving),pending:store.data.messages.filter(message=>message.timing.renderedAt===undefined).map(message=>message.id),renderer}));}await new Promise(r=>setTimeout(r,5));}
          const saved=store.readHistory(store.data.activeConversationId);
          if(saved.messages.length!==count||saved.messages.some(message=>message.timing?.renderedAt===undefined||message.text!==text+(message.createdAt-1000)))throw Error('ACK cost persistence mismatch');
          ackCosts.push({count,sizeMiB,sample,saves,elapsedMs:performance.now()-started,mainProcessCpuMicros:process.cpuUsage(cpu),maxTickMs,ticks,historyBytes:fs.statSync(path.join(store.historyDirectory,store.data.activeConversationId+'.json')).size});
          fs.writeFileSync(path.join(artifactRoot,'ack-cost-progress.json'),JSON.stringify(ackCosts,null,2));
        }finally{clearInterval(timer);store.saveAsync=saveAsync;}
      }}finally{
        store.saveAsync=saveAsync;store.data.messages=original;await store.saveAsync();panel.messageView=null;
        await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);
      }
    }
    const costs=[];
    if(process.env.ONGGI_PERFORMANCE_DETAIL==='1'){
      const {monitorEventLoopDelay}=require('node:perf_hooks'),{nativeImage}=require('electron'),histogram=monitorEventLoopDelay({resolution:1}),original=store.data.messages;
      histogram.enable();
      try{
        await panel.webContents.executeJavaScript(`window.__costHeartbeat={last:performance.now(),maxMs:0,ticks:0};window.__costHeartbeatTimer=setInterval(()=>{const now=performance.now();window.__costHeartbeat.maxMs=Math.max(window.__costHeartbeat.maxMs,now-window.__costHeartbeat.last);window.__costHeartbeat.last=now;window.__costHeartbeat.ticks++;},10)`);
        for(const sizeMiB of [1,8,16,24,30]){
          store.data.messages=Array.from({length:Math.floor(sizeMiB*1024*1024/100000)},(_,i)=>({id:'cost-'+i,role:i%2?'assistant':'user',text:'x'.repeat(99990)+String(i),mode:'demo',status:'completed',createdAt:Date.now()}));
          await store.saveAsync();const worker=store.worker,postMessage=worker.postMessage;let postMs=0;
          worker.postMessage=function(message){const start=performance.now();try{return postMessage.call(this,message);}finally{postMs=performance.now()-start;}};
          const samples=[];
          try{for(let i=0;i<20;i++){
            store.data.messages[0].createdAt=Date.now()+i;histogram.reset();await new Promise(resolve=>setTimeout(resolve,5));
            const started=performance.now();await store.saveAsync();const saveAsyncMs=performance.now()-started;
            await new Promise(resolve=>setTimeout(resolve,5));const readStarted=performance.now();store.readHistory(store.data.activeConversationId);const readMs=performance.now()-readStarted;
            await new Promise(resolve=>setTimeout(resolve,5));samples.push({saveAsyncMs,postMessageMs:postMs,readMs,eventLoopMaxMs:histogram.max/1e6,memory:process.memoryUsage()});
          }}finally{worker.postMessage=postMessage;}
          const historyFile=path.join(store.historyDirectory,store.data.activeConversationId+'.json'),historyBytes=fs.statSync(historyFile).size;
          if(historyBytes>32*1024*1024)throw Error('Measurement exceeded the history byte limit');
          const {randomUUID}=require('node:crypto'),inactiveId=randomUUID(),inactiveFile=path.join(store.historyDirectory,inactiveId+'.json');
          const history=JSON.parse(fs.readFileSync(historyFile,'utf8'));history.id=inactiveId;history.messages[0].text+=' COST_SEARCH_NEEDLE';
          fs.writeFileSync(inactiveFile,JSON.stringify(history),{flag:'wx',mode:0o600});
          store.data.conversations.push({...store.data.conversations.find(item=>item.id===store.data.activeConversationId),id:inactiveId,updatedAt:Date.now()+1});
          const searches=[];
          try{for(let sample=0;sample<5;sample++){
            histogram.reset();await new Promise(resolve=>setTimeout(resolve,5));const started=performance.now();
            const result=await panel.webContents.executeJavaScript(`window.onggi.action('search-conversations',{query:'COST_SEARCH_NEEDLE'})`);
            const ipcMs=performance.now()-started;
            if(!result.ok||!result.matches.some(item=>item.id===inactiveId))throw Error('Inactive history body search lost its match');
            await new Promise(resolve=>setTimeout(resolve,5));searches.push({elapsedMs:performance.now()-started,ipcMs,eventLoopMaxMs:histogram.max/1e6,scanned:result.scanned,limited:result.limited,memory:process.memoryUsage()});
          }}finally{store.data.conversations=store.data.conversations.filter(item=>item.id!==inactiveId);fs.unlinkSync(inactiveFile);}
          costs.push({kind:'store',sizeMiB,serializedBytes:Buffer.byteLength(JSON.stringify(store.data.messages)),historyBytes,samples,searches});
        }
        for(const messageCount of [100,1000,10000]){
          store.data.messages=Array.from({length:messageCount},(_,i)=>({id:'small-'+i,role:i%2?'assistant':'user',text:'짧은 기록 '+i,mode:'demo',status:'completed',createdAt:Date.now()}));
          await store.saveAsync();const samples=[];
          for(let sample=0;sample<5;sample++){
            histogram.reset();await new Promise(resolve=>setTimeout(resolve,5));const started=performance.now();await store.saveAsync();const saveAsyncMs=performance.now()-started;
            const readStarted=performance.now(),loaded=store.readHistory(store.data.activeConversationId);const readMs=performance.now()-readStarted;
            if(loaded.messages.length!==messageCount)throw Error('Small-message measurement lost history');
            await new Promise(resolve=>setTimeout(resolve,5));samples.push({saveAsyncMs,readMs,eventLoopMaxMs:histogram.max/1e6,memory:process.memoryUsage()});
          }
          costs.push({kind:'small-messages',messageCount,historyBytes:fs.statSync(path.join(store.historyDirectory,store.data.activeConversationId+'.json')).size,samples});
        }
        costs.push({kind:'renderer-heartbeat',...await panel.webContents.executeJavaScript(`(()=>{clearInterval(window.__costHeartbeatTimer);return window.__costHeartbeat;})()`),note:'10ms timer intervals in the renderer during store/search measurements, not model latency or an OS peak-memory measurement.'});
        store.data.messages=original;await store.saveAsync();
        const warmSamples=[];
        for(let i=0;i<20;i++){const started=performance.now();await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);warmSamples.push(performance.now()-started);}
        costs.push({kind:'warm-sync',samples:warmSamples,note:'Already running UI/IPC sync; not cold startup or model response latency.'});
        const warmOpen=[];
        for(let i=0;i<20;i++){
          panel.hide();const started=performance.now();const ready=await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('show-panel',{tab:'chat',full:true});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return!document.querySelector('#prompt').disabled&&!document.querySelector('#chat-tab').hidden;})()`);
          if(!ready||!panel.isVisible())throw Error('Warm opening did not restore the ready composer');warmOpen.push(performance.now()-started);
        }
        costs.push({kind:'warm-open',samples:warmOpen,note:'Hide/show an already running cached chat until two animation frames and input readiness. No cold startup claim.'});
        const bitmap=Buffer.alloc(1024*1024*4);let seed=0x13579bdf;
        for(let i=0;i<bitmap.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bitmap[i]=seed&255;bitmap[i+1]=(seed>>>8)&255;bitmap[i+2]=(seed>>>16)&255;bitmap[i+3]=255;}
        const png=nativeImage.createFromBitmap(bitmap,{width:1024,height:1024}).toPNG(),[image]=await responseImages.capture({id:'cost-image',type:'imageGeneration',status:'completed',result:png.toString('base64')});
        if(image.status!=='ready')throw Error('Cost image validation failed');
        store.data.messages=Array.from({length:4},(_,i)=>({id:'export-cost-'+i,role:'assistant',text:'Synthetic image export',mode:'demo',status:'completed',createdAt:Date.now(),images:Array.from({length:8},(_,j)=>({...image,itemId:'cost-'+i+'-'+j}))}));await store.saveAsync();
        const read=responseImages.read,write=fs.promises.writeFile,save=dialog.showSaveDialog,folder=path.join(store.directory,'cost-exports');fs.mkdirSync(folder,{recursive:true});
        try{for(let sample=0;sample<3;sample++){
          const file=path.join(folder,'sample-'+sample+'.md'),baseline=process.memoryUsage();let reads=0,readsBeforeFirstWrite=null,peak=baseline;
          dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
          responseImages.read=function(value){const result=read.call(this,value);reads++;const memory=process.memoryUsage();peak={rss:Math.max(peak.rss,memory.rss),external:Math.max(peak.external,memory.external),arrayBuffers:Math.max(peak.arrayBuffers,memory.arrayBuffers)};return result;};
          fs.promises.writeFile=async function(...args){if(String(args[0]).startsWith(file.slice(0,-3)+'.assets'+path.sep)&&readsBeforeFirstWrite===null)readsBeforeFirstWrite=reads;return write.apply(this,args);};
          const started=performance.now(),result=await panel.webContents.executeJavaScript(`window.onggi.action('export-conversation',{id:${JSON.stringify(store.data.activeConversationId)},includeImages:true})`);
          if(result.imageCount!==32||result.unavailable!==0)throw Error('Export cost lost image copies');
          costs.push({kind:'image-export',sample,imageBytes:image.bytes,images:32,totalImageBytes:32*image.bytes,elapsedMs:performance.now()-started,reads,readsBeforeFirstWrite,baseline,peak});
          fs.rmSync(file);fs.rmSync(file.slice(0,-3)+'.assets',{recursive:true});
        }}finally{responseImages.read=read;fs.promises.writeFile=write;dialog.showSaveDialog=save;}
      }finally{histogram.disable();await panel.webContents.executeJavaScript(`clearInterval(window.__costHeartbeatTimer)`);store.data.messages=original;await store.saveAsync();}
    }
    fs.writeFileSync(path.join(artifactRoot,'alpha-long-history.png'),(await panel.webContents.capturePage()).toPNG());
    const result={messageCount:1000,fullMessageBytes,saveMs,initial,older,delta,unchanged,jump,restored,capacityRejected,largePage,metrics,costs,rendererCosts,ackCosts,environment:{platform:process.platform,arch:process.arch,versions:process.versions,projectVersion:require('../package.json').version},realModel:false};
    fs.writeFileSync(path.join(artifactRoot,'performance-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result},null,2));
    console.log('LONG_HISTORY_PAGES_DELTA_AND_CAPACITY_OK',JSON.stringify({fullMessageBytes,initialBytes:initial.patch.bytes,deltaBytes:delta.patch.bytes,cards:restored.cards,saveMs,capacityRejected}));app.quit();
  }catch(error){console.error('PERFORMANCE_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
