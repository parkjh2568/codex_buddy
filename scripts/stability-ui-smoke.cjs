const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
module.exports = async ({app,pet,petNotice,panel,store,showPanel}) => {
  try {
    await panel.webContents.executeJavaScript(`(()=>{const input=document.querySelector('#prompt'),form=document.querySelector('#composer');input.value='화면 복구 검사';form.requestSubmit();input.value='다음 질문 초안';form.requestSubmit();})()`);
    let deadline=Date.now()+10000,coherent=false;
    while(Date.now()<deadline&&!coherent){coherent=await pet.webContents.executeJavaScript(`document.querySelector('#pet-character').dataset.state==='replying'`);if(!coherent)await new Promise(r=>setTimeout(r,30));}
    if(!coherent||!(await petNotice.webContents.executeJavaScript(`document.querySelector('#notice-bubble').textContent.includes('답변이 도착')`)))throw Error('Pet and notice reply states diverged');
    if(store.data.messages.length!==2||store.data.messages[0].text!=='화면 복구 검사'||await panel.webContents.executeJavaScript(`document.querySelector('#prompt').value`)!=='다음 질문 초안')throw Error('Composer reentry duplicated a submission or discarded its next draft');
    const answer=store.data.messages.at(-1),original=answer.text;
    await panel.webContents.executeJavaScript(`window.onggi.action('hide-panel')`);
    deadline=Date.now()+5000;
    while(Date.now()<deadline&&!(await panel.webContents.executeJavaScript(`document.body.classList.contains('page-hidden')`)))await new Promise(r=>setTimeout(r,30));
    answer.text+=' HIDDEN_UPDATE';
    await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);await new Promise(r=>setTimeout(r,150));
    const hidden=await panel.webContents.executeJavaScript(`({pageVisibilityHidden:document.hidden,hidden:document.body.classList.contains('page-hidden'),unchanged:!document.querySelector('.message.assistant .message-body').textContent.includes('HIDDEN_UPDATE')})`);
    if(!hidden.hidden||!hidden.unchanged||panel.isVisible())throw Error('Hidden panel rendered a stream update '+JSON.stringify({...hidden,nativeVisible:panel.isVisible()}));
    showPanel('chat',true);deadline=Date.now()+5000;let restored=false;
    while(Date.now()<deadline&&!restored){restored=await panel.webContents.executeJavaScript(`document.querySelector('.message.assistant .message-body').textContent.includes('HIDDEN_UPDATE')`);if(!restored)await new Promise(r=>setTimeout(r,30));}
    if(!restored)throw Error('Showing the panel lost the cached update');answer.text=original;
    await panel.webContents.executeJavaScript(`window.onggi.action('hide-panel')`);await new Promise(r=>setTimeout(r,100));
    await panel.webContents.executeJavaScript(`document.querySelector('#character-cards').replaceChildren();window.onggi.action('sync')`);await new Promise(r=>setTimeout(r,150));
    if(await panel.webContents.executeJavaScript(`document.querySelectorAll('.character-card').length`))throw Error('Hidden panel rebuilt character DOM');
    showPanel('settings',true);await new Promise(r=>setTimeout(r,150));if((await panel.webContents.executeJavaScript(`document.querySelectorAll('.character-card').length`))!==3)throw Error('Hidden catalog did not render when shown');showPanel('chat',true);
    const focusShadows=[];
    for(const skinId of ['paper','night','mono']) {
      await panel.webContents.executeJavaScript(`window.onggi.action('settings',{skinId:${JSON.stringify(skinId)}})`);
      await new Promise(r=>setTimeout(r,80));
      const focus=await panel.webContents.executeJavaScript(`(()=>{document.querySelector('#prompt').focus();const composer=document.querySelector('.composer');return{focused:composer.matches(':focus-within'),shadow:getComputedStyle(composer).boxShadow};})()`);
      if(!focus.focused||focus.shadow==='none')throw Error('Composer focus shadow is invalid for '+skinId);
      focusShadows.push({skinId,...focus});
    }
    await panel.webContents.executeJavaScript(`window.onggi.action('settings',{skinId:'paper'})`);
    const completed=performance.timeOrigin+performance.now();
    store.data.messages.unshift({id:'long-legacy',role:'assistant',text:'a'.repeat(120000),mode:'demo',status:'completed',timing:{completedAt:completed,submittedAt:completed-100,receivedAt:completed-90,enqueuedAt:completed-80}});
    await store.saveAsync();
    await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('settings',{chatMode:'bubble'});await window.onggi.action('show-panel',{tab:'chat'});})()`);await new Promise(r=>setTimeout(r,200));
    const mini=await panel.webContents.executeJavaScript(`({cards:document.querySelectorAll('.message').length,compact:document.body.classList.contains('compact-mode')})`);
    if(!mini.compact||mini.cards!==2||store.data.messages[0].timing.renderedAt!==undefined)throw Error('Mini rendered or acknowledged hidden history');
    showPanel('chat',true);deadline=Date.now()+5000;let longVisible=false;
    while(Date.now()<deadline&&!longVisible){longVisible=await panel.webContents.executeJavaScript(`Boolean(document.querySelector('.message[data-id="long-legacy"] .message-error')?.textContent.includes('원문'))`);if(!longVisible)await new Promise(r=>setTimeout(r,30));}
    if(!longVisible)throw Error('Long-history display limit was not explained');
    while(Date.now()<deadline&&store.saving)await new Promise(r=>setTimeout(r,30));
    const persisted=new Store(store.directory,{});if(persisted.data.messages[0].text.length!==120000)throw Error('Long source history was truncated on disk');
    const count=store.data.messages.length,thread=store.data.threadId;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Panel recovery timed out')),10000);panel.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve();});panel.webContents.forcefullyCrashRenderer();});
    deadline=Date.now()+5000;let recovered=false;
    while(Date.now()<deadline&&!recovered){recovered=await panel.webContents.executeJavaScript(`Boolean(window.onggi&&document.querySelector('.message'))`);if(!recovered)await new Promise(r=>setTimeout(r,30));}
    if(!recovered||store.data.messages.length!==count||store.data.threadId!==thread)throw Error('Renderer recovery altered or replayed history');
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Pet recovery timed out')),10000);pet.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve();});pet.webContents.forcefullyCrashRenderer();});
    await new Promise(r=>setTimeout(r,200));await pet.webContents.executeJavaScript(`window.onggi.action('pet-layout',{bubbleVisible:true,controlsVisible:false})`);await new Promise(r=>setTimeout(r,200));
    const noticeRect=await petNotice.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#notice-bubble').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`),noticeBounds=petNotice.getBounds();
    const pointer=await pet.webContents.executeJavaScript(`window.onggi.action('pet-pointer-sync',{x:${noticeBounds.x+noticeRect.x},y:${noticeBounds.y+noticeRect.y}})`);if(pointer.noticeIgnore)throw Error('Live notice failed to re-register its hit after pet-only recovery');
    let nativeNotice=null;
    if(process.env.ONGGI_NATIVE_NOTICE_REVIEW==='1'){
      const {BrowserWindow}=require('electron');
      panel.hide();pet.setPosition(500,400);
      await pet.webContents.executeJavaScript(`window.onggi.action('pet-layout',{bubbleVisible:true,controlsVisible:false})`);
      const bounds=petNotice.getBounds(),behind=new BrowserWindow({x:bounds.x-40,y:bounds.y-30,width:300,height:120,title:'옹기봇 안내 클릭 검증',alwaysOnTop:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      await behind.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="margin:0;background:#c3e9dc;font:16px sans-serif"><button style="width:100%;height:100%;border:0;background:transparent" onclick="this.textContent=\'뒤쪽 클릭 수신\';document.body.dataset.clicked=\'true\'">투명 영역 뒤쪽 클릭 검증</button></body>'));
      petNotice.moveTop();pet.moveTop();
      console.log('NATIVE_NOTICE_READY',JSON.stringify({bounds:petNotice.getBounds(),behind:behind.getBounds()}));
      const timer=setInterval(()=>{void pet.webContents.executeJavaScript(`window.onggi.action('pet-layout',{bubbleVisible:true,controlsVisible:false})`).catch(()=>{});},400);
      try{
        const nativeDeadline=Date.now()+180000;let outside=false,inside=false;
        while(Date.now()<nativeDeadline&&!(outside&&inside)){
          outside=await behind.webContents.executeJavaScript(`document.body.dataset.clicked==='true'`);inside=panel.isVisible();
          await new Promise(r=>setTimeout(r,200));
        }
        if(!outside||!inside)throw Error('Native notice click review timed out '+JSON.stringify({outside,inside}));
        nativeNotice={outsideClickReachedBehind:true,insideClickOpenedPanel:true,petOnlyRecovery:true};
      }finally{clearInterval(timer);behind.destroy();}
    }
    fs.writeFileSync(path.join(__dirname,'../artifacts/stability-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',coherentReplyState:true,composerReentryBlocked:true,nextDraftPreserved:true,hiddenPanel: hidden,cacheRestored:restored,focusShadows,mini,longSourcePreserved:true,rendererRecovered:true,noAutomaticReplay:true,nativeNotice,realModel:false},null,2));
    console.log('STABILITY_UI_RECOVERY_CACHE_AND_HISTORY_OK');app.quit();
  } catch(error) {console.error(error.stack);app.exit(1);}
};
