const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({app,pet,petNotice,panel,store,codex,powerMonitor,dialog,publish,getRuntime})=>{
  const originalDialog=dialog.showOpenDialog;
  const act=(action,payload={})=>panel.webContents.executeJavaScript(`window.onggi.action(${JSON.stringify(action)},${JSON.stringify(payload)})`);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const results={verifiedAt:new Date().toISOString(),platform:process.platform,realModel:false,windowsNativeVerified:process.platform==='win32'};
  try{
    if(process.argv.includes('--no-pack-fixture')){
      await act('show-panel',{tab:'settings',full:true});await wait(150);assert.equal(store.data.settings.characterId,'onggi-clip');assert.ok((await panel.webContents.executeJavaScript(`document.querySelector('[data-character="onggi-clip"]').disabled`)));
      await assert.rejects(act('send',{text:'must not run'}),/복구/);assert.equal(store.data.messages.length,0);
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(__dirname,'../characters/onggi-clip')]});const preview=await act('pack-preview');await act('pack-apply',{token:preview.token,select:true});await wait(150);
      assert.equal(store.data.settings.characterId,'onggi-clip');assert.ok(fs.existsSync(path.join(store.directory,'characters/onggi-clip/manifest.json')));assert.equal(await panel.webContents.executeJavaScript(`document.querySelector('[data-character="onggi-clip"]').disabled`),false);
      await assert.rejects(act('pack-remove',{id:'onggi-clip',confirmed:true}),/하나 더/);assert.equal(store.data.messages.length,0);
      fs.writeFileSync(path.join(__dirname,'../artifacts/buddy-zero-pack-smoke.json'),JSON.stringify({at:new Date().toISOString(),passed:true,placeholder:true,originalSelectionPreserved:true,noModelCall:true,settingsAccessible:true,sameIdReinstall:true,lastValidPackPreserved:true}));console.log('ZERO_PACK_RECOVERY_UI_OK');app.quit();return;
    }
    await act('settings',{chatMode:'panel',appearanceProfile:'custom',reducedMotion:false,characterScale:.5});
    await panel.webContents.executeJavaScript(`window.buddyPackets=[];window.onggi.onState(s=>window.buddyPackets.push({catalog:s.packs?.map(p=>({id:p.id,hasAssets:Boolean(p.assets),thumbnail:Boolean(p.thumbnail)})),active:s.characterPack?.id,bytes:JSON.stringify(s).length}));`);
    await act('sync');await wait(150);
    const packets=await panel.webContents.executeJavaScript('window.buddyPackets');assert.ok(packets.some(p=>p.catalog?.every(e=>!e.hasAssets&&e.thumbnail)));assert.ok(packets.some(p=>p.active==='onggi-clip'));results.activeAssetContract=true;
    await act('select-character',{id:'onggi-clip-blink'});await act('settings',{appearanceProfile:'lively'});await wait(250);
    const bounds=pet.getBounds(),saved=store.snapshot,initial=await pet.webContents.executeJavaScript(`({animating:document.querySelector('#pet-image').dataset.animating,changes:Number(document.querySelector('#pet-image').dataset.frameChanges??0)})`);
    assert.equal(initial.animating,'true');await wait(4300);
    const changes=await pet.webContents.executeJavaScript(`Number(document.querySelector('#pet-image').dataset.frameChanges)`);assert.ok(changes>initial.changes);assert.deepEqual(pet.getBounds(),bounds);assert.equal(store.snapshot,saved);
    pet.hide();await wait(150);const hiddenChanges=await pet.webContents.executeJavaScript(`Number(document.querySelector('#pet-image').dataset.frameChanges)`);await wait(300);assert.equal(await pet.webContents.executeJavaScript(`Number(document.querySelector('#pet-image').dataset.frameChanges)`),hiddenChanges);pet.showInactive();await wait(150);
    powerMonitor.emit('lock-screen');await wait(150);assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('#pet-image').dataset.animating`),'false');assert.equal(petNotice.isVisible(),false);
    powerMonitor.emit('unlock-screen');await wait(150);assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('#pet-image').dataset.animating`),'true');
    await act('settings',{batterySaver:true});powerMonitor.emit('on-battery');await wait(150);assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('#pet-image').dataset.animating`),'false');powerMonitor.emit('on-ac');await wait(150);
    const anchor={x:pet.getBounds().x+pet.getBounds().width/2,y:pet.getBounds().y+pet.getBounds().height},scales=[];
    for(const scale of [.35,.65,.5]){await act('settings',{characterScale:scale});await wait(200);const box=pet.getBounds(),image=await pet.webContents.executeJavaScript(`(()=>{const r=getComputedStyle(document.querySelector('#pet-character'));return{width:parseFloat(r.width),height:parseFloat(r.height)};})()`);assert.ok(Math.abs(image.width-150*scale)<.1&&Math.abs(image.height-190*scale)<.1);assert.ok(Math.abs(box.x+box.width/2-anchor.x)<=.5&&Math.abs(box.y+box.height-anchor.y)<=.5);scales.push({scale,box,image});}
    results.animation={frameChanges:changes-initial.changes,fixedBounds:true,noFrameSave:true,hiddenPaused:true,lockPaused:true,batteryPaused:true};results.scales=scales;
    await act('settings',{appearanceProfile:'quiet'});await wait(150);assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('#pet-bubble').hidden`),true);
    await act('send',{text:'절전 중단 검사'});await act('send',{text:'대기 질문 보존'});await act('sleep');
    codex.emit('request',{id:'synthetic-approval',method:'item/commandExecution/requestApproval',params:{itemId:'own-test'}});await wait(100);assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('#pet-character').dataset.state`),'attention');
    powerMonitor.emit('suspend');await wait(180);assert.equal(getRuntime().systemSuspended,true);assert.equal(getRuntime().queuePaused,true);assert.ok(getRuntime().queue.length>=1);
    await assert.rejects(act('send',{text:'절전 중 차단'}),/절전/);powerMonitor.emit('resume');await wait(500);assert.equal(getRuntime().current,null);assert.ok(getRuntime().queue.length>=1);assert.equal(getRuntime().queuePaused,true);
    await act('continue-queue');let deadline=Date.now()+8000;while(Date.now()<deadline&&(getRuntime().current||getRuntime().queue.length))await wait(40);assert.equal(getRuntime().current,null);assert.equal(getRuntime().queue.length,0);assert.equal(store.data.messages.at(-1).status,'completed');
    results.systemPolicy={approvalAboveSleep:true,suspendInterrupted:true,queuePreserved:true,noAutoReplay:true,manualContinue:true};
    const characterId='onggi-clip',clone=await act('persona-manage',{characterId,operation:'clone',id:'concise',name:'테스트 말투'});assert.ok(clone.ok);
    const registry=JSON.parse(fs.readFileSync(path.join(store.directory,'personas',characterId,'modes.json'))),modeId=registry.modes.at(-1).id;
    await act('persona-manage',{characterId,operation:'rename',id:modeId,name:'바뀐 말투'});await act('persona-manage',{characterId,operation:'archive',id:modeId});await act('persona-manage',{characterId,operation:'unarchive',id:modeId});
    await act('persona-settings',{characterId,mode:modeId});await assert.rejects(act('persona-manage',{characterId,operation:'archive',id:modeId}),/다른 말투/);await act('persona-settings',{characterId,mode:'friendly'});results.modeManagement=true;
    const source=path.join(store.directory,'candidate-source');fs.cpSync(path.join(__dirname,'../characters/onggi-sprout'),source,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));manifest.id='smoke-custom';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});const before=store.data.settings.characterId;
    await panel.webContents.executeJavaScript(`document.querySelector('#import-pack').click()`);let previewDeadline=Date.now()+5000,previewOpen=false;while(Date.now()<previewDeadline&&!previewOpen){previewOpen=await panel.webContents.executeJavaScript(`document.querySelector('#pack-preview-dialog').open`);if(!previewOpen)await wait(25);}assert.ok(previewOpen);await wait(100);
    const previewImages=await panel.webContents.executeJavaScript(`[...document.querySelectorAll('.pack-preview-images img')].every(i=>i.complete&&i.naturalWidth===96)`);assert.ok(previewImages);fs.writeFileSync(path.join(__dirname,'../artifacts/buddy-lifecycle-preview.png'),(await panel.webContents.capturePage()).toPNG());await panel.webContents.executeJavaScript(`document.querySelector('#pack-preview-cancel').click()`);await wait(100);assert.equal(store.data.settings.characterId,before);
    const preview=await act('pack-preview');assert.equal(store.data.settings.characterId,before);assert.ok(!fs.existsSync(path.join(store.directory,'characters/smoke-custom')));
    fs.writeFileSync(path.join(source,'idle.svg'),'changed after preview');await act('pack-apply',{token:preview.token,select:true});assert.equal(store.data.settings.characterId,'smoke-custom');assert.ok(fs.readFileSync(path.join(store.directory,'characters/smoke-custom/idle.svg'),'utf8').includes('<svg'));
    fs.copyFileSync(path.join(__dirname,'../characters/onggi-sprout/idle.svg'),path.join(source,'idle.svg'));manifest.version='2.0.0';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
    await act('persona-save',{characterId:'smoke-custom',id:'friendly',text:'# 내 수정본\n보존한다.'});const next=await act('pack-preview');await assert.rejects(act('pack-apply',{token:next.token}),/업데이트/);await act('pack-apply',{token:next.token,replace:true});assert.equal(fs.readFileSync(path.join(store.directory,'personas/smoke-custom/friendly.md'),'utf8'),'# 내 수정본\n보존한다.');
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[store.directory]});const exported=await act('pack-export',{id:'smoke-custom',includeEdited:true});assert.ok(fs.existsSync(path.join(exported.destination,'manifest.json')));assert.ok(!fs.existsSync(path.join(exported.destination,'state.json')));
    await act('pack-remove',{id:'smoke-custom',confirmed:true});assert.equal(store.data.settings.characterId,'onggi-clip');assert.ok(fs.existsSync(path.join(store.directory,'personas/smoke-custom/friendly.md')));
    const archive=fs.readdirSync(store.directory).filter(n=>n.startsWith('.archive-')).find(n=>JSON.parse(fs.readFileSync(path.join(store.directory,n,'manifest.json'))).version==='2.0.0');
    const restore=await act('pack-preview',{archiveToken:archive});await act('pack-apply',{token:restore.token,select:true});results.packLifecycle={previewNoMutation:true,immutableCandidate:true,updatePreservesMd:true,removeArchives:true,restore:true,exportNoProfile:true};
    await act('show-panel',{tab:'settings',full:true});await wait(200);await panel.webContents.executeJavaScript(`document.querySelector('.persona-settings').open=true;document.querySelector('#settings-tab').scrollTop=0`);
    fs.writeFileSync(path.join(__dirname,'../artifacts/buddy-lifecycle-settings.png'),(await panel.webContents.capturePage()).toPNG());
    for(const section of ['pack-settings','persona-settings']){await panel.webContents.executeJavaScript(`(()=>{const d=document.querySelector('.${section}');d.open=true;d.scrollIntoView({block:'start'});})()`);await wait(100);fs.writeFileSync(path.join(__dirname,'../artifacts/buddy-lifecycle-'+section+'.png'),(await panel.webContents.capturePage()).toPNG());}
    await store.saveAsync();publish(true);fs.writeFileSync(path.join(__dirname,'../artifacts/buddy-lifecycle-smoke.json'),JSON.stringify({...results,status:'passed'},null,2));console.log('BUDDY_LIFECYCLE_ANIMATION_SYSTEM_AND_SCALE_OK');app.quit();
  }catch(error){console.error(error.stack);app.exit(1);}finally{dialog.showOpenDialog=originalDialog;}
};
