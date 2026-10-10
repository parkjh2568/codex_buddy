const fs=require('node:fs'),path=require('node:path');
const {Store}=require('../src/store.cjs');
module.exports=async({app,pet,panel,store,codex,personaLibrary,skins})=>{
  const results=[],original=personaLibrary.read('onggi-clip','concise').text;
  try{
    await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('settings',{chatMode:'panel',skinId:'paper'});await window.onggi.action('show-panel',{tab:'chat',full:true});})()`);
    await panel.webContents.executeJavaScript(`window.onggi.action('refresh-models')`);
    for(const character of ['onggi-clip','onggi-sprout'])for(const mode of ['friendly','warm-long','concise','blunt']){
      const prompt=`${character} / ${mode}: 책상 정리 방법을 알려줘.`;
      await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('select-character',{id:${JSON.stringify(character)}});await window.onggi.action('persona-settings',{characterId:${JSON.stringify(character)},mode:${JSON.stringify(mode)}});await window.onggi.action('send',{text:${JSON.stringify(prompt)}});})()`);
      const deadline=Date.now()+10000;while(Date.now()<deadline&&store.data.messages.at(-1)?.status!=='completed')await new Promise(r=>setTimeout(r,30));
      const reply=store.data.messages.at(-1),remote=await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true}),turn=remote.thread.turns.at(-1),expected=personaLibrary.resolve(character,mode,store.data.settings.buddyName);
      if(reply.status!=='completed'||reply.persona.hash!==expected.hash||turn.personaInstructions!==expected.instructions||turn.items[0].content[0].text!==prompt)throw Error('Persona/prompt snapshot failed '+character+'/'+mode);
      results.push({character,mode,hash:reply.persona.hash,threadId:store.data.threadId});
    }
    if(new Set(results.map(r=>r.threadId)).size!==1)throw Error('Mode switch created a different conversation');
    const base=personaLibrary.read('onggi-sprout','base').text;
    const editor=await panel.webContents.executeJavaScript(`(async()=>{
      document.querySelector('[data-tab="settings"]').click();document.querySelector('.persona-settings').open=true;
      const character=document.querySelector('#persona-character'),mode=document.querySelector('#persona-edit-mode'),input=document.querySelector('#persona-text');
      character.value='onggi-sprout';character.dispatchEvent(new Event('change'));mode.value='base';mode.dispatchEvent(new Event('change'));
      input.value=${JSON.stringify(base+'\n편집 화면 검증: EDITOR_MARKER')};await window.onggi.action('sync');await new Promise(r=>setTimeout(r,100));const draftPreserved=input.value.includes('EDITOR_MARKER');
      document.querySelector('#persona-editor-form').requestSubmit();let deadline=Date.now()+5000;while(Date.now()<deadline&&!document.querySelector('#persona-editor-status').textContent.includes('저장했어요'))await new Promise(r=>setTimeout(r,25));
      return{draftPreserved,saved:document.querySelector('#persona-editor-status').textContent.includes('저장했어요')};
    })()`);
    if(!editor.draftPreserved||!editor.saved||!personaLibrary.read('onggi-sprout','base').text.includes('EDITOR_MARKER'))throw Error('Markdown editor save/draft failed');
    await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('#persona-text').value=${JSON.stringify(base)};document.querySelector('#persona-editor-form').requestSubmit();await new Promise(r=>setTimeout(r,150));document.querySelector('[data-tab="chat"]').click();})()`);
    const frozen=await panel.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('select-character',{id:'onggi-clip'});await window.onggi.action('persona-settings',{characterId:'onggi-clip',mode:'friendly'});await window.onggi.action('send',{text:'첫 질문'});
      await window.onggi.action('persona-settings',{characterId:'onggi-clip',mode:'concise'});const queued=await window.onggi.action('send',{text:'큐에 들어간 질문'});
      await window.onggi.action('persona-save',{characterId:'onggi-clip',id:'concise',text:${JSON.stringify(original+'\n편집된 규칙: SNAPSHOT_EDIT 표식을 포함한다.')}});return queued.id;
    })()`);
    let deadline=Date.now()+10000;while(Date.now()<deadline&&store.data.messages.find(m=>m.id===frozen)?.status!=='completed')await new Promise(r=>setTimeout(r,30));
    const remote=await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true});
    if(remote.thread.turns.at(-1).personaInstructions.includes('SNAPSHOT_EDIT'))throw Error('Queued persona changed after submission');
    await panel.webContents.executeJavaScript(`window.onggi.action('send',{text:'편집 후 질문'})`);
    deadline=Date.now()+10000;while(Date.now()<deadline&&store.data.messages.at(-1)?.status!=='completed')await new Promise(r=>setTimeout(r,30));
    const edited=await codex.request('thread/read',{threadId:store.data.threadId,includeTurns:true});if(!edited.thread.turns.at(-1).personaInstructions.includes('SNAPSHOT_EDIT'))throw Error('Edited MD was not applied');
    for(const skin of skins){
      await panel.webContents.executeJavaScript(`window.onggi.action('settings',{skinId:${JSON.stringify(skin.id)},chatMode:'bubble'})`);
      await panel.webContents.executeJavaScript(`window.onggi.action('show-panel',{tab:'chat'})`);
      await new Promise(r=>setTimeout(r,120));
      const layout=await panel.webContents.executeJavaScript(`({compact:document.body.classList.contains('compact-mode'),headerHidden:getComputedStyle(document.querySelector('.header')).display==='none',tail:getComputedStyle(document.querySelector('#panel-surface'),'::after').content!=='none',skin:document.body.dataset.skin,composerVisible:document.querySelector('#composer').getBoundingClientRect().bottom<innerHeight,width:innerWidth,height:innerHeight,visibleMessages:[...document.querySelectorAll('.message')].filter(m=>getComputedStyle(m).display!=='none').length,background:getComputedStyle(document.querySelector('.panel-shell')).backgroundColor})`);
      if(!layout.compact||!layout.headerHidden||!layout.tail||!layout.composerVisible||layout.visibleMessages!==2||layout.width!==360||layout.height!==410||layout.skin!==skin.id)throw Error('Mini bubble layout failed '+JSON.stringify(layout));
      const alignment=await panel.webContents.executeJavaScript(`(()=>{const b=s=>document.querySelector(s).getBoundingClientRect(),title=b('#mini-buddy-title'),composer=b('#composer'),model=b('.model-bar'),close=b('#close-mini'),input=b('#prompt'),send=b('#send'),persona=b('#persona-select'),toggle=b('#model-menu-toggle');const label=document.querySelector('#model-menu-label'),option=document.querySelector('#persona-select').selectedOptions[0],oldLabel=label.textContent,oldOption=option.textContent,stop=document.querySelector('#stop'),oldHidden=stop.hidden;label.textContent='A very long model name that must not cover the send button';option.textContent='상냥한 장문 모드';stop.hidden=false;const boxes=[...document.querySelectorAll('#persona-select,#model-menu-toggle,#stop,#send')].map(e=>e.getBoundingClientRect()),longNamesFit=boxes.every((r,i)=>r.left>=composer.left&&r.right<=composer.right&&(!i||r.left>=boxes[i-1].right))&&boxes.at(-1).width===send.width;label.textContent=oldLabel;option.textContent=oldOption;stop.hidden=oldHidden;return{longNamesFit,sharedLeft:Math.abs(title.left-composer.left)<1&&Math.abs(model.left-input.left)<1,sharedRight:Math.abs(close.right-composer.right)<1&&Math.abs(send.right-input.right)<1,controlHeightsEqual:Math.abs(persona.height-toggle.height)<1,sameLine:Math.abs(persona.top-toggle.top)<1,personaLeftModelRight:persona.right<=toggle.left&&Math.abs(toggle.right-model.right)<1&&toggle.right<=send.left&&document.querySelector('#composer').contains(document.querySelector('#persona-select')),noHorizontalOverflow:document.querySelector('.panel-shell').scrollWidth<=document.querySelector('.panel-shell').clientWidth};})()`);
      if(!Object.values(alignment).every(Boolean))throw Error('Mini alignment failed '+JSON.stringify(alignment));layout.alignment=alignment;
      fs.writeFileSync(path.join(__dirname,'..','artifacts','buddy-mini-'+skin.id+'.png'),(await panel.webContents.capturePage()).toPNG());results.push({skin:skin.id,layout});
      const popup=await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('#model-menu-toggle').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const menu=document.querySelector('#model-popover'),r=menu.getBoundingClientRect();return{open:menu.matches(':popover-open'),withinWindow:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,modelVisible:document.querySelector('#model-select').getBoundingClientRect().height>0,effortVisible:document.querySelector('#effort-select').getBoundingClientRect().height>0,speedVisible:document.querySelector('#speed-select').getBoundingClientRect().height>0};})()`);
      if(!Object.values(popup).every(Boolean))throw Error('Mini model popup failed '+JSON.stringify(popup));layout.popup=popup;
      fs.writeFileSync(path.join(__dirname,'..','artifacts','buddy-model-popup-'+skin.id+'.png'),(await panel.webContents.capturePage()).toPNG());
      await panel.webContents.executeJavaScript(`document.querySelector('#model-popover').hidePopover()`);
    }
    const thread=store.data.threadId,count=store.data.messages.length;
    const oldBubble=panel.getBounds(),oldPet=pet.getBounds(),wasFocused=panel.isFocused();
    await pet.webContents.executeJavaScript(`(async()=>{await window.onggi.action('drag-start',{x:400,y:400});await window.onggi.action('drag-move',{x:340,y:350});await window.onggi.action('drag-end');})()`);
    const movedBubble=panel.getBounds(),movedPet=pet.getBounds();
    if(movedPet.x===oldPet.x||JSON.stringify(movedBubble)===JSON.stringify(oldBubble)||panel.isFocused()!==wasFocused)throw Error('Moving the character detached or refocused its bubble');
    await panel.webContents.executeJavaScript(`(async()=>{const input=document.querySelector('#prompt');input.value='미니에서 작성한 초안';input.dispatchEvent(new Event('input'));document.querySelector('#expand-chat').click();})()`);
    await new Promise(r=>setTimeout(r,150));
    const expanded=await panel.webContents.executeJavaScript(`({full:!document.body.classList.contains('compact-mode'),draft:document.querySelector('#prompt').value,width:innerWidth})`);
    if(!expanded.full||expanded.draft!=='미니에서 작성한 초안'||expanded.width!==460||store.data.threadId!==thread||store.data.messages.length!==count)throw Error('Bubble expand lost history or draft');
    const reloaded=new Store(store.directory,{});if(reloaded.data.settings.skinId!==store.data.settings.skinId)throw Error('Skin persistence failed');
    if(reloaded.data.settings.chatMode!=='bubble'||reloaded.data.settings.personaModes['onggi-clip']!=='concise'||reloaded.data.settings.personaModes['onggi-sprout']!=='blunt')throw Error('Per-character preferences failed');
    fs.writeFileSync(path.join(__dirname,'..','artifacts','buddy-features-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),platform:process.platform,results,editor,bubbleFollowsPet:true,focusPreserved:true,queueSnapshot:true,editedMdApplied:true,expanded,historyPreserved:true,persisted:true,realModel:false},null,2));
    console.log('BUDDY_SKINS_MINI_AND_PERSONA_MATRIX_OK');app.quit();
  }catch(error){console.error(error.stack);codex.stop();app.exit(1);}
  finally{personaLibrary.save('onggi-clip','concise',original);}
};
