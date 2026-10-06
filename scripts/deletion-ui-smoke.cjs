const fs=require('node:fs');const path=require('node:path');const {Store}=require('../src/store.cjs');
module.exports=async({app,panel,store,codex})=>{
  try{
    await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('refresh-models');await window.onggi.action('send',{text:'삭제 검증 첫 대화'});})()`);
    for(let i=0;i<200&&store.data.messages.at(-1)?.status!=='completed';i++)await new Promise(r=>setTimeout(r,25));
    const first=store.data.activeConversationId,firstThread=store.data.threadId;
    await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('new-chat');await window.onggi.action('send',{text:'삭제 검증 현재 대화'});})()`);
    let busyRejected=false;try{await panel.webContents.executeJavaScript(`window.onggi.action('delete-conversation',{id:${JSON.stringify(first)},confirmed:true})`);}catch(e){busyRejected=e.message.includes('진행 중인');}
    for(let i=0;i<200&&store.data.messages.at(-1)?.status!=='completed';i++)await new Promise(r=>setTimeout(r,25));
    const second=store.data.activeConversationId,secondThread=store.data.threadId;
    const ui=await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('[data-tab="history"]').click();let deadline=Date.now()+5000;while(Date.now()<deadline&&(document.querySelectorAll('.conversation-delete').length!==2||document.querySelector('.conversation-delete').disabled))await new Promise(r=>setTimeout(r,25));
      document.querySelector('[data-delete-conversation="${first}"]').click();
      const opened=document.querySelector('#delete-dialog').open,defaultCancel=document.activeElement.id==='delete-cancel';document.querySelector('#delete-cancel').click();
      const cancelled=!document.querySelector('#delete-dialog').open;
      document.querySelector('[data-delete-conversation="${second}"]').click();document.querySelector('#delete-confirm').click();
      deadline=Date.now()+10000;while(Date.now()<deadline&&document.querySelector('[data-delete-conversation="${second}"]'))await new Promise(r=>setTimeout(r,25));
      return{opened,defaultCancel,cancelled,remaining:document.querySelectorAll('.conversation-card').length};
    })()`);
    if(!busyRejected||!ui.opened||!ui.defaultCancel||!ui.cancelled||ui.remaining!==1||store.data.activeConversationId!==null||store.data.messages.length!==0||fs.existsSync(path.join(store.historyDirectory,second+'.json')))throw new Error('Delete UI or active reset failed '+JSON.stringify(ui));
    await codex.connect(store.data.settings.codexPath,store.data.settings.workspace);
    await codex.request('thread/read',{threadId:firstThread,includeTurns:true});
    let remoteGone=false;try{await codex.request('thread/read',{threadId:secondThread,includeTurns:true});}catch(e){remoteGone=e.message.includes('not loaded');}
    if(!remoteGone)throw new Error('CLI session was retained');
    await panel.webContents.executeJavaScript(`window.onggi.action('send',{text:'삭제하지 않을 세 번째 대화'})`);
    for(let i=0;i<200&&store.data.messages.at(-1)?.status!=='completed';i++)await new Promise(r=>setTimeout(r,25));
    const third=store.data.activeConversationId,thirdThread=store.data.threadId;
    await codex.request('test/fail-next-delete',{});
    const failed=await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('[data-tab="history"]').click();await new Promise(r=>setTimeout(r,120));
      document.querySelector('[data-delete-conversation="${first}"]').click();document.querySelector('#delete-confirm').click();
      let deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelector('#delete-error').hidden)await new Promise(r=>setTimeout(r,25));
      return{open:document.querySelector('#delete-dialog').open,error:document.querySelector('#delete-error').textContent};
    })()`);
    if(!failed.open||!failed.error.includes('로컬 기록은 보존')||!fs.existsSync(path.join(store.historyDirectory,first+'.json'))||store.pendingDeletion?.id!==first||store.data.activeConversationId!==third)throw new Error('CLI failure removed local records');
    const restarted=new Store(store.directory,store.data.settings);if(restarted.pendingDeletion?.id!==first||!restarted.data.conversations.some(c=>c.id===first))throw new Error('Pending deletion was not preserved');
    await codex.request('thread/read',{threadId:firstThread,includeTurns:true});
    await codex.request('thread/delete',{threadId:firstThread});
    const retry=await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('#delete-confirm').click();let deadline=Date.now()+10000;
      while(Date.now()<deadline&&document.querySelector('#delete-dialog').open)await new Promise(r=>setTimeout(r,25));
      let foreignRejected=false,confirmationRequired=false;
      try{await window.onggi.action('delete-conversation',{id:'foreign-thread',confirmed:true});}catch(e){foreignRejected=e.message.includes('옹기봇에서 만든');}
      try{await window.onggi.action('delete-conversation',{id:'${third}'});}catch(e){confirmationRequired=e.message.includes('확인');}
      return{closed:!document.querySelector('#delete-dialog').open,foreignRejected,confirmationRequired};
    })()`);
    if(!retry.closed||!retry.foreignRejected||!retry.confirmationRequired||store.pendingDeletion||store.data.activeConversationId!==third||store.data.threadId!==thirdThread||fs.existsSync(path.join(store.historyDirectory,first+'.json')))throw new Error('Retry or unrelated conversation preservation failed');
    const persisted=new Store(store.directory,{});if(persisted.data.conversations.length!==1||persisted.data.activeConversationId!==third)throw new Error('Deleted conversations returned after restart');
    const result={ui,busyRejected,remoteGone,cliFailurePreserved:true,alreadyMissingHandled:true,retry,unrelatedPreserved:true,restartVerified:true};
    fs.writeFileSync(path.join(__dirname,'..','artifacts','alpha-delete-history.png'),(await panel.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(__dirname,'..','artifacts','deletion-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result},null,2));
    console.log('OWNED_HISTORY_AND_CLI_DELETE_OK',JSON.stringify(result));app.quit();
  }catch(error){console.error('DELETE_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
