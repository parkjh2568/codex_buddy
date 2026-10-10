const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('../src/store.cjs');
module.exports=async({pet,panel,store})=>{
  const previous=store.data.settings.buddyName,threadId=store.data.threadId,conversationId=store.data.activeConversationId;
  const historyFile=path.join(store.historyDirectory,conversationId+'.json'),history=fs.readFileSync(historyFile,'utf8');
  try{
    const result=await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('[data-tab="settings"]').click();
      const input=document.querySelector('#buddy-name');input.value='  포근이  ';input.dispatchEvent(new Event('input'));
      await window.onggi.action('sync');await new Promise(r=>setTimeout(r,100));
      const draftPreserved=input.value==='  포근이  ';
      document.querySelector('#buddy-name-form').requestSubmit();
      let deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelector('#buddy-title').textContent!=='포근이')await new Promise(r=>setTimeout(r,25));
      const renamed=document.querySelector('#buddy-title').textContent==='포근이'&&input.value==='포근이'&&document.querySelector('#prompt').placeholder.includes('포근이')&&document.querySelector('.message.assistant .message-label').textContent.startsWith('포근이');
      const invalid=[];
      for(const name of ['', '가'.repeat(21), '줄\\n바꿈', 42]){try{await window.onggi.action('rename-buddy',{name});invalid.push(false);}catch{invalid.push(true);}}
      input.value='';document.querySelector('#buddy-name-form').requestSubmit();
      deadline=Date.now()+5000;while(Date.now()<deadline&&input.getAttribute('aria-invalid')!=='true')await new Promise(r=>setTimeout(r,25));
      const inlineError=input.getAttribute('aria-invalid')==='true'&&!document.querySelector('#buddy-name-status').hidden;
      await window.onggi.action('rename-buddy',{name:'<b>포근</b>'});
      deadline=Date.now()+5000;while(Date.now()<deadline&&document.querySelector('#buddy-title').textContent!=='<b>포근</b>')await new Promise(r=>setTimeout(r,25));
      const literal=document.querySelector('#buddy-title').textContent==='<b>포근</b>'&&!document.querySelector('#buddy-title').children.length;
      input.value='포근이';input.dispatchEvent(new Event('input'));document.querySelector('#buddy-name-form').requestSubmit();
      deadline=Date.now()+5000;while(Date.now()<deadline&&(document.querySelector('#buddy-title').textContent!=='포근이'||document.querySelector('#buddy-name-status').textContent!=='이름을 저장했어요.'))await new Promise(r=>setTimeout(r,25));
      return{draftPreserved,renamed,invalid:inlineError&&invalid.every(Boolean),literal};
    })()`);
    if(!result.draftPreserved||!result.renamed||!result.invalid||!result.literal)throw Error('Buddy naming UI failed '+JSON.stringify(result));
    const reloaded=new Store(store.directory,{buddyName:'옹기봇'});
    if(reloaded.data.settings.buddyName!=='포근이'||store.data.threadId!==threadId||store.data.activeConversationId!==conversationId||fs.readFileSync(historyFile,'utf8')!==history)throw Error('Name persistence altered conversation');
    const petResult=await pet.webContents.executeJavaScript(`(async()=>{let deadline=Date.now()+5000;while(Date.now()<deadline&&!document.querySelector('#pet-character').getAttribute('aria-label').startsWith('포근이'))await new Promise(r=>setTimeout(r,25));return document.querySelector('#pet-character').getAttribute('aria-label').startsWith('포근이');})()`);
    if(!petResult)throw Error('Pet name not synchronized');
    let petRejected=false;
    try{await pet.webContents.executeJavaScript(`window.onggi.action('rename-buddy',{name:'다른 이름'})`);}catch(error){petRejected=error.message.includes('설정 화면');}
    if(!petRejected||store.data.settings.buddyName!=='포근이')throw Error('Pet window renamed buddy');
    await panel.webContents.executeJavaScript(`document.querySelector('[data-character="onggi-sprout"]').click()`);
    await new Promise(r=>setTimeout(r,150));
    if(store.data.settings.buddyName!=='포근이')throw Error('Character change reset name');
    fs.writeFileSync(path.join(__dirname,'..','artifacts','buddy-name-settings.png'),(await panel.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(__dirname,'..','artifacts','buddy-name-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),platform:process.platform,...result,persisted:true,conversationPreserved:true,petSynchronized:true,petRejected,characterIndependent:true},null,2));
    console.log('BUDDY_NAME_UI_PERSISTENCE_AND_BOUNDARY_OK',JSON.stringify(result));
  }finally{
    await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('rename-buddy',{name:${JSON.stringify(previous)}});await window.onggi.action('select-character',{id:'onggi-clip'});document.querySelector('[data-tab="chat"]').click();})()`);
  }
};
