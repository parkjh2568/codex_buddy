const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({app,pet,panel,screen,store,getAnchor,getIgnoring}) => {
  try {
    await new Promise(resolve=>setTimeout(resolve,500));
    const artifact = path.join(__dirname,'..','artifacts','floating-ui-smoke.json');
    const area = screen.getPrimaryDisplay().workArea, display = screen.getPrimaryDisplay().bounds;
    if (process.argv.includes('--verify-floating-restore')) {
      const result=JSON.parse(fs.readFileSync(artifact,'utf8')), anchor=getAnchor();
      if(Math.abs(anchor.x-result.savedPartial.x-result.savedPartial.width/2)>.5||Math.abs(anchor.y-result.savedPartial.y-result.savedPartial.height)>.5)throw new Error('Partially off-screen character position was clamped on restart '+JSON.stringify({anchor,saved:result.savedPartial}));
      result.restartPreserved=true;
      store.data.settings.position={x:90000,y:90000,width:120,height:143};store.save({includeHistory:false});
      fs.writeFileSync(artifact,JSON.stringify(result,null,2));console.log('FLOATING_RESTORE_OK');app.quit();return;
    }
    if (process.argv.includes('--verify-floating-recovery')) {
      const result=JSON.parse(fs.readFileSync(artifact,'utf8')), anchor=getAnchor();
      if(anchor.x<area.x||anchor.x>area.x+area.width||anchor.y<area.y||anchor.y>area.y+area.height)throw new Error('Unreachable saved position was not recovered');
      result.unreachableRestartRecovered=true;
      fs.writeFileSync(artifact,JSON.stringify(result,null,2));console.log('FLOATING_RESTART_RECOVERY_OK');app.quit();return;
    }
    const properties={focusable:pet.isFocusable(),movable:pet.isMovable(),resizable:pet.isResizable(),maximizable:pet.isMaximizable(),minimizable:pet.isMinimizable(),fullscreenable:pet.isFullScreenable(),panelFocusable:panel.isFocusable()};
    if(Object.entries(properties).some(([key,value])=>key==='panelFocusable'?!value:value))throw new Error('Floating window policy failed '+JSON.stringify(properties));
    await pet.webContents.executeJavaScript(`window.onggi.action('settings',{reducedMotion:true})`);
    pet.emit('recover-position',true);await new Promise(resolve=>setTimeout(resolve,150));
    await pet.webContents.executeJavaScript(`window.onggi.action('pet-layout',{bubbleVisible:false,controlsVisible:false})`);
    const initial=pet.getBounds();
    const dragResult=await pet.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('drag-start',{x:400,y:400});
      await window.onggi.action('drag-move',{x:360,y:370});
      await window.onggi.action('drag-move',{x:360,y:370});
      await window.onggi.action('drag-end');return true;
    })()`);
    const moved=pet.getBounds();
    if(!dragResult||moved.x!==initial.x-40||moved.y!==initial.y-30)throw new Error('Programmatic drag or duplicate-coordinate handling failed '+JSON.stringify({initial,moved}));
    await pet.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('drag-start',{x:400,y:400});
      await window.onggi.action('drag-move',{x:${400+display.x-60-moved.x},y:${400+display.y-60-moved.y}});
      await window.onggi.action('drag-end');
    })()`);
    const top=pet.getBounds();
    if(top.x!==display.x-60||top.y!==display.y-60)throw new Error('Top screen boundary still constrains frameless pet '+JSON.stringify(top));
    const partialX=display.x-60,partialY=display.y+display.height-60;
    await pet.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('drag-start',{x:400,y:400});
      await window.onggi.action('drag-move',{x:${400+partialX-top.x},y:${400+partialY-top.y}});
      await window.onggi.action('drag-end');
    })()`);
    const partial=pet.getBounds(),anchorBefore={...getAnchor()};
    if(partial.x!==partialX||partial.y!==partialY)throw new Error('Screen or Dock boundary still clamps drag '+JSON.stringify({partial,partialX,partialY}));
    pet.emit('recover-position');
    if(JSON.stringify(pet.getBounds())!==JSON.stringify(partial))throw new Error('Visible partial position was recovered unnecessarily');
    const bubble=await pet.webContents.executeJavaScript(`window.onggi.action('pet-layout',{bubbleVisible:true,controlsVisible:false})`);
    const expanded=pet.getBounds();
    if(expanded.width!==196||expanded.height!==195||Math.abs(getAnchor().x-anchorBefore.x)>.5||Math.abs(getAnchor().y-anchorBefore.y)>.5||Math.abs(expanded.x+bubble.centerX-anchorBefore.x)>.5||Math.abs(expanded.y+expanded.height-bubble.bottom+35-anchorBefore.y)>.5)throw new Error('Bubble resize moved character anchor');
    await pet.webContents.executeJavaScript(`window.onggi.action('pet-layout',{bubbleVisible:false,controlsVisible:false})`);
    if(JSON.stringify(pet.getBounds())!==JSON.stringify(partial))throw new Error('Bubble shrink clamped or moved pet');
    const beforeExternal={...getAnchor()};pet.setPosition(partial.x+27,partial.y-19);await new Promise(resolve=>setTimeout(resolve,100));
    if(Math.abs(getAnchor().x-beforeExternal.x-27)>.5||Math.abs(getAnchor().y-beforeExternal.y+19)>.5)throw new Error('External window move did not update anchor');
    pet.emit('recover-position',true);await new Promise(resolve=>setTimeout(resolve,150));
    const reset=pet.getBounds();
    const resetAnchor=getAnchor();
    if(resetAnchor.x-37.5<area.x||resetAnchor.x+37.5>area.x+area.width||resetAnchor.y-130<area.y||resetAnchor.y-35>area.y+area.height)throw new Error('Tray reset did not place character on screen '+JSON.stringify({reset,area,anchor:resetAnchor}));
    const hit=await pet.webContents.executeJavaScript(`(async()=>{
      const blank=await window.onggi.action('pet-pointer-sync',{x:${reset.x+5},y:${reset.y+reset.height-5}});
      const body=await window.onggi.action('pet-pointer-sync',{x:${resetAnchor.x},y:${resetAnchor.y-82}});
      return{blankPasses:blank.ignore,bodyReceives:!body.ignore};
    })()`);
    if(!hit.blankPasses||!hit.bodyReceives||getIgnoring())throw new Error('Click-through policy regressed');
    panel.hide();
    await pet.webContents.executeJavaScript(`document.querySelector('#pet-character').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`);
    await new Promise(resolve=>setTimeout(resolve,100));
    if(!panel.isVisible()||!panel.isFocusable())throw new Error('Pet cannot open a focusable chat panel');
    panel.hide();
    const now=pet.getBounds();
    await pet.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('drag-start',{x:400,y:400});
      await window.onggi.action('drag-move',{x:${400+display.x+display.width+200-now.x},y:400});
      await window.onggi.action('drag-end');
    })()`);
    if(pet.getBounds().x<display.x+display.width)throw new Error('Fully off-screen drag was clamped '+JSON.stringify({actual:pet.getBounds(),display,now}));
    pet.emit('recover-position');await new Promise(resolve=>setTimeout(resolve,100));
    if(getAnchor().x>area.x+area.width)throw new Error('Automatic topology recovery failed');
    const restored=pet.getBounds();
    await pet.webContents.executeJavaScript(`(async()=>{
      await window.onggi.action('drag-start',{x:400,y:400});
      await window.onggi.action('drag-move',{x:${400+display.x-60-restored.x},y:400});
      await window.onggi.action('drag-end');
    })()`);
    const savedPartial=pet.getBounds();
    const result={verifiedAt:new Date().toISOString(),platform:process.platform,status:'passed',properties,initial,moved,top,partial,expanded,anchorPreserved:true,externalMoveSynchronized:true,reset,hit,fullyOffScreenAllowed:true,savedPartial,restartPreserved:false,unreachableRestartRecovered:false,windowsNativeVerified:process.platform==='win32'};
    fs.writeFileSync(artifact,JSON.stringify(result,null,2));console.log('FLOATING_UI_OK',JSON.stringify(result));app.quit();
  } catch(error) {console.error(error.stack);app.exit(1);}
};
