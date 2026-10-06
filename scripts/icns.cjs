const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if(process.platform !== 'darwin')throw new Error('ICNS 변환은 macOS에서 실행합니다.');
const root=path.join(__dirname,'..'), set=path.join(root,'artifacts','OnggiBot.iconset');
fs.mkdirSync(set,{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2]){
  const target=path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`);
  const result=spawnSync('sips',['-z',String(size*scale),String(size*scale),path.join(root,'assets','icon.png'),'--out',target],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr);
}
const result=spawnSync('iconutil',['-c','icns',set,'-o',path.join(root,'assets','icon.icns')],{encoding:'utf8'});
if(result.status!==0)throw new Error(result.stderr);
console.log('ICNS_OK');
