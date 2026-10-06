const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('../src/store.cjs');
module.exports=async({app,panel,store,codex})=>{
  try{
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
    fs.writeFileSync(path.join(__dirname,'..','artifacts','alpha-response-timing.png'),(await panel.webContents.capturePage()).toPNG());
    const metrics=app.getAppMetrics().map(p=>({type:p.type,memory:p.memory,cpu:p.cpu}));
    const beforeTurns=(await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true})).thread.turns.length;
    const faultJobs=await panel.webContents.executeJavaScript(`(async()=>{const first=await window.onggi.action('send',{text:'저장 실패 중 답변'});const second=await window.onggi.action('send',{text:'저장 실패 뒤 실행 금지'});return[first.id,second.id];})()`);
    const originalSave=store.save;
    store.save=function(){this.warning='테스트: 답변 저장 실패';throw new Error('test disk full');};
    for(let i=0;i<200&&store.data.messages.at(-1).status!=='interrupted';i++)await new Promise(r=>setTimeout(r,30));
    const failedReply=store.data.messages[store.data.messages.findIndex(m=>m.id===faultJobs[0])+1],unstartedReply=store.data.messages[store.data.messages.findIndex(m=>m.id===faultJobs[1])+1];
    store.save=originalSave;
    if(!failedReply.error?.includes('저장하지 못')||unstartedReply.status!=='interrupted'||!store.writeBlocked)throw new Error('Save failure crashed completion or continued the queue');
    const afterTurns=(await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true})).thread.turns.length;
    if(afterTurns!==beforeTurns+1)throw new Error('Queue dispatched a question after storage failure');
    result.storageFailureHandled=true;store.writeBlocked=false;store.warning=null;store.save();
    fs.writeFileSync(path.join(__dirname,'..','artifacts','timing-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result,timings:measured.map(m=>m.timing),metrics},null,2));
    console.log('TIMING_STAGES_FIFO_DISPLAY_AND_OPT_OUT_OK',JSON.stringify({settingsOpened:result.settingsOpened,measured:measured.length,queueMs:measured[1].timing.queueMs,nav:result.nav}));app.quit();
  }catch(error){console.error('TIMING_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
