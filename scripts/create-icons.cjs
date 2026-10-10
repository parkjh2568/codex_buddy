const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData',path.join(__dirname,'..','artifacts','icon-profile'));
app.whenReady().then(async()=>{
  const window = new BrowserWindow({width:1024,height:1024,show:false,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const assets = path.join(__dirname,'..','assets'); fs.mkdirSync(assets,{recursive:true});
  const source=nativeImage.createFromPath(path.join(assets,'tray-source.png'));
  if(source.isEmpty())throw new Error('아이콘 원본을 읽을 수 없습니다.');
  const {width,height}=source.getSize(),pixels=source.toBitmap();let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  if(right<left)throw new Error('아이콘 원본에 표시할 그림이 없습니다.');
  const artwork=source.crop({x:left,y:top,width:right-left+1,height:bottom-top+1});
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html><body style="margin:0;width:1024px;height:1024px;background:#eaf0dd;border-radius:220px;display:flex;align-items:center;justify-content:center;"><img src="${artwork.toDataURL()}" style="height:800px;width:800px;object-fit:contain"></body></html>`));
  await new Promise(r=>setTimeout(r,100));
  fs.writeFileSync(path.join(assets,'icon.png'),(await window.webContents.capturePage()).resize({width:1024,height:1024}).toPNG());
  const images = [16,32,48,256].map(size => ({size,png:nativeImage.createFromPath(path.join(assets,'icon.png')).resize({width:size,height:size}).toPNG()}));
  const directory = Buffer.alloc(6 + images.length * 16); directory.writeUInt16LE(1,2); directory.writeUInt16LE(images.length,4);
  let offset = directory.length;
  for (let i=0;i<images.length;i++) {
    const entry=6+i*16; directory[entry]=images[i].size===256?0:images[i].size; directory[entry+1]=directory[entry];
    directory.writeUInt16LE(1,entry+4); directory.writeUInt16LE(32,entry+6); directory.writeUInt32LE(images[i].png.length,entry+8); directory.writeUInt32LE(offset,entry+12); offset+=images[i].png.length;
  }
  fs.writeFileSync(path.join(assets,'icon.ico'),Buffer.concat([directory,...images.map(image=>image.png)]));
  fs.writeFileSync(path.join(assets,'tray.png'),artwork.resize({width:18,height:18,quality:'best'}).toPNG());
  fs.writeFileSync(path.join(assets,'tray@2x.png'),artwork.resize({width:36,height:36,quality:'best'}).toPNG());
  fs.writeFileSync(path.join(assets,'brand.png'),artwork.resize({width:128,height:128,quality:'best'}).toPNG());
  const tray=nativeImage.createFromPath(path.join(assets,'tray.png'));
  if(process.platform==='darwin')tray.setTemplateImage(true);
  if(tray.getSize().width!==18||!tray.getScaleFactors().includes(2)||(process.platform==='darwin'&&!tray.isTemplateImage()))throw new Error('메뉴 막대 아이콘 크기·Retina·템플릿 표시를 확인해주세요.');
  console.log('TRAY_ICON_OK',JSON.stringify({size:tray.getSize(),scales:tray.getScaleFactors(),template:tray.isTemplateImage()}));
  console.log('ICON_PNG_OK',JSON.stringify({source:{width,height},visibleBounds:{left,top,right,bottom}})); app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
