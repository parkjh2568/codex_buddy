const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
module.exports = async ({app,panel,store,codex}) => {
  try {
    await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('refresh-models');
      await window.onggi.action('send',{text:'첫 번째 옹기 이야기'});
    })()`);
    for (let i=0;i<100 && (store.data.messages.at(-1)?.status!=='completed');i++) await new Promise(r=>setTimeout(r,50));
    const first = store.data.activeConversationId, firstThread = store.data.threadId;
    if (store.data.messages.at(-1)?.status!=='completed') throw new Error('First response missing');
    await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('new-chat');
      await window.onggi.action('send',{text:'두 번째 별개의 이야기'});
    })()`);
    let lockedRejected=false;
    try { await panel.webContents.executeJavaScript(`window.onggi.action('open-conversation',{id:${JSON.stringify(first)}})`); }
    catch(error) { lockedRejected=error.message.includes('진행 중인'); }
    for (let i=0;i<100 && store.data.messages.at(-1)?.status!=='completed';i++) await new Promise(r=>setTimeout(r,50));
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
      document.querySelector('[data-conversation="${first}"]').click();
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
    const reloaded = new Store(store.directory,store.data.settings);
    if(reloaded.data.conversations.length!==2 || reloaded.data.threadId!==firstThread || reloaded.data.messages.length!==4)throw new Error('Restart persistence failed');
    reloaded.openConversation(second);
    if(reloaded.data.messages.length!==2 || reloaded.data.threadId!==secondThread)throw new Error('Other conversation overwritten');
    store.save();
    await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-tab="history"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    fs.writeFileSync(path.join(__dirname,'..','artifacts','alpha-history.png'),(await panel.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(__dirname,'..','artifacts','history-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result,lockedRejected,resumedTurns:remote.thread.turns.length},null,2));
    console.log('HISTORY_UI_SEARCH_RESUME_ISOLATION_OK',JSON.stringify({...result,lockedRejected}));app.quit();
  } catch(error) {console.error('HISTORY_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
