const { BrowserWindow } = require('electron');
const path = require('node:path');

class AssetValidator {
  async validate(pack, timeoutMs = 10000,{maxDimension=2048,maxPixels=8388608,thumbnailSize=96}={}) {
    if(![maxDimension,maxPixels,thumbnailSize].every(Number.isSafeInteger)||maxDimension<1||maxDimension>4096||maxPixels<1||maxPixels>16777216||thumbnailSize<1||thumbnailSize>512)throw Error('이미지 검증 한도를 확인해주세요.');
    const window = new BrowserWindow({show:false,width:1,height:1,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'onggi-image-validation'}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    let timer;
    try {
      const decode = (async()=>{
        await window.loadFile(path.join(__dirname,'ui/validate-images.html'));
        return window.webContents.executeJavaScript(`(async()=>{
          const results=[];
          for(const entry of ${JSON.stringify(pack.imageFiles)}) {
            let bitmap,image;
            try {
              if(entry.source.startsWith('data:image/svg+xml;')) {
                const text=new TextDecoder().decode(Uint8Array.from(atob(entry.source.split(',')[1]),c=>c.charCodeAt(0)));
                const parsed=new DOMParser().parseFromString(text,'image/svg+xml');
                if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg'||parsed.documentElement.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('SVG 구문이 올바르지 않습니다.');
                for(const element of parsed.querySelectorAll('*')){
                  if(element.namespaceURI!=='http://www.w3.org/2000/svg'||/^(style|script|foreignobject|iframe|animate.*|set)$/i.test(element.localName))throw Error('SVG의 실행 요소·style은 사용할 수 없습니다.');
                  for(const attribute of element.attributes)if(/^(style|on.*|href|src)$/i.test(attribute.localName)||/url\\s*\\(/i.test(attribute.value))throw Error('SVG의 style·이벤트·참조는 사용할 수 없습니다.');
                }
                image=new Image();image.src=entry.source;await image.decode();
              } else {
                const bytes=Uint8Array.from(atob(entry.source.split(',')[1]),c=>c.charCodeAt(0));
                bitmap=await createImageBitmap(new Blob([bytes],{type:entry.source.slice(5,entry.source.indexOf(';'))}));
              }
              const width=bitmap?.width??image.naturalWidth,height=bitmap?.height??image.naturalHeight;
              if(width<1||height<1||width>${maxDimension}||height>${maxDimension}||(entry.width!==null&&(width!==entry.width||height!==entry.height)))throw Error('이미지 decode 크기가 올바르지 않습니다.');
              let poster,thumbnail,errorThumbnail;
              if(entry.animated){const canvas=document.createElement('canvas'),scale=Math.min(1,512/width,512/height);canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);poster=canvas.toDataURL('image/png');}
              if(entry.file===${JSON.stringify(pack.manifest.states.idle)}){const c=document.createElement('canvas'),size=${thumbnailSize},scale=Math.min(1,size/width,size/height);c.width=Math.max(1,Math.round(width*scale));c.height=Math.max(1,Math.round(height*scale));if(size===96){c.width=96;c.height=96;const s=Math.min(88/width,88/height);c.getContext('2d').drawImage(bitmap??image,(96-width*s)/2,(96-height*s)/2,width*s,height*s);}else c.getContext('2d').drawImage(bitmap??image,0,0,c.width,c.height);thumbnail=c.toDataURL('image/png');}
              if(entry.file===${JSON.stringify(pack.manifest.states.error)}){const c=document.createElement('canvas');c.width=96;c.height=96;const scale=Math.min(88/width,88/height);c.getContext('2d').drawImage(bitmap??image,(96-width*scale)/2,(96-height*scale)/2,width*scale,height*scale);errorThumbnail=c.toDataURL('image/png');}
              results.push({file:entry.file,width,height,poster,thumbnail,errorThumbnail});
            } finally {bitmap?.close();if(image)image.src='';}
          }
          return results;
        })()`);
      })();
      const results = await Promise.race([decode,new Promise((_resolve,reject)=>{
        timer=setTimeout(()=>reject(new Error('이미지 검증 시간이 초과됐습니다. 기존 캐릭터는 유지됩니다.')),timeoutMs);
        window.webContents.once('render-process-gone',()=>reject(new Error('이미지 검증 화면이 종료됐습니다.')));
      })]);
      for (const result of results) {
        if(pack.manifest.animation?.blink.frames.some(frame=>frame.file===result.file)&&(result.width!==pack.manifest.animation.canvas.width||result.height!==pack.manifest.animation.canvas.height))throw Error('모든 프레임은 공통 캔버스 크기와 같아야 합니다.');
        if (!result.poster) continue;
        const original = pack.imageFiles.find(item=>item.file===result.file).source;
        for (const state of Object.keys(pack.assets)) if(pack.assets[state]===original)pack.assets[state]=result.poster;
        pack.animationFrames=pack.animationFrames.map(source=>source===original?result.poster:source);
      }
      if(results.reduce((sum,result)=>sum+result.width*result.height*(pack.imageFiles.find(item=>item.file===result.file).frameCount??1),0)>maxPixels)throw Error('decode 이미지 픽셀 예산을 초과했습니다.');
      pack.thumbnail=results.find(item=>item.thumbnail)?.thumbnail;
      pack.errorThumbnail=results.find(item=>item.errorThumbnail)?.errorThumbnail;
      pack.decodedImages=results.map(({file,width,height})=>({file,width,height}));
      pack.decoded = true;
      pack.hasPoster = results.some(item=>item.poster);
      return pack;
    } finally {clearTimeout(timer);if(!window.isDestroyed())window.destroy();}
  }
}
module.exports={AssetValidator};
