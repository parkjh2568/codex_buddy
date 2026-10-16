const fs=require('node:fs');
const path=require('node:path');
module.exports=async({panel})=>{
  const original=panel.getBounds(),results=[],originalSkin=await panel.webContents.executeJavaScript(`document.body.dataset.skin`);
  try{
    const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
    for(const size of [{width:460,height:740},{width:390,height:580},{width:720,height:900}]){
      panel.setSize(size.width,size.height);
      const result=await panel.webContents.executeJavaScript(`(async()=>{
        document.querySelector('[data-tab="chat"]').click();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const input=document.querySelector('#prompt'),composer=document.querySelector('#composer'),messages=document.querySelector('#messages');
        const empty=input.getBoundingClientRect().height;
        input.value=Array(12).fill('여러 줄로 생각을 정리하는 질문입니다.').join('\\n');input.dispatchEvent(new Event('input'));
        const expanded=input.getBoundingClientRect().height,max=parseFloat(getComputedStyle(input).maxHeight);
        input.value='';input.dispatchEvent(new Event('input'));
        const restored=input.getBoundingClientRect().height;
        const boxes=['.tabs','#connection-label','#composer'].map(s=>document.querySelector(s).getBoundingClientRect());
        const persona=document.querySelector('#persona-select').getBoundingClientRect(),model=document.querySelector('#model-menu-toggle').getBoundingClientRect(),send=document.querySelector('#send').getBoundingClientRect(),frame=composer.getBoundingClientRect(),modelStyle=getComputedStyle(document.querySelector('#model-menu-toggle'));
        const footerInside=composer.contains(document.querySelector('#persona-select'))&&composer.contains(document.querySelector('#model-menu-toggle'))&&persona.left>=frame.left&&model.right<=send.left&&send.right<=frame.right;
        const label=document.querySelector('#model-menu-label'),option=document.querySelector('#persona-select').selectedOptions[0],savedLabel=label.textContent,savedOption=option.textContent,stop=document.querySelector('#stop'),savedHidden=stop.hidden;
        label.textContent='A very long model name that must not cover the send button';option.textContent='상냥한 장문 모드';stop.hidden=false;
        const stressed=[...document.querySelectorAll('#persona-select,#composer-menu-toggle,#model-menu-toggle,#stop,#send')].map(e=>e.getBoundingClientRect()),longNamesFit=stressed.every((r,i)=>r.left>=frame.left&&r.right<=frame.right&&(!i||r.left>=stressed[i-1].right))&&stressed.at(-1).width===send.width&&stressed[1].width>=32;
        label.textContent=savedLabel;option.textContent=savedOption;stop.hidden=savedHidden;
        return{width:innerWidth,height:innerHeight,empty,expanded,restored,max,aligned:boxes.every(b=>Math.abs(b.x-boxes[0].x)<1),footerSameLine:Math.abs(persona.top-model.top)<1,footerInside,longNamesFit,shortcutHelpHidden:!document.querySelector('#composer-hint')&&document.querySelector('#send').title.includes('Shift+Enter'),personaLeftModelRight:persona.right<=model.left,borderlessModel:modelStyle.borderTopWidth==='0px'&&modelStyle.backgroundColor==='rgba(0, 0, 0, 0)',composerVisible:composer.getBoundingClientRect().bottom<innerHeight,messagesHeight:messages.clientHeight,welcomeOverflow:messages.scrollHeight-messages.clientHeight,bodyOverflow:document.body.scrollHeight>innerHeight,bodyFont:getComputedStyle(document.querySelector('.message-body')??input).fontSize};
      })()`);
      if(!result.aligned||!result.footerSameLine||!result.footerInside||!result.longNamesFit||!result.shortcutHelpHidden||!result.personaLeftModelRight||!result.borderlessModel||!result.composerVisible||result.bodyOverflow||result.expanded<=result.empty||result.expanded>result.max||result.restored!==result.empty||result.messagesHeight<150||result.welcomeOverflow>2)throw Error('UI layout/input regression '+JSON.stringify(result));
      results.push(result);
      fs.writeFileSync(path.join(artifactRoot,size.width===720?'ui-refined-wide.png':size.height===740?'ui-refined-welcome.png':'ui-refined-compact.png'),(await panel.webContents.capturePage()).toPNG());
      const screens=await panel.webContents.executeJavaScript(`(async()=>{
        const rect=s=>document.querySelector(s).getBoundingClientRect();
        document.querySelector('[data-tab="history"]').click();document.querySelector('#history-tab').scrollTop=0;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const search=rect('#history-search'),newChat=rect('#history-new'),historyHeading=rect('#history-tab .section-heading');
        const tabs=rect('.tabs');const history={aligned:Math.abs(search.left-historyHeading.left)<1,sharedRight:Math.abs(historyHeading.right-tabs.right)<1&&Math.abs(newChat.right-tabs.right)<1,heightsEqual:Math.abs(search.height-newChat.height)<1,centersEqual:Math.abs(search.top-newChat.top)<1};
        document.querySelector('[data-tab="settings"]').click();for(const d of document.querySelectorAll('#settings-tab details'))d.open=true;document.querySelector('#settings-tab').scrollTop=0;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const selects=[...document.querySelectorAll('#settings-tab .select-row select')].map(e=>e.getBoundingClientRect()),name=rect('#buddy-name'),save=rect('#save-buddy-name');
        const settings={aligned:['.buddy-name-form','.character-cards','#import-pack','.appearance-settings','.persona-settings','#persona-text'].every(s=>Math.abs(rect(s).left-rect('#settings-tab .section-heading').left)<1),sharedRight:['.buddy-name-form','.character-cards','#import-pack','.appearance-settings','.persona-settings','#persona-text'].every(s=>Math.abs(rect(s).right-tabs.right)<1),columnsEqual:selects.length>0&&selects.every(b=>Math.abs(b.left-selects[0].left)<1&&Math.abs(b.right-selects[0].right)<1&&Math.abs(b.height-selects[0].height)<1),nameHeightEqual:Math.abs(name.height-save.height)<1&&Math.abs(name.top-save.top)<1,nameButtonWidthMatchesHistory:Math.abs(save.width-newChat.width)<1,editorButtonsEqual:[...document.querySelectorAll('.persona-editor-actions')].every(row=>{const boxes=[...row.querySelectorAll('button')].map(e=>e.getBoundingClientRect());return boxes.every(b=>Math.abs(b.width-boxes[0].width)<1&&Math.abs(b.height-boxes[0].height)<1)}),noHorizontalOverflow:document.querySelector('#settings-tab').scrollWidth<=document.querySelector('#settings-tab').clientWidth};
        for(const d of document.querySelectorAll('#settings-tab details'))d.open=false;
        return{width:innerWidth,history,settings};
      })()`);
      if(!Object.values(screens.history).every(Boolean)||!Object.values(screens.settings).every(Boolean))throw Error('Screen alignment regression '+JSON.stringify(screens));
      results.push(screens);
      fs.writeFileSync(path.join(artifactRoot,size.width===720?'ui-refined-settings-wide.png':size.height===740?'ui-refined-settings.png':'ui-refined-settings-compact.png'),(await panel.webContents.capturePage()).toPNG());
      for(const skinId of ['paper','night','mono']){
        const stress=await panel.webContents.executeJavaScript(`(async()=>{
          await window.onggi.action('settings',{skinId:${JSON.stringify(skinId)}});const deadline=Date.now()+5000;while(document.body.dataset.skin!==${JSON.stringify(skinId)}){if(Date.now()>deadline)throw Error('Settings skin did not apply');await new Promise(r=>setTimeout(r,20));}
          document.querySelector('[data-tab="settings"]').click();for(const detail of document.querySelectorAll('#settings-tab details'))detail.open=true;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const swatch=document.createElement('span');swatch.style.backgroundColor='var(--wash)';document.body.append(swatch);const expectedCardBackground=getComputedStyle(swatch).backgroundColor;swatch.remove();const paintDeadline=Date.now()+2000;
          while([...document.querySelectorAll('.character-card')].some(card=>getComputedStyle(card).backgroundColor!==expectedCardBackground)){if(Date.now()>paintDeadline)throw Error('Settings card skin transition did not settle');await new Promise(r=>requestAnimationFrame(r));}
          const times=[...document.querySelectorAll('#settings-tab input[type="time"]')],selects=[...document.querySelectorAll('#settings-tab .select-row select')],summary=[...document.querySelectorAll('#settings-tab :is(.pack-settings,.persona-settings,.connection-advanced,.usage-settings)>summary')],cards=[...document.querySelectorAll('.character-card img')],buttons=[...document.querySelectorAll('.character-card')];
          return{skin:document.body.dataset.skin,width:innerWidth,expectedCardBackground,cardBackgroundSettled:buttons.length>0&&buttons.every(button=>getComputedStyle(button).backgroundColor===expectedCardBackground),timeHeights:times.length===2&&times.every(input=>Math.abs(input.getBoundingClientRect().height-40)<1),timeRightAligned:times.every(input=>Math.abs(input.getBoundingClientRect().right-input.closest('.select-row').getBoundingClientRect().right)<1),selectHeights:selects.every(select=>Math.abs(select.getBoundingClientRect().height-40)<1),summaryConsistency:summary.length>=4&&summary.every(node=>{const style=getComputedStyle(node),first=getComputedStyle(summary[0]);return style.fontSize===first.fontSize&&style.paddingTop===first.paddingTop&&style.paddingBottom===first.paddingBottom;}),characterAspect:cards.length>0&&cards.every(image=>getComputedStyle(image).objectFit==='contain'),characterButtonsFit:buttons.every(button=>button.scrollWidth<=button.clientWidth+1),noHorizontalOverflow:document.querySelector('#settings-tab').scrollWidth<=document.querySelector('#settings-tab').clientWidth};
        })()`);
        if(Object.entries(stress).some(([key,value])=>!['skin','width'].includes(key)&&!value))throw Error('Expanded settings skin/controls regression '+JSON.stringify(stress));results.push(stress);
        fs.writeFileSync(path.join(artifactRoot,`ui-refined-settings-${skinId}-${size.width}.png`),(await panel.webContents.capturePage()).toPNG());
      }
    }
    panel.setBounds(original);
    for(const tab of ['history','settings']){
      await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-tab="${tab}"]').click();document.querySelector('#${tab}-tab').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
      fs.writeFileSync(path.join(artifactRoot,`ui-refined-${tab}.png`),(await panel.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(artifactRoot,'ui-layout-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),platform:process.platform,results},null,2));
    console.log('UI_ALIGNMENT_INPUT_AND_COMPACT_OK',JSON.stringify(results));
  }finally{
    panel.setBounds(original);
    if(originalSkin)await panel.webContents.executeJavaScript(`window.onggi.action('settings',{skinId:${JSON.stringify(originalSkin)}})`);
    await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="chat"]').click()`);
  }
};
