const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({app,pet,panel,screen,getDrag}) => {
  let artifactRoot;
  try {
    artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
    fs.writeFileSync(path.join(artifactRoot,'native-floating-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'running'},null,2));
    await new Promise(resolve=>setTimeout(resolve,3500));
    await pet.webContents.executeJavaScript(`window.onggi.action('settings',{reducedMotion:true})`);
    panel.hide();pet.setPosition(450,250);pet.webContents.send('pet-layout-changed');
    let left=null,right=null,focused=0;const expected=pet.getBounds(),maxSize={width:expected.width,height:expected.height};
    const display=screen.getPrimaryDisplay().bounds;
    pet.on('focus',()=>focused++);
    pet.on('resize',()=>{const bounds=pet.getBounds();maxSize.width=Math.max(maxSize.width,bounds.width);maxSize.height=Math.max(maxSize.height,bounds.height);});
    pet.on('move',()=>{
      if(!getDrag())return;
      const bounds=pet.getBounds();
      if(bounds.x<display.x)left=bounds;
      if(bounds.x+bounds.width>display.x+display.width)right=bounds;
    });
    console.log('NATIVE_FLOATING_READY',JSON.stringify({bounds:pet.getBounds(),display}));
    const deadline=Date.now()+240000;
    const timer=setInterval(async()=>{
      try{
        if(left&&right&&panel.isVisible()){
          clearInterval(timer);
          if(focused||maxSize.width>expected.width||maxSize.height>expected.height){throw Error('Native focus or size regression '+JSON.stringify({focused,maxSize}));}
          const result={verifiedAt:new Date().toISOString(),status:'passed',platform:process.platform,nativePointer:true,left,right,focused,maxSize,panelOpened:true,tilingPreviewVerified:false,windowsNativeVerified:process.platform==='win32'};
          fs.writeFileSync(path.join(artifactRoot,'floating-panel.png'),(await panel.webContents.capturePage()).toPNG());
          fs.writeFileSync(path.join(artifactRoot,'native-floating-smoke.json'),JSON.stringify(result,null,2));
          console.log('NATIVE_FLOATING_OK',JSON.stringify(result));app.quit();
        }else if(Date.now()>deadline){clearInterval(timer);throw Error('Native floating review timeout '+JSON.stringify({left,right,focused,maxSize}));}
      }catch(error){clearInterval(timer);try{fs.writeFileSync(path.join(artifactRoot,'native-floating-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'failed',error:error.message},null,2));}catch{}console.error(error.stack);app.exit(1);}
    },250);
  }catch(error){if(artifactRoot){try{fs.writeFileSync(path.join(artifactRoot,'native-floating-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'failed',error:error.message},null,2));}catch{}}console.error(error.stack);app.exit(1);}
};
