const fs=require('node:fs');
const path=require('node:path');
module.exports=async({panel})=>{
  const original=panel.getBounds(),results=[];
  try{
    for(const size of [{width:460,height:740},{width:390,height:580}]){
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
        const stressed=[...document.querySelectorAll('#persona-select,#model-menu-toggle,#stop,#send')].map(e=>e.getBoundingClientRect()),longNamesFit=stressed.every((r,i)=>r.left>=frame.left&&r.right<=frame.right&&(!i||r.left>=stressed[i-1].right))&&stressed.at(-1).width===send.width;
        label.textContent=savedLabel;option.textContent=savedOption;stop.hidden=savedHidden;
        return{width:innerWidth,height:innerHeight,empty,expanded,restored,max,aligned:boxes.every(b=>Math.abs(b.x-boxes[0].x)<1),footerSameLine:Math.abs(persona.top-model.top)<1,footerInside,longNamesFit,shortcutHelpHidden:!document.querySelector('#composer-hint')&&document.querySelector('#send').title.includes('Shift+Enter'),personaLeftModelRight:persona.right<=model.left,borderlessModel:modelStyle.borderTopWidth==='0px'&&modelStyle.backgroundColor==='rgba(0, 0, 0, 0)',composerVisible:composer.getBoundingClientRect().bottom<innerHeight,messagesHeight:messages.clientHeight,welcomeOverflow:messages.scrollHeight-messages.clientHeight,bodyOverflow:document.body.scrollHeight>innerHeight,bodyFont:getComputedStyle(document.querySelector('.message-body')??input).fontSize};
      })()`);
      if(!result.aligned||!result.footerSameLine||!result.footerInside||!result.longNamesFit||!result.shortcutHelpHidden||!result.personaLeftModelRight||!result.borderlessModel||!result.composerVisible||result.bodyOverflow||result.expanded<=result.empty||result.expanded>result.max||result.restored!==result.empty||result.messagesHeight<150||result.welcomeOverflow>2)throw Error('UI layout/input regression '+JSON.stringify(result));
      results.push(result);
      fs.writeFileSync(path.join(__dirname,'..','artifacts',size.height===740?'ui-refined-welcome.png':'ui-refined-compact.png'),(await panel.webContents.capturePage()).toPNG());
      const screens=await panel.webContents.executeJavaScript(`(async()=>{
        const rect=s=>document.querySelector(s).getBoundingClientRect();
        document.querySelector('[data-tab="history"]').click();document.querySelector('#history-tab').scrollTop=0;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const search=rect('#history-search'),newChat=rect('#history-new'),historyHeading=rect('#history-tab .section-heading');
        const tabs=rect('.tabs');const history={aligned:Math.abs(search.left-historyHeading.left)<1,sharedRight:Math.abs(historyHeading.right-tabs.right)<1&&Math.abs(newChat.right-tabs.right)<1,heightsEqual:Math.abs(search.height-newChat.height)<1,centersEqual:Math.abs(search.top-newChat.top)<1};
        document.querySelector('[data-tab="settings"]').click();for(const d of document.querySelectorAll('details.settings-group'))d.open=true;document.querySelector('#settings-tab').scrollTop=0;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const selects=[...document.querySelectorAll('.select-row select')].map(e=>e.getBoundingClientRect()),name=rect('#buddy-name'),save=rect('#save-buddy-name');
        const settings={aligned:['.buddy-name-form','.character-cards','#import-pack','.appearance-settings','.persona-settings','#persona-text'].every(s=>Math.abs(rect(s).left-rect('#settings-tab .section-heading').left)<1),sharedRight:['.buddy-name-form','.character-cards','#import-pack','.appearance-settings','.persona-settings','#persona-text'].every(s=>Math.abs(rect(s).right-tabs.right)<1),columnsEqual:selects.every(b=>Math.abs(b.left-selects[0].left)<1&&Math.abs(b.right-selects[0].right)<1&&Math.abs(b.height-selects[0].height)<1),nameHeightEqual:Math.abs(name.height-save.height)<1&&Math.abs(name.top-save.top)<1,nameButtonWidthMatchesHistory:Math.abs(save.width-newChat.width)<1,editorButtonsEqual:[...document.querySelectorAll('.persona-editor-actions')].every(row=>{const boxes=[...row.querySelectorAll('button')].map(e=>e.getBoundingClientRect());return boxes.every(b=>Math.abs(b.width-boxes[0].width)<1&&Math.abs(b.height-boxes[0].height)<1)}),noHorizontalOverflow:document.querySelector('#settings-tab').scrollWidth<=document.querySelector('#settings-tab').clientWidth};
        for(const d of document.querySelectorAll('details.settings-group'))d.open=false;
        return{width:innerWidth,history,settings};
      })()`);
      if(!Object.values(screens.history).every(Boolean)||!Object.values(screens.settings).every(Boolean))throw Error('Screen alignment regression '+JSON.stringify(screens));
      results.push(screens);
      fs.writeFileSync(path.join(__dirname,'..','artifacts',size.height===740?'ui-refined-settings.png':'ui-refined-settings-compact.png'),(await panel.webContents.capturePage()).toPNG());
    }
    panel.setBounds(original);
    for(const tab of ['history','settings']){
      await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-tab="${tab}"]').click();document.querySelector('#${tab}-tab').scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
      fs.writeFileSync(path.join(__dirname,'..','artifacts',`ui-refined-${tab}.png`),(await panel.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(__dirname,'..','artifacts','ui-layout-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),platform:process.platform,results},null,2));
    console.log('UI_ALIGNMENT_INPUT_AND_COMPACT_OK',JSON.stringify(results));
  }finally{
    panel.setBounds(original);
    await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="chat"]').click()`);
  }
};
