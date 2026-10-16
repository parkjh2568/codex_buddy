const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {nativeImage,screen}=require('electron');
const {Store}=require('../src/store.cjs');

module.exports=async({app,pet,panel,store,codex,dialog,responseImages,publish,showPanel,getState})=>{
  const out=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'../artifacts/chat-ui-smoke'));
  const picker=dialog.showOpenDialog;let selected=[],pickerCalls=0;
  const results={realModel:false,realAuthentication:false,realSystemPicker:false,physicalMouseOrIme:false,actualElectron:true,actualThirtySecondWait:false};
  fs.mkdirSync(out,{recursive:true});
  dialog.showOpenDialog=async()=>{pickerCalls++;return{canceled:selected.length===0,filePaths:selected};};
  try{
    await panel.webContents.executeJavaScript(`window.__chatUiState=null;window.onggi.onState(next=>{window.__chatUiState=next;});window.onggi.action('sync',{includeCatalog:false});`);
    await panel.webContents.executeJavaScript(`(async()=>{await window.onggi.action('settings',{chatMode:'bubble',measureResponseTime:false,reducedMotion:true});await window.onggi.action('show-panel',{tab:'chat'});const deadline=Date.now()+5000;while(!window.__chatUiState?.compactMode){if(Date.now()>deadline)throw Error('Initial simple mode timed out');await new Promise(r=>setTimeout(r,20));}})()`);
    const initial=await panel.webContents.executeJavaScript(`(()=>{const input=document.querySelector('#prompt'),composer=document.querySelector('#composer'),menu=document.querySelector('#composer-popover'),toggle=document.querySelector('#composer-menu-toggle');return{compact:document.body.classList.contains('compact-mode'),cards:document.querySelectorAll('.message').length,inputEnabled:!input.disabled,composerFits:composer.getBoundingClientRect().bottom<=innerHeight,menuClosed:!menu.matches(':popover-open'),menuRole:menu.getAttribute('role'),named:Boolean(toggle.getAttribute('aria-label')),deadline:window.__chatUiState.simpleHideDeadline};})()`);
    assert.equal(initial.compact,true);assert.equal(initial.cards,0);assert.equal(initial.inputEnabled,true);assert.equal(initial.composerFits,true);assert.equal(initial.menuClosed,true);assert.equal(initial.menuRole,'dialog');assert.equal(initial.named,true);assert.equal(initial.deadline,null);results.initial=initial;
    if(process.env.ONGGI_CHAT_UI_RESIZE_ONLY==='1'){
      showPanel('chat',true);await new Promise(r=>setTimeout(r,160));const area=screen.getDisplayMatching(panel.getBounds()).workArea,probes=[];
      const baseline={x:area.x+48,y:area.y+48,width:Math.min(600,area.width-96),height:Math.min(700,area.height-96)};
      for(const corner of ['nw','ne','sw','se']){
        panel.setBounds(baseline);await new Promise(r=>setTimeout(r,100));
        const before=panel.getBounds(),point=await panel.webContents.executeJavaScript(`(()=>{window.__resizeProbe=[];const handle=document.querySelector('#resize-${corner}');for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,event=>window.__resizeProbe.push({type,screenX:event.screenX,screenY:event.screenY,clientX:event.clientX,clientY:event.clientY,buttons:event.buttons,trusted:event.isTrusted,pointerId:event.pointerId,captured:handle.hasPointerCapture(event.pointerId)}));const r=handle.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),screenX:window.screenX,screenY:window.screenY};})()`);
        panel.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});await new Promise(r=>setTimeout(r,100));const session=getState().panelResize;
        const next={x:point.x+(corner.includes('e')?12:-12),y:point.y+(corner.includes('s')?12:-12)};panel.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],...next});await new Promise(r=>setTimeout(r,140));
        const during=panel.getBounds();panel.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...next});await new Promise(r=>setTimeout(r,100));
        probes.push({corner,before,point,session:session?{x:session.x,y:session.y,bounds:session.bounds,area:session.area}:null,during,after:panel.getBounds(),ended:getState().panelResize===null,events:await panel.webContents.executeJavaScript(`window.__resizeProbe`)});
      }
      fs.writeFileSync(path.join(out,'chat-ui-resize-probe.json'),JSON.stringify({diagnostic:true,actualElectron:true,physicalOsMouse:false,area,baseline,probes},null,2));console.log('CHAT_UI_RESIZE_PROBE',JSON.stringify(probes));dialog.showOpenDialog=picker;app.quit();return;
    }
    const menu=await panel.webContents.executeJavaScript(`(async()=>{document.querySelector('#composer-menu-toggle').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const popup=document.querySelector('#composer-popover'),box=popup.getBoundingClientRect(),buttons=[...popup.querySelectorAll('button')];return{open:popup.matches(':popover-open'),expanded:document.querySelector('#composer-menu-toggle').getAttribute('aria-expanded'),withinWindow:box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight,imageInside:popup.contains(document.querySelector('#attach-image')),fileInside:popup.contains(document.querySelector('#attach-file')),purposeInside:popup.contains(document.querySelector('#task-purpose')),skillInside:popup.contains(document.querySelector('#task-skill')),buttonTypes:buttons.every(button=>button.type==='button')};})()`);
    assert.equal(menu.open,true);assert.equal(menu.expanded,'true');assert.equal(menu.withinWindow,true);assert.equal(menu.imageInside,true);assert.equal(menu.fileInside,true);assert.equal(menu.purposeInside,true);assert.equal(menu.skillInside,true);assert.equal(menu.buttonTypes,true);
    await panel.webContents.executeJavaScript(`window.__chatUiMenuResizeObserved=false;window.addEventListener('resize',()=>{window.__chatUiMenuResizeObserved=true;},{once:true});`);
    const initialMenuBounds=panel.getBounds();panel.setSize(initialMenuBounds.width,initialMenuBounds.height+2);
    const resizedMenu=await panel.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+5000;while(!window.__chatUiMenuResizeObserved){if(Date.now()>deadline)throw Error('Actual popup resize event did not arrive');await new Promise(r=>requestAnimationFrame(r));}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const popup=document.querySelector('#composer-popover'),box=popup.getBoundingClientRect();return{open:popup.matches(':popover-open'),expanded:document.querySelector('#composer-menu-toggle').getAttribute('aria-expanded'),withinWindow:box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight};})()`);
    assert.equal(resizedMenu.open,true);assert.equal(resizedMenu.expanded,'true');assert.equal(resizedMenu.withinWindow,true);
    panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});panel.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await new Promise(r=>setTimeout(r,120));
    assert.equal(panel.isVisible(),true);assert.equal(await panel.webContents.executeJavaScript(`!document.querySelector('#composer-popover').matches(':popover-open')&&document.activeElement===document.querySelector('#composer-menu-toggle')`),true);
    const beforeCancel=store.data.messages.length;
    await panel.webContents.executeJavaScript(`document.querySelector('#composer-menu-toggle').click();document.querySelector('#attach-file').click();`);
    let deadline=Date.now()+5000;while(Date.now()<deadline&&!pickerCalls)await new Promise(r=>setTimeout(r,20));assert.equal(pickerCalls,1);assert.equal(store.data.messages.length,beforeCancel);
    assert.equal(await panel.webContents.executeJavaScript(`!document.querySelector('#composer-popover').matches(':popover-open')&&document.querySelectorAll('.attachment-chip').length===0`),true);
    results.menu={...menu,nativeResizePreservesPopover:true,nativeEscapeClosesPopoverBeforePanel:true,pickerCanceledWithoutSubmission:true};

    const file=path.join(store.directory,'chat-ui-attachment.txt');fs.writeFileSync(file,'CHAT_UI_SNAPSHOT');selected=[file];
    await panel.webContents.executeJavaScript(`document.querySelector('#composer-menu-toggle').click();document.querySelector('#attach-file').click();`);
    deadline=Date.now()+5000;while(Date.now()<deadline&&!await panel.webContents.executeJavaScript(`document.querySelectorAll('.attachment-chip').length===1&&!document.querySelector('#send').disabled`))await new Promise(r=>setTimeout(r,20));
    assert.equal(await panel.webContents.executeJavaScript(`document.querySelectorAll('.attachment-chip').length`),1);
    await panel.webContents.executeJavaScript(`document.querySelector('#prompt').value='첫 번째 UI 첨부 질문';document.querySelector('#prompt').dispatchEvent(new Event('input'));document.querySelector('#composer').requestSubmit();`);
    deadline=Date.now()+10000;while(Date.now()<deadline&&!store.data.messages.some(message=>message.role==='assistant'&&message.status==='running'))await new Promise(r=>setTimeout(r,20));assert.ok(store.data.messages.some(message=>message.role==='assistant'&&message.status==='running'));
    for(const text of ['두 번째 UI 질문','세 번째 UI 질문'])await panel.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+5000;while(document.querySelector('#send').disabled){if(Date.now()>deadline)throw Error('FIFO composer stayed disabled');await new Promise(r=>setTimeout(r,10));}const input=document.querySelector('#prompt');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input'));document.querySelector('#composer').requestSubmit();})()`);
    await panel.webContents.executeJavaScript(`document.querySelector('#prompt').value='다음 질문 초안 유지';document.querySelector('#prompt').dispatchEvent(new Event('input'));`);
    deadline=Date.now()+20000;while(Date.now()<deadline&&(store.data.messages.length<6||store.data.messages.some(message=>['queued','running'].includes(message.status))||store.saving))await new Promise(r=>setTimeout(r,30));
    assert.equal(store.data.messages.length,6);assert.deepEqual(store.data.messages.filter(message=>message.role==='user').map(message=>message.text),['첫 번째 UI 첨부 질문','두 번째 UI 질문','세 번째 UI 질문']);assert.equal(store.data.messages[0].attachments.length,1);assert.equal(store.data.messages.every(message=>message.status==='completed'),true);assert.equal(store.data.messages.every(message=>message.timing===undefined),true);
    const completed=store.data.messages.at(-1);
    const fifo=await panel.webContents.executeJavaScript(`(()=>{const cards=[...document.querySelectorAll('.message')];return{draft:document.querySelector('#prompt').value,cards:cards.length,assistantOnly:cards.every(card=>card.classList.contains('assistant')),replyId:window.__chatUiState.simpleReplyId,protected:window.__chatUiState.simpleProtected,deadline:window.__chatUiState.simpleHideDeadline};})()`);
    assert.equal(fifo.draft,'다음 질문 초안 유지');assert.equal(fifo.cards,1);assert.equal(fifo.assistantOnly,true);assert.equal(fifo.replyId,completed.id);assert.equal(fifo.protected,true);assert.equal(fifo.deadline,null);results.fifo={...fifo,ordered:true,attachmentSnapshot:true,timingOptionOff:true};
    await panel.webContents.executeJavaScript(`document.querySelector('#close-mini').click()`);deadline=Date.now()+5000;while(Date.now()<deadline&&panel.isVisible())await new Promise(r=>setTimeout(r,20));assert.equal(panel.isVisible(),false);
    const petPoint=await pet.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#pet-character').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    pet.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...petPoint});await new Promise(r=>setTimeout(r,120));pet.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...petPoint});
    deadline=Date.now()+5000;while(Date.now()<deadline&&!panel.isVisible())await new Promise(r=>setTimeout(r,20));assert.equal(panel.isVisible(),true);
    assert.equal(await panel.webContents.executeJavaScript(`document.querySelector('#prompt').value`),'다음 질문 초안 유지');
    await panel.webContents.executeJavaScript(`document.querySelector('#prompt').value='';document.querySelector('#prompt').dispatchEvent(new Event('input'));document.querySelector('#prompt').dispatchEvent(new CompositionEvent('compositionstart',{data:'ㅎ',bubbles:true}));`);
    await new Promise(r=>setTimeout(r,180));assert.equal(getState().simpleHideDeadline,null);
    await panel.webContents.executeJavaScript(`document.querySelector('#prompt').dispatchEvent(new CompositionEvent('compositionend',{data:'',bubbles:true}));`);
    results.protection={draftPreservedAcrossXAndBuddyClick:true,syntheticImePausesDeadline:true};

    const red=Buffer.alloc(128*96*4),blue=Buffer.alloc(128*96*4);for(let index=0;index<red.length;index+=4){red[index]=255;red[index+3]=255;blue[index+2]=255;blue[index+3]=255;}
    const firstPng=nativeImage.createFromBitmap(red,{width:128,height:96}).toPNG();
    const secondPng=nativeImage.createFromBitmap(blue,{width:128,height:96}).toPNG();
    const [image1]=await responseImages.capture({id:'chat-ui-image-1',type:'imageGeneration',status:'completed',result:firstPng.toString('base64')});
    const [image2]=await responseImages.capture({id:'chat-ui-image-2',type:'imageGeneration',status:'completed',result:secondPng.toString('base64')});assert.equal(image1.status,'ready');assert.equal(image2.status,'ready');
    const imageReply={id:'chat-ui-images',role:'assistant',text:'',mode:'demo',status:'completed',createdAt:Date.now(),images:[image1,{itemId:'chat-ui-image-2',status:'pending'}]};store.data.messages.push(imageReply);await store.saveAsync();publish(true);
    deadline=Date.now()+5000;while(Date.now()<deadline&&!await panel.webContents.executeJavaScript(`window.__chatUiState.simpleReplyId==='chat-ui-images'&&document.querySelector('.message-images img')?.naturalWidth>0`))await new Promise(r=>setTimeout(r,20));
    assert.equal(getState().simpleHideDeadline,null);
    const oldGeneration=await panel.webContents.executeJavaScript(`window.__chatUiState.simpleDisplayGeneration`);
    const stale=await panel.webContents.executeJavaScript(`window.onggi.action('simple-state',{conversationId:window.__chatUiState.activeConversationId,generation:window.__chatUiState.simpleDisplayGeneration-1,replyId:'chat-ui-images',ready:true,protected:false})`);assert.equal(stale.ok,false);assert.equal(getState().simpleHideDeadline,null);
    imageReply.images=[image1,image2];await store.saveAsync();publish(true);
    deadline=Date.now()+10000;while(Date.now()<deadline&&!await panel.webContents.executeJavaScript(`(()=>{const images=[...document.querySelectorAll('.message-images img')];return images.length===2&&images.every(image=>image.complete&&image.naturalWidth>0)&&window.__chatUiState.simpleHideDeadline>Date.now();})()`))await new Promise(r=>setTimeout(r,20));
    assert.ok(getState().simpleHideDeadline>Date.now());assert.equal(await panel.webContents.executeJavaScript(`document.querySelectorAll('.message.user').length`),0);
    results.images={actualPreviewDecode:2,pendingSecondImagePreventsDeadline:true,imageOnlyAnswer:true,staleGenerationRejected:true,generation:oldGeneration};
    fs.writeFileSync(path.join(out,'chat-ui-simple-images.png'),(await panel.webContents.capturePage()).toPNG());
    await panel.webContents.executeJavaScript(`document.querySelector('#composer-menu-toggle').click()`);await new Promise(r=>setTimeout(r,160));assert.equal(getState().simpleHideDeadline,null);
    await panel.webContents.executeJavaScript(`document.querySelector('#composer-menu-toggle').click()`);
    deadline=Date.now()+5000;while(Date.now()<deadline&&!getState().simpleHideDeadline)await new Promise(r=>setTimeout(r,20));const hideAt=getState().simpleHideDeadline;assert.ok(hideAt-Date.now()>29000&&hideAt-Date.now()<=30000);
    await panel.webContents.executeJavaScript(`window.onggi.action('sync',{includeCatalog:false})`);await new Promise(r=>setTimeout(r,180));assert.equal(getState().simpleHideDeadline,hideAt);
    while(Date.now()<hideAt-250)await new Promise(r=>setTimeout(r,Math.min(500,hideAt-250-Date.now())));assert.equal(panel.isVisible(),true);
    deadline=hideAt+3000;while(Date.now()<deadline&&panel.isVisible())await new Promise(r=>setTimeout(r,20));assert.equal(panel.isVisible(),false);
    results.actualThirtySecondWait=true;results.autoHide={deadline:hideAt,observedHiddenAt:Date.now(),panelVisibleBeforeDeadline:true,normalSyncDoesNotExtend:true};
    pet.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...petPoint});await new Promise(r=>setTimeout(r,120));pet.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...petPoint});
    deadline=Date.now()+5000;while(Date.now()<deadline&&(!panel.isVisible()||!getState().simpleHideDeadline))await new Promise(r=>setTimeout(r,20));assert.equal(panel.isVisible(),true);assert.ok(getState().simpleHideDeadline>hideAt);
    await panel.webContents.executeJavaScript(`document.querySelector('#close-mini').click()`);deadline=Date.now()+5000;while(Date.now()<deadline&&panel.isVisible())await new Promise(r=>setTimeout(r,20));assert.equal(panel.isVisible(),false);assert.equal(getState().simpleHideDeadline,null);
    results.protection.popupPausesDeadline=true;results.autoHide.buddyReopenCreatesNewLifetime=true;results.autoHide.xCancelsDeadline=true;

    showPanel('chat',true);await new Promise(r=>setTimeout(r,160));
    const resize=[];
    for(const corner of ['nw','ne','sw','se']){
      const before=panel.getBounds(),x=before.x+(corner.includes('e')?before.width:0),y=before.y+(corner.includes('s')?before.height:0);
      const start=await panel.webContents.executeJavaScript(`window.onggi.action('resize-start',{corner:${JSON.stringify(corner)},x:${x},y:${y}})`);assert.equal(start.ok,true);assert.ok(start.token);
      const moved=await panel.webContents.executeJavaScript(`window.onggi.action('resize-move',{token:${JSON.stringify(start.token)},x:${x+(corner.includes('e')?20:-20)},y:${y+(corner.includes('s')?20:-20)}})`);assert.equal(moved.ok,true);
      await panel.webContents.executeJavaScript(`window.onggi.action('resize-end',{token:${JSON.stringify(start.token)}})`);const after=panel.getBounds();assert.ok(after.width>=before.width);assert.ok(after.height>=before.height);assert.ok(after.width>before.width||after.height>before.height);
      const late=await panel.webContents.executeJavaScript(`window.onggi.action('resize-move',{token:${JSON.stringify(start.token)},x:100,y:100})`);assert.equal(late.ok,false);assert.deepEqual(panel.getBounds(),after);
      resize.push({corner,before,after,lateMoveRejected:true});
    }
    const chromiumCorners=[];
    for(const corner of ['nw','ne','sw','se']){
      const before=panel.getBounds(),point=await panel.webContents.executeJavaScript(`(()=>{const handle=document.querySelector('#resize-${corner}');window.__cornerEvents=[];for(const type of ['pointerdown','pointermove'])handle.addEventListener(type,event=>window.__cornerEvents.push({type,screenX:event.screenX,screenY:event.screenY,clientX:event.clientX,clientY:event.clientY,captured:handle.hasPointerCapture(event.pointerId)}));const r=handle.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
      panel.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});await new Promise(r=>setTimeout(r,100));assert.ok(getState().panelResize);
      const next={x:point.x+(corner.includes('e')?12:-12),y:point.y+(corner.includes('s')?12:-12)};
      panel.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],...next});await new Promise(r=>setTimeout(r,140));
      panel.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...next});await new Promise(r=>setTimeout(r,100));
      const after=panel.getBounds(),events=await panel.webContents.executeJavaScript(`window.__cornerEvents`);assert.equal(getState().panelResize,null);
      const down=events.find(event=>event.type==='pointerdown'),move=events.find(event=>event.type==='pointermove'),globalCoordinatesUnavailable=Boolean(down&&move&&down.screenX===0&&down.screenY===0&&move.screenX===0&&move.screenY===0&&(down.clientX!==move.clientX||down.clientY!==move.clientY));
      assert.ok(down?.captured&&move?.captured);if(globalCoordinatesUnavailable)assert.deepEqual(after,before);else assert.ok(after.width>before.width||after.height>before.height);
      chromiumCorners.push({corner,before,after,pointerSessionEnded:true,globalCoordinatesUnavailable,events,geometryVerified:!globalCoordinatesUnavailable});
    }
    const detail=panel.getBounds();await panel.webContents.executeJavaScript(`window.onggi.action('show-panel',{tab:'settings'})`);assert.deepEqual(panel.getBounds(),detail);
    await panel.webContents.executeJavaScript(`window.onggi.action('show-panel',{tab:'chat'})`);await new Promise(r=>setTimeout(r,100));
    const forbidden=await panel.webContents.executeJavaScript(`window.onggi.action('resize-start',{corner:'se',x:1,y:1})`);assert.equal(forbidden.ok,false);
    await panel.webContents.executeJavaScript(`window.onggi.action('show-panel',{tab:'chat',full:true})`);assert.deepEqual(panel.getBounds(),detail);
    results.resize={syntheticAuthorizedCornerIpc:resize,chromiumCornerPointerEvents:chromiumCorners,physicalDragging:false,detailBoundsRetained:true,miniResizeRejected:true};
    const persisted=new Store(store.directory,{});assert.equal(persisted.data.messages.length,store.data.messages.length);assert.equal(persisted.data.messages.at(-1).images.length,2);assert.equal(persisted.data.settings.measureResponseTime,false);
    fs.writeFileSync(path.join(out,'chat-ui-detail.png'),(await panel.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(out,'chat-ui-smoke.json'),JSON.stringify({status:'passed',verifiedAt:new Date().toISOString(),results},null,2));console.log('CHAT_UI_SIMPLE_MENU_LIFETIME_RESIZE_AND_FIFO_OK');
    dialog.showOpenDialog=picker;app.quit();
  }catch(error){dialog.showOpenDialog=picker;console.error('CHAT_UI_SMOKE_FAILED',error.stack);codex.stop();app.exit(1);}
};
