const {BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({app,pet,screen,petAnchor,getIgnoring}) => {
  const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
  const area = screen.getPrimaryDisplay().workArea;
  const x = Math.round(area.x + area.width / 2 - 220), y = area.y + 100;
  const underlay = new BrowserWindow({x,y,width:440,height:300,frame:false,resizable:false,title:'옹기봇 클릭 통과 검증',acceptFirstMouse:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  let click;
  underlay.webContents.on('console-message',details => {
    if(!details.message.startsWith('NATIVE_TRANSPARENT_CLICK '))return;
    const cursor = JSON.parse(details.message.slice('NATIVE_TRANSPARENT_CLICK '.length)), bounds = pet.getBounds();
    click = {cursor,relative:{x:cursor.x-bounds.x,y:cursor.y-bounds.y},ignoring:getIgnoring()};
  });
  await underlay.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><html lang="ko"><title>옹기봇 클릭 통과 검증</title><style>body{margin:0;background:#e7edf4;color:#35414b;font:14px -apple-system,sans-serif;padding:18px}h3{margin:0 0 12px}p{max-width:380px;line-height:1.6}button{position:absolute;left:101px;top:89px;width:16px;height:28px;background:#f29542;border:0;border-radius:3px}#count{position:absolute;left:18px;bottom:18px}</style><h3>옹기봇 클릭 통과 검증</h3><p>주황 버튼은 캐릭터 창의 투명 여백 뒤에 있습니다.<br>주황 버튼을 클릭하면 검증 후 자동으로 종료합니다.</p><button aria-label="투명 여백 뒤 테스트 버튼" onclick="window.clickedCount=(window.clickedCount||0)+1;document.querySelector('#count').textContent='클릭 통과: '+window.clickedCount;console.log('NATIVE_TRANSPARENT_CLICK '+JSON.stringify({x:event.screenX,y:event.screenY}))"></button><p id="count">클릭 통과: 0</p></html>`));
  underlay.show();underlay.focus();
  await new Promise(r=>setTimeout(r,3500));
  pet.setBounds({x:x+100,y:y+50,width:120,height:143});Object.assign(petAnchor,{x:x+160,y:y+193});pet.showInactive();
  const initial = pet.getBounds();
  console.log('PET_NATIVE_VERIFICATION_READY',JSON.stringify({initial,underlay:underlay.getBounds()}));
  const deadline = Date.now()+240000;
  const timer = setInterval(()=>{
    const bounds = pet.getBounds();
    if(click?.ignoring && click.relative.x>=0 && click.relative.x<18){
      clearInterval(timer);
      const result = {verifiedAt:new Date().toISOString(),status:'passed',click,initial,bounds};
      fs.writeFileSync(path.join(artifactRoot,'pet-native-pointer-smoke.json'),JSON.stringify(result,null,2));
      console.log('PET_NATIVE_CLICK_THROUGH_OK',JSON.stringify(result));app.quit();
    }else if(Date.now()>deadline){clearInterval(timer);console.error('PET_NATIVE_VERIFICATION_TIMEOUT',JSON.stringify({click,initial,bounds}));app.exit(1);}
  },200);
};
