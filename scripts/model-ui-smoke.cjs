const fs=require('node:fs');
const path=require('node:path');
module.exports=async({app,panel,store,codex,modelCatalog})=>{
  try{
    const result=await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('refresh-models');
      await window.onggi.action('model-settings',{model:'test-main',effort:'low'});
      const readyDeadline=Date.now()+5000;
      while(Date.now()<readyDeadline&&(!document.querySelector('#model-select option[value="test-small"]')||!document.querySelector('#model-info').textContent.includes('Test Main / low')))await new Promise(r=>setTimeout(r,40));
      if(!document.querySelector('#model-select option[value="test-small"]'))throw new Error('Model picker did not load');
      const first=await window.onggi.action('send',{text:'first'});
      const speed=document.querySelector('#speed-select');speed.value='priority';speed.dispatchEvent(new Event('change'));
      let speedDeadline=Date.now()+5000;while(Date.now()<speedDeadline&&!document.querySelector('#model-info').textContent.includes('Fast'))await new Promise(r=>setTimeout(r,40));
      const second=await window.onggi.action('send',{text:'second'});
      const select=document.querySelector('#model-select');select.value='test-small';select.dispatchEvent(new Event('change'));
      const changedDeadline=Date.now()+5000;
      while(Date.now()<changedDeadline&&!document.querySelector('#model-info').textContent.includes('Test Small / medium'))await new Promise(r=>setTimeout(r,40));
      if(!document.querySelector('#model-info').textContent.includes('Test Small / medium'))throw new Error('Model change did not apply');
      const efforts=[...document.querySelector('#effort-select').options].map(o=>o.value);
      const third=await window.onggi.action('send',{text:'third'});
      select.value='';select.dispatchEvent(new Event('change'));
      const defaultDeadline=Date.now()+5000;
      while(Date.now()<defaultDeadline&&!document.querySelector('#model-info').textContent.includes('Test Main / high'))await new Promise(r=>setTimeout(r,40));
      const fourth=await window.onggi.action('send',{text:'fourth'});
      speed.value='priority';speed.dispatchEvent(new Event('change'));
      speedDeadline=Date.now()+5000;while(Date.now()<speedDeadline&&!document.querySelector('#model-info').textContent.includes('Fast'))await new Promise(r=>setTimeout(r,40));
      const fifth=await window.onggi.action('send',{text:'fifth-fast'});
      speed.value='default';speed.dispatchEvent(new Event('change'));
      speedDeadline=Date.now()+5000;while(Date.now()<speedDeadline&&!document.querySelector('#model-info').textContent.includes('Standard'))await new Promise(r=>setTimeout(r,40));
      const sixth=await window.onggi.action('send',{text:'sixth-standard'});
      let unsupportedSpeedRejected=false;try{await window.onggi.action('model-settings',{model:'test-small',effort:'medium',serviceTier:'priority'});}catch(e){unsupportedSpeedRejected=e.message.includes('속도');}
      const composer=document.querySelector('#composer').getBoundingClientRect(),bar=document.querySelector('.model-bar').getBoundingClientRect();
      const outsideComposer=!document.querySelector('#composer').contains(speed)&&bar.top>=composer.bottom;

      let invalidRejected=false;
      try{await window.onggi.action('model-settings',{model:'test-small',effort:'ultra'});}catch(e){invalidRejected=e.message.includes('지원하지');}
      const completeDeadline=Date.now()+15000;
      while(Date.now()<completeDeadline&&!document.querySelector('.message.user[data-id="'+sixth.id+'"][data-status="completed"]'))await new Promise(r=>setTimeout(r,50));
      return{ids:[first.id,second.id,third.id,fourth.id,fifth.id,sixth.id],efforts,invalidRejected,unsupportedSpeedRejected,outsideComposer,modelInfo:document.querySelector('#model-info').textContent};
    })()`);
    const expected=[['test-main','low','default'],['test-main','low','priority'],['test-small','medium','default'],['test-main','high','default'],['test-main','high','priority'],['test-main','high','default']];
    for(let i=0;i<result.ids.length;i++){
      const index=store.data.messages.findIndex(m=>m.id===result.ids[i]);
      const user=store.data.messages[index],reply=store.data.messages[index+1];
      if(user.model!==expected[i][0]||user.effort!==expected[i][1]||reply.status!=='completed'||user.serviceTier!==expected[i][2]||!reply.text.includes(expected[i].slice(0,2).join(' / '))||!reply.text.includes('Service tier: '+expected[i][2]))throw new Error('Queue model snapshot differs from dispatched model: '+JSON.stringify({user,reply}));
    }
    if(!result.outsideComposer||!result.unsupportedSpeedRejected||!result.invalidRejected||result.efforts.join(',')!==',medium')throw new Error(JSON.stringify(result));
    modelCatalog.refreshedAt=0;
    const updated=await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('.model-bar').dispatchEvent(new Event('pointerenter'));const deadline=Date.now()+5000;while(Date.now()<deadline&&!document.querySelector('#model-select option[value="test-new"]'))await new Promise(r=>setTimeout(r,40));return Boolean(document.querySelector('#model-select option[value="test-new"]'));})()`);
    if(!updated)throw new Error('Stale CLI catalog did not refresh automatically');result.autoRefreshed=updated;
    const updatedExecutable=path.join(store.directory,'updated-test-codex.cjs');fs.copyFileSync(store.data.settings.codexPath,updatedExecutable);fs.chmodSync(updatedExecutable,0o700);
    store.data.settings.codexPath=updatedExecutable;
    await panel.webContents.executeJavaScript(`window.onggi.action('refresh-models',{ifStale:true})`);
    const previousPid=codex.process.pid;fs.utimesSync(updatedExecutable,new Date(),new Date(Date.now()+1000));
    await panel.webContents.executeJavaScript(`window.onggi.action('refresh-models',{ifStale:true})`);
    if(codex.process.pid===previousPid)throw new Error('Updated CLI binary did not reconnect');result.cliUpdateReconnected=true;
    await panel.webContents.executeJavaScript(`window.onggi.action('refresh-models')`);
    await new Promise(r=>setTimeout(r,150));
    await panel.webContents.executeJavaScript(`document.querySelector('#model-select').focus()`);
    modelCatalog.models.push({...modelCatalog.models[0],model:'test-focused-update',name:'Focused catalog update'});
    await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);
    await new Promise(r=>setTimeout(r,150));
    const focusedRefresh=await panel.webContents.executeJavaScript(`(async()=>{
      const picker=document.querySelector('#model-select');
      const retained=document.activeElement===picker&&!picker.disabled&&!document.querySelector('#model-select option[value="test-focused-update"]');
      document.querySelector('#prompt').focus();await new Promise(r=>setTimeout(r,150));
      return{retained,refreshed:!!document.querySelector('#model-select option[value="test-focused-update"]')};
    })()`);
    if(!focusedRefresh.retained||!focusedRefresh.refreshed)throw new Error('Background model refresh interrupted the picker: '+JSON.stringify(focusedRefresh));
    result.focusedRefresh=focusedRefresh;
    fs.mkdirSync(path.join(__dirname,'..','artifacts'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'..','artifacts','model-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result,expected},null,2));
    fs.writeFileSync(path.join(__dirname,'..','artifacts','alpha-models.png'),(await panel.webContents.capturePage()).toPNG());
    console.log('MODEL_UI_QUEUE_SWITCH_OK',JSON.stringify(result));app.quit();
  }catch(error){console.error('MODEL_UI_SMOKE_FAILED',error);codex.stop();app.exit(1);}
};
