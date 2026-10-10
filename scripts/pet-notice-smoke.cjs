const fs=require('node:fs'),path=require('node:path');
module.exports=async({pet,petNotice,panel,screen})=>{
  const original=pet.getBounds(),results=[];let moved=0,resized=0;
  const onMove=()=>moved++,onResize=()=>resized++;
  try{
    await pet.webContents.executeJavaScript(`window.onggi.action('settings',{reducedMotion:true})`);
    await new Promise(r=>setTimeout(r,120));
    const area=screen.getPrimaryDisplay().bounds;
    for(const point of [{x:area.x+200,y:area.y+200},{x:area.x+area.width-80,y:area.y+10}]){
      pet.setPosition(point.x,point.y);await new Promise(r=>setTimeout(r,100));
      const bounds=pet.getBounds();pet.on('move',onMove);pet.on('resize',onResize);
      const samples=await pet.webContents.executeJavaScript(`(async()=>{
        const positions=[];let collecting=true;
        const sample=()=>{const b=document.querySelector('#pet-character').getBoundingClientRect();positions.push({x:b.x,y:b.y,width:innerWidth,height:innerHeight});if(collecting)requestAnimationFrame(sample);};requestAnimationFrame(sample);
        for(let i=0;i<4;i++){document.querySelector('#pet-bubble').hidden=false;await window.onggi.action('pet-layout',{bubbleVisible:true,controlsVisible:false});await new Promise(r=>setTimeout(r,100));document.querySelector('#pet-bubble').hidden=true;await window.onggi.action('pet-layout',{bubbleVisible:false,controlsVisible:false});await new Promise(r=>setTimeout(r,100));}
        collecting=false;await new Promise(r=>requestAnimationFrame(r));return positions;
      })()`);
      pet.off('move',onMove);pet.off('resize',onResize);
      if(moved||resized||JSON.stringify(pet.getBounds())!==JSON.stringify(bounds)||samples.length<10||samples.some(s=>Math.abs(s.x-samples[0].x)>.1||Math.abs(s.y-samples[0].y)>.1||s.width!==bounds.width||s.height!==bounds.height))throw Error('Character moved during notice transitions '+JSON.stringify({moved,resized,samples}));
      const shown=await pet.webContents.executeJavaScript(`document.querySelector('#pet-bubble').hidden=false;window.onggi.action('pet-layout',{bubbleVisible:true,controlsVisible:false})`);await new Promise(r=>setTimeout(r,100));
      const n=petNotice.getBounds();if(!petNotice.isVisible()||n.x<area.x||n.y<area.y||n.x+n.width>area.x+area.width||n.y+n.height>area.y+area.height)throw Error('Notice escaped the display');
      const visible=await petNotice.webContents.executeJavaScript(`!document.querySelector('#notice-bubble').hidden`);if(!visible)throw Error('Notice label was not rendered');
      const rect=await petNotice.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#notice-bubble').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()`);
      const outside=await petNotice.webContents.executeJavaScript(`window.onggi.action('pet-pointer-sync',{x:${n.x+1},y:${n.y+1}})`),inside=await petNotice.webContents.executeJavaScript(`window.onggi.action('pet-pointer-sync',{x:${n.x+rect.x+rect.width/2},y:${n.y+rect.y+rect.height/2}})`);
      if(!outside.noticeIgnore||inside.noticeIgnore)throw Error('Notice transparent padding blocks clicks');
      panel.hide();await petNotice.webContents.executeJavaScript(`document.querySelector('#notice-bubble').click()`);if(!panel.isVisible())throw Error('Notice click did not open chat');
      let rejected=false;try{await petNotice.webContents.executeJavaScript(`window.onggi.action('settings',{demo:true})`);}catch{rejected=true;}if(!rejected)throw Error('Notice gained unrelated settings access');
      await pet.webContents.executeJavaScript(`document.querySelector('#pet-bubble').hidden=true;window.onggi.action('pet-layout',{bubbleVisible:false,controlsVisible:false})`);if(petNotice.isVisible())throw Error('Notice remained visible');
      results.push({bounds,notice:shown.noticeBounds,frames:samples.length,moved,resized});
    }
    pet.setBounds(original);await pet.webContents.executeJavaScript(`window.onggi.action('settings',{reducedMotion:false})`);
    fs.writeFileSync(path.join(__dirname,'..','artifacts','pet-notice-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),platform:process.platform,status:'passed',results,noticeAccessRestricted:true},null,2));
    console.log('PET_NOTICE_FIXED_CHARACTER_FRAMES_OK',JSON.stringify(results));
  }finally{pet.off('move',onMove);pet.off('resize',onResize);}
};
