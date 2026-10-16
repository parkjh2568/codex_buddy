const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('../src/store.cjs');
module.exports=async({app,panel,store,codex})=>{
  try{
    const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
    const result=await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('refresh-models');
      const nav=[...document.querySelectorAll('.tabs [data-tab]')].map(b=>b.dataset.tab);
      const gear=document.querySelector('#open-settings');gear.click();
      const settingsOpened=!document.querySelector('#settings-tab').hidden&&gear.getAttribute('aria-pressed')==='true';
      const toggle=document.querySelector('#measure-response-time');toggle.checked=true;toggle.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,120));document.querySelector('[data-tab="chat"]').click();
      const input=document.querySelector('#prompt');input.value='첫 시간 측정';document.querySelector('#composer').requestSubmit();
      const firstDeadline=Date.now()+5000;while(Date.now()<firstDeadline&&document.querySelectorAll('.message.user').length<1)await new Promise(r=>setTimeout(r,30));
      const second=await window.onggi.action('send',{text:'대기 시간 측정',submittedAt:performance.timeOrigin+performance.now()});
      const deadline=Date.now()+10000;while(Date.now()<deadline&&[...document.querySelectorAll('.response-timing')].filter(e=>/전체: \\d{2,}:\\d{2}\\.\\d{4}/.test(e.textContent)).length<2)await new Promise(r=>setTimeout(r,40));
      const blocks=[...document.querySelectorAll('.response-timing')].map(e=>e.textContent);
      gear.click();toggle.checked=false;toggle.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,100));document.querySelector('[data-tab="chat"]').click();
      const hiddenWhenOff=document.querySelectorAll('.response-timing').length===0;
      const third=await window.onggi.action('send',{text:'측정 꺼짐',submittedAt:performance.timeOrigin+performance.now()});
      const thirdDeadline=Date.now()+5000;while(Date.now()<thirdDeadline&&!document.querySelector('.message.user[data-id="'+third.id+'"][data-status="completed"]'))await new Promise(r=>setTimeout(r,40));
      gear.click();toggle.checked=true;toggle.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,100));document.querySelector('[data-tab="chat"]').click();
      input.value='설정 화면에서 최종 반영 대기';document.querySelector('#composer').requestSubmit();gear.click();
      await new Promise(r=>setTimeout(r,1200));
      return{nav,settingsOpened,blocks,secondId:second.id,thirdId:third.id,hiddenWhenOff};
    })()`);
    const measured=store.data.messages.filter(m=>m.role==='assistant'&&m.timing);
    if(result.nav.join(',')!=='chat,history'||!result.settingsOpened||!result.hiddenWhenOff||result.blocks.length!==2)throw new Error('Timing UI or settings toggle failed '+JSON.stringify(result));
    for(const reply of measured.slice(0,2)){
      const t=reply.timing;
      if(!(t.submittedAt<=t.receivedAt&&t.receivedAt<=t.cliSentAt&&t.cliSentAt<=t.firstReplyAt&&t.firstReplyAt<t.completedAt&&t.completedAt<=t.renderedAt))throw new Error('Invalid timing order '+JSON.stringify(t));
      if(Math.abs(t.inputMs+t.dispatchMs+t.cliMs+t.renderMs-t.totalMs)>.01||t.firstReplyMs<80||t.firstReplyMs>=t.cliMs)throw new Error('Incorrect stage durations '+JSON.stringify(t));
      if(reply.text.includes('수신 대답속도 측정'))throw new Error('Metrics leaked into model response');
    }
    if(measured[1].timing.queueMs<500)throw new Error('FIFO waiting time missing');
    const thirdIndex=store.data.messages.findIndex(m=>m.id===result.thirdId);if(store.data.messages[thirdIndex+1].timing)throw new Error('Measurement was collected while disabled');
    const last=store.data.messages.at(-1);if(!last.timing?.completedAt||last.timing.renderedAt!==undefined)throw new Error('Hidden chat acknowledged a display');
    await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="chat"]').click()`);
    for(let i=0;i<100&&last.timing.renderedAt===undefined;i++)await new Promise(r=>setTimeout(r,30));
    if(!last.timing.renderedAt)throw new Error('Chat reopening did not acknowledge display');
    const saved=new Store(store.directory,{});if(!saved.data.settings.measureResponseTime||!saved.data.messages.at(-1).timing.renderedAt)throw new Error('Timing or setting not persisted');
    fs.writeFileSync(path.join(artifactRoot,'alpha-response-timing.png'),(await panel.webContents.capturePage()).toPNG());
    const metrics=app.getAppMetrics().map(p=>({type:p.type,memory:p.memory,cpu:p.cpu}));
    const beforeTurns=(await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true})).thread.turns.length;
    const faultJobs=await panel.webContents.executeJavaScript(`(async()=>{const first=await window.onggi.action('send',{text:'저장 실패 중 답변'});const second=await window.onggi.action('send',{text:'저장 실패 뒤 실행 금지'});return[first.id,second.id];})()`);
    const originalSave=store.saveAsync;
    store.saveAsync=async function(){this.warning='테스트: 답변 저장 실패';throw new Error('test disk full');};
    for(let i=0;i<200&&!store.writeBlocked;i++)await new Promise(r=>setTimeout(r,30));
    const failedReply=store.data.messages[store.data.messages.findIndex(m=>m.id===faultJobs[0])+1],unstartedReply=store.data.messages[store.data.messages.findIndex(m=>m.id===faultJobs[1])+1];
    store.saveAsync=originalSave;
    if(!failedReply.error?.includes('저장하지 못')||unstartedReply.status!=='queued'||!store.writeBlocked)throw new Error('Save failure crashed completion or continued the queue');
    const afterTurns=(await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true})).thread.turns.length;
    if(afterTurns!==beforeTurns+1)throw new Error('Queue dispatched a question after storage failure');
    result.storageFailureHandled=true;store.writeBlocked=false;store.warning=null;await panel.webContents.executeJavaScript(`window.onggi.action('cancel-all-queued')`);await store.saveAsync();
    await panel.webContents.executeJavaScript(`window.onggi.action('continue-queue')`);await codex.request('test/hold',{enabled:true});
    const baselineMessages=[...store.data.messages],interruptSamples=[];
    const profileRenderer=process.env.ONGGI_TIMING_PERFORMANCE_DETAIL==='1';
    if(profileRenderer){panel.webContents.debugger.attach('1.3');await panel.webContents.debugger.sendCommand('Profiler.enable');await panel.webContents.debugger.sendCommand('Profiler.start');}
    try{
      for(const sizeMiB of process.env.ONGGI_TIMING_PERFORMANCE_DETAIL==='1'?[0,1,16,30]:[0]){
        if(sizeMiB)store.data.messages=Array.from({length:Math.floor(sizeMiB*1048576/100000)},(_,index)=>({id:'interrupt-cost-'+index,role:'assistant',text:('기록 '+index+' ').padEnd(99990,'x'),mode:'codex',status:'completed',createdAt:Date.now()}));
        await store.saveAsync();const historyBytes=fs.statSync(path.join(store.historyDirectory,store.data.activeConversationId+'.json')).size;
        const sent=await panel.webContents.executeJavaScript(`window.onggi.action('send',{text:'중단 전달 계측'})`),reply=store.data.messages[store.data.messages.findIndex(message=>message.id===sent.id)+1];
        let deadline=Date.now()+15000;while(Date.now()<deadline&&(!reply.turnId||!await panel.webContents.executeJavaScript(`!document.querySelector('#stop').hidden&&!document.querySelector('#stop').disabled`)))await new Promise(resolve=>setTimeout(resolve,20));
        if(!reply.turnId)throw Error('Interrupt measurement did not own a running fixture turn');
        if(sizeMiB&&!await panel.webContents.executeJavaScript(`document.querySelector('.message-body.long-token-text')!==null`))throw Error('Long technical text did not use its bounded layout style');
        const interrupt=codex.interrupt;let interruptAt=null;
        codex.interrupt=function(target){interruptAt=performance.timeOrigin+performance.now();return interrupt.call(this,target);};
        try{
          const clickedAt=await panel.webContents.executeJavaScript(`(()=>{const at=performance.timeOrigin+performance.now();document.querySelector('#stop').click();return at;})()`);
          deadline=Date.now()+15000;while(Date.now()<deadline&&(interruptAt===null||reply.status!=='interrupted'||store.saving))await new Promise(resolve=>setTimeout(resolve,20));
          if(interruptAt===null||reply.status!=='interrupted')throw Error('Interrupt did not reach the fixture CLI and finish');
          interruptSamples.push({sizeMiB,historyBytes,clickedAt,interruptAt,clickToFixtureDispatchMs:Math.max(0,interruptAt-clickedAt),completedAt:performance.timeOrigin+performance.now(),realModel:false});
        }finally{codex.interrupt=interrupt;}
      }
    }finally{
      if(profileRenderer){try{const {profile}=await panel.webContents.debugger.sendCommand('Profiler.stop');fs.writeFileSync(path.join(artifactRoot,'interrupt-renderer-profile.json'),JSON.stringify(profile));}finally{panel.webContents.debugger.detach();}}
      await codex.request('test/hold',{enabled:false});store.data.messages=baselineMessages;await store.saveAsync();
    }
    result.interruptSamples=interruptSamples;
    await panel.webContents.executeJavaScript(`window.onggi.action('new-chat')`);
    await panel.webContents.executeJavaScript(`window.__originalRAF=requestAnimationFrame;window.__heldFrames=[];window.requestAnimationFrame=callback=>{window.__heldFrames.push(callback);return window.__heldFrames.length;};void 0;`);
    try{
      const completedAt=performance.timeOrigin+performance.now()-20;
      store.data.messages=[{id:'reused-render-id',role:'assistant',text:'OLD_ACK_OWNER',mode:'codex',status:'completed',timing:{completedAt}}];await store.saveAsync();
      await panel.webContents.executeJavaScript(`window.onggi.action('sync')`);
      let deadline=Date.now()+5000;while(Date.now()<deadline&&!await panel.webContents.executeJavaScript(`Boolean(document.querySelector('.message[data-id="reused-render-id"]'))&&window.__heldFrames.length>0`))await new Promise(r=>setTimeout(r,20));
      if(!await panel.webContents.executeJavaScript(`Boolean(document.querySelector('.message[data-id="reused-render-id"]'))&&window.__heldFrames.length>0`))throw Error('Old render ACK was not scheduled');
      await panel.webContents.executeJavaScript(`window.__oldFrames=window.__heldFrames.splice(0);void 0;`);
      await panel.webContents.executeJavaScript(`window.onggi.action('new-chat')`);
      store.data.messages=[{id:'reused-render-id',role:'assistant',text:'NEW_ACK_OWNER',mode:'codex',status:'completed',timing:{completedAt:completedAt+1}}];await store.saveAsync();
      await panel.webContents.executeJavaScript(`window.onggi.action('sync')`);
      deadline=Date.now()+5000;while(Date.now()<deadline&&!await panel.webContents.executeJavaScript(`document.querySelector('.message[data-id="reused-render-id"]')?.textContent.includes('NEW_ACK_OWNER')&&window.__heldFrames.length>0`))await new Promise(r=>setTimeout(r,20));
      if(!await panel.webContents.executeJavaScript(`document.querySelector('.message[data-id="reused-render-id"]')?.textContent.includes('NEW_ACK_OWNER')&&window.__heldFrames.length>0`))throw Error('New render ACK owner was not prepared');
      await panel.webContents.executeJavaScript(`(async()=>{window.requestAnimationFrame=window.__originalRAF;for(const callback of window.__oldFrames)callback(performance.now());await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
      if(store.data.messages[0].timing.renderedAt!==undefined)throw Error('Old conversation acknowledged the new message with the same ID');
      await panel.webContents.executeJavaScript(`for(const callback of window.__heldFrames.splice(0))callback(performance.now())`);
      deadline=Date.now()+5000;while(Date.now()<deadline&&store.data.messages[0].timing.renderedAt===undefined)await new Promise(r=>setTimeout(r,20));
      if(store.data.messages[0].timing.renderedAt===undefined)throw Error('Stale ACK cleared the new owner');
      result.staleRenderAckDiscarded=true;
    }finally{await panel.webContents.executeJavaScript(`window.requestAnimationFrame=window.__originalRAF;void 0;`);}
    fs.writeFileSync(path.join(artifactRoot,'timing-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result,timings:measured.map(m=>m.timing),metrics},null,2));
    console.log('TIMING_STAGES_FIFO_DISPLAY_AND_OPT_OUT_OK',JSON.stringify({settingsOpened:result.settingsOpened,measured:measured.length,queueMs:measured[1].timing.queueMs,nav:result.nav}));app.quit();
  }catch(error){console.error('TIMING_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
