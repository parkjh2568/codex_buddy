const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
module.exports = async ({app,panel,store,codex}) => {
  try {
    const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
    await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('refresh-models');
      await window.onggi.action('send',{text:'첫 번째 옹기 이야기'});
    })()`);
    for (let i=0;i<100 && (store.data.messages.at(-1)?.status!=='completed'||store.saving||await panel.webContents.executeJavaScript(`document.querySelector('#new-chat').disabled`));i++) await new Promise(r=>setTimeout(r,50));
    const first = store.data.activeConversationId, firstThread = store.data.threadId;
    if (store.data.messages.at(-1)?.status!=='completed') throw new Error('First response missing');
    await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('new-chat');
      await window.onggi.action('send',{text:'두 번째 별개의 이야기'});
    })()`);
    let lockedRejected=false;
    try { await panel.webContents.executeJavaScript(`window.onggi.action('open-conversation',{id:${JSON.stringify(first)}})`); }
    catch(error) { lockedRejected=error.message.includes('진행 중인'); }
    for (let i=0;i<100 && (store.data.messages.at(-1)?.status!=='completed'||store.saving||await panel.webContents.executeJavaScript(`document.querySelector('#new-chat').disabled`));i++) await new Promise(r=>setTimeout(r,50));
    const second = store.data.activeConversationId, secondThread = store.data.threadId;
    if (first===second || firstThread===secondThread || !lockedRejected) throw new Error('Conversation isolation or busy lock failed');
    const result = await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('[data-tab="history"]').click();
      let deadline=Date.now()+5000;
      while(Date.now()<deadline&&(document.querySelectorAll('.conversation-card').length!==2||document.querySelector('.conversation-card')?.disabled))await new Promise(r=>setTimeout(r,50));
      const count=document.querySelectorAll('.conversation-card').length;
      const search=document.querySelector('#history-search');search.value='첫 번째';search.dispatchEvent(new Event('input'));
      const filtered=[...document.querySelectorAll('.conversation-card')].map(c=>c.dataset.conversation);
      search.value='';search.dispatchEvent(new Event('input'));
      let foreignRejected=false;
      try{await window.onggi.action('open-conversation',{id:'foreign-codex-thread'});}catch(e){foreignRejected=e.message.includes('옹기봇에서 만든');}
      deadline=Date.now()+5000;
      while(Date.now()<deadline&&!document.querySelector('[data-conversation="${first}"]'))await new Promise(r=>setTimeout(r,25));
      const card=document.querySelector('[data-conversation="${first}"]');
      if(!card)throw Error('Owned history card is missing '+JSON.stringify({first:'${first}',count,filtered,query:search.value,ids:[...document.querySelectorAll('.conversation-card')].map(c=>c.dataset.conversation),hidden:document.hidden}));
      card.click();
      deadline=Date.now()+5000;
      while(Date.now()<deadline&&(document.querySelector('#chat-tab').hidden||!document.querySelector('#messages').textContent.includes('첫 번째 옹기 이야기')))await new Promise(r=>setTimeout(r,50));
      const restored=document.querySelector('#messages').textContent.includes('첫 번째 옹기 이야기')&&!document.querySelector('#messages').textContent.includes('두 번째 별개의 이야기');
      await window.onggi.action('send',{text:'첫 번째 대화를 이어가자'});
      deadline=Date.now()+5000;
      while(Date.now()<deadline&&document.querySelectorAll('.message.user[data-status="completed"]').length!==2)await new Promise(r=>setTimeout(r,50));
      document.querySelector('[data-tab="history"]').click();
      return {count,filtered,foreignRejected,restored};
    })()`);
    if(result.count!==2 || result.filtered.join()!==first || !result.foreignRejected || !result.restored || store.data.threadId!==firstThread || store.data.messages.length!==4 || store.data.messages.at(-1)?.status!=='completed') throw new Error('History UI or thread resume failed: '+JSON.stringify(result));
    const remote = await codex.request('thread/read',{threadId:firstThread,includeTurns:true});
    if(remote.thread.turns.length!==2 || remote.thread.threadSource!=='onggi_bot')throw new Error('Wrong thread resumed');
    for(let i=0;i<100&&(store.saving||await panel.webContents.executeJavaScript(`document.querySelector('#new-chat').disabled`));i++)await new Promise(r=>setTimeout(r,50));
    const reloaded = new Store(store.directory,store.data.settings);
    if(reloaded.data.conversations.length!==2 || reloaded.data.threadId!==firstThread || reloaded.data.messages.length!==4)throw new Error('Restart persistence failed');
    reloaded.openConversation(second);
    if(reloaded.data.messages.length!==2 || reloaded.data.threadId!==secondThread)throw new Error('Other conversation overwritten');
    const synthetic=await codex.request('test/add-history-turns',{threadId:firstThread,count:60}),request=codex.request;let pageRequests=0;
    codex.request=function(method,...args){if(method==='thread/turns/list')pageRequests++;return request.call(this,method,...args);};
    try{await panel.webContents.executeJavaScript(`window.onggi.action('open-conversation',{id:${JSON.stringify(first)}})`);}finally{codex.request=request;}
    if(pageRequests!==1||synthetic.turns!==62||store.data.messages.length!==54||store.data.messages[0].text!=='첫 번째 옹기 이야기'||store.data.messages.at(-1).text!=='synthetic answer 59')throw Error('Initial history page or original metadata failed');
    const initialPage={requests:pageRequests,messages:store.data.messages.length};
    codex.request=function(method,...args){if(method==='thread/turns/list')pageRequests++;return request.call(this,method,...args);};
    try{
      await panel.webContents.executeJavaScript(`window.onggi.action('load-older')`);
      if(pageRequests!==2||store.data.messages.length!==104)throw Error('Second history page did not preserve local records');
      await panel.webContents.executeJavaScript(`window.onggi.action('load-older')`);
    }finally{codex.request=request;}
    if(pageRequests!==3||store.data.messages.length!==124||new Set(store.data.messages.map(message=>message.id)).size!==124)throw Error('Incremental history pages lost or duplicated records');
    const pagedHistory=await panel.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelectorAll('.message').length!==124)await new Promise(r=>setTimeout(r,25));return{cards:document.querySelectorAll('.message').length,first:document.querySelector('.message')?.dataset.id,olderHidden:document.querySelector('#load-older').hidden};})()`);
    if(pagedHistory.cards!==124||pagedHistory.first!==store.data.messages[0].id)throw Error('Paged history UI older records were lost');
    if(!pagedHistory.olderHidden)throw Error('Completed remote pagination still offers older records');
    console.log('HISTORY_INCREMENTAL_PAGES_LOCAL_METADATA_OK',JSON.stringify({initialPage,pageRequests,turns:synthetic.turns,cards:pagedHistory.cards}));store.save();
    await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-tab="history"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    fs.writeFileSync(path.join(artifactRoot,'alpha-history.png'),(await panel.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(artifactRoot,'history-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result,lockedRejected,resumedTurns:remote.thread.turns.length,pagedHistory:{...pagedHistory,initialPage,pageRequests,turns:synthetic.turns},realModel:false},null,2));
    console.log('HISTORY_UI_SEARCH_RESUME_ISOLATION_OK',JSON.stringify({...result,lockedRejected}));app.quit();
  } catch(error) {console.error('HISTORY_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
