const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('../src/store.cjs');
module.exports=async({app,panel,store,codex})=>{
  try{
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
    fs.writeFileSync(path.join(__dirname,'..','artifacts','alpha-long-history.png'),(await panel.webContents.capturePage()).toPNG());
    const result={messageCount:1000,fullMessageBytes,saveMs,initial,older,delta,unchanged,restored,capacityRejected,largePage,metrics};
    fs.writeFileSync(path.join(__dirname,'..','artifacts','performance-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result},null,2));
    console.log('LONG_HISTORY_PAGES_DELTA_AND_CAPACITY_OK',JSON.stringify({fullMessageBytes,initialBytes:initial.patch.bytes,deltaBytes:delta.patch.bytes,cards:restored.cards,saveMs,capacityRejected}));app.quit();
  }catch(error){console.error('PERFORMANCE_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
