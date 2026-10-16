const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {loadPack}=require('../src/packs.cjs');
const {AssetValidator}=require('../src/asset-validator.cjs');
const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'../artifacts'));
app.setPath('userData',path.join(artifactRoot,'asset-validation-profile'));
app.whenReady().then(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-decode-')),validator=new AssetValidator();
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try{
    fs.mkdirSync(artifactRoot,{recursive:true});
    await window.loadFile(path.join(__dirname,'../src/ui/validate-images.html'));
    const images=await window.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=4;c.height=5;c.getContext('2d').fillRect(0,0,4,5);return{png:c.toDataURL('image/png'),webp:c.toDataURL('image/webp')}})()`);
    const results=[];
    for(const extension of ['png','webp']){
      fs.writeFileSync(path.join(root,'idle.'+extension),Buffer.from(images[extension].split(',')[1],'base64'));
      fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id:'decode',name:'Decode',states:{idle:'idle.'+extension}}));
      const pack=loadPack(root);await validator.validate(pack);if(!pack.decoded)throw Error('Decode did not succeed');results.push({extension,width:pack.imageFiles[0].width,height:pack.imageFiles[0].height});
      let rejected=false;try{await validator.validate(pack,1);}catch{rejected=true;}if(!rejected)throw Error('Timeout did not reject');
    }
    const basePng=Buffer.from(images.png.split(',')[1],'base64'),pngData=[];let pngOffset=8;
    while(pngOffset<basePng.length){const size=basePng.readUInt32BE(pngOffset),type=basePng.toString('ascii',pngOffset+4,pngOffset+8);if(type==='IDAT')pngData.push(basePng.subarray(pngOffset+8,pngOffset+8+size));pngOffset+=size+12;}
    const control=Buffer.alloc(8);control.writeUInt32BE(2);const first=Buffer.alloc(26);first.writeUInt32BE(4,4);first.writeUInt32BE(5,8);first.writeUInt16BE(100,20);first.writeUInt16BE(1000,22);const second=Buffer.from(first);second.writeUInt32BE(1);const frameData=Buffer.concat([Buffer.from([0,0,0,2]),...pngData]);
    const chunks=[['acTL',control],['fcTL',first],['IDAT',Buffer.concat(pngData)],['fcTL',second],['fdAT',frameData],['IEND',Buffer.alloc(0)]],encoded=[basePng.subarray(0,33)];
    for(const [type,data]of chunks){const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write(type,4,'ascii');data.copy(chunk,8);let crc=0xffffffff;for(const byte of chunk.subarray(4,chunk.length-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);encoded.push(chunk);}
    fs.writeFileSync(path.join(root,'idle.png'),Buffer.concat(encoded));fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id:'decode',name:'Decode',states:{idle:'idle.png'}}));const apng=loadPack(root);await validator.validate(apng);if(!apng.hasPoster||apng.assets.idle===apng.imageFiles[0].source)throw Error('APNG did not become a static poster');results.push({extension:'apng',poster:true,frames:apng.imageFiles[0].frameCount});
    const baseWebp=Buffer.from(images.webp.split(',')[1],'base64');let webpOffset=12;const frameChunks=[];
    while(webpOffset<baseWebp.length){const length=baseWebp.readUInt32LE(webpOffset+4),type=baseWebp.toString('ascii',webpOffset,webpOffset+4),end=webpOffset+8+length+(length%2);if(['ALPH','VP8 ','VP8L'].includes(type))frameChunks.push(baseWebp.subarray(webpOffset,end));webpOffset=end;}
    const extended=Buffer.alloc(10);extended[0]=2;extended.writeUIntLE(3,4,3);extended.writeUIntLE(4,7,3);const frame=Buffer.alloc(16);frame.writeUIntLE(3,6,3);frame.writeUIntLE(4,9,3);frame.writeUIntLE(100,12,3);
    const webpChunks=[];for(const [type,data]of [['VP8X',extended],['ANIM',Buffer.alloc(6)],['ANMF',Buffer.concat([frame,...frameChunks])],['ANMF',Buffer.concat([frame,...frameChunks])]]){const chunk=Buffer.alloc(8+data.length+(data.length%2));chunk.write(type);chunk.writeUInt32LE(data.length,4);data.copy(chunk,8);webpChunks.push(chunk);}
    const riff=Buffer.alloc(12);riff.write('RIFF');riff.writeUInt32LE(4+webpChunks.reduce((sum,c)=>sum+c.length,0),4);riff.write('WEBP',8);fs.writeFileSync(path.join(root,'idle.webp'),Buffer.concat([riff,...webpChunks]));fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id:'decode',name:'Decode',states:{idle:'idle.webp'}}));const animatedWebp=loadPack(root);await validator.validate(animatedWebp);if(!animatedWebp.hasPoster||!animatedWebp.assets.idle.startsWith('data:image/png'))throw Error('Animated WebP did not become a static poster');results.push({extension:'animated-webp',poster:true,frames:animatedWebp.imageFiles[0].frameCount});
    const png=Buffer.from(images.png.split(',')[1],'base64');
    let offset=8;while(png.toString('ascii',offset+4,offset+8)!=='IDAT')offset+=png.readUInt32BE(offset)+12;
    png.fill(0,offset+8,offset+8+png.readUInt32BE(offset));fs.writeFileSync(path.join(root,'idle.png'),png);
    fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id:'decode',name:'Decode',states:{idle:'idle.png'}}));
    const corrupt=loadPack(root);let rejected=false;try{await validator.validate(corrupt);}catch{rejected=true;}if(!rejected)throw Error('Corrupt PNG decoded');
    const svg=loadPack(path.join(__dirname,'../characters/onggi-clip'));await validator.validate(svg);
    for(const content of ['<style>@keyframes flash{to{fill:red}}</style>','<g style="animation:flash 1s infinite"/>','<s:animate xmlns:s="http://www.w3.org/2000/svg"/>']){
      const candidate=loadPack(path.join(__dirname,'../characters/onggi-clip'));candidate.imageFiles[0].source='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'+content+'</svg>').toString('base64');let rejected=false;try{await validator.validate(candidate);}catch{rejected=true;}if(!rejected)throw Error('SVG semantic policy accepted active/style content');
    }
    const pixel=loadPack(path.join(__dirname,'../characters/onggi-pixel-bean'));await validator.validate(pixel);if(!pixel.decoded||pixel.decodedImages.some(image=>image.width!==128||image.height!==160))throw Error('Pixel buddy canvas decode mismatch');results.push({builtin:'onggi-pixel-bean',states:7,blinkFrames:pixel.animationFrames.length,decoded:true});
    const blink=loadPack(path.join(__dirname,'../characters/onggi-clip-blink'));await validator.validate(blink);blink.manifest.animation.canvas.width++;
    let inconsistent=false;try{await validator.validate(blink);}catch{inconsistent=true;}if(!inconsistent)throw Error('Inconsistent frame canvas was accepted');
    fs.writeFileSync(path.join(root,'idle.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><path></svg>');fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id:'decode',name:'Decode',states:{idle:'idle.svg'}}));
    let malformed=false;try{await validator.validate(loadPack(root));}catch{malformed=true;}if(!malformed)throw Error('Malformed SVG decoded');
    fs.writeFileSync(path.join(artifactRoot,'asset-validation-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',results,corruptDecodeRejected:true,timeoutRejected:true,svgDecoded:true,blinkDecoded:true,inconsistentCanvasRejected:true,malformedSvgRejected:true,realModel:false},null,2));
    console.log('ASSET_FORMAT_DECODE_AND_TIMEOUT_OK');
  }finally{window.destroy();fs.rmSync(root,{recursive:true,force:true});}
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
