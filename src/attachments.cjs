const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {openFlags,sameFile,readBoundedFile,publishCacheFiles}=require('./cache-files.cjs');

class AttachmentStore {
  constructor(directory,images){
    this.root=path.resolve(directory);this.images=images;this.error=null;
    try{if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('링크 폴더');fs.mkdirSync(directory,{recursive:true});this.root=fs.realpathSync(directory);}catch{this.error='첨부 보관 폴더를 준비하지 못했어요. 기록 폴더를 확인해주세요.';}
  }
  async import(files,{imagesOnly=false}={}){
    if(this.error)throw Error(this.error);
    if(!Array.isArray(files)||!files.length||files.length>8)throw Error('첨부는 한 번에 최대 8개까지 선택해주세요.');
    const attachments=[],pending=new Map();let total=0;
    for(const file of files){
      const memory=file&&typeof file==='object'&&!Array.isArray(file);
      if(memory){if(Object.keys(file).some(key=>!['name','bytes'].includes(key))||typeof file.name!=='string'||!Buffer.isBuffer(file.bytes))throw Error('첨부 데이터를 확인해주세요.');}
      else if(typeof file!=='string'||!path.isAbsolute(file)||fs.lstatSync(file).isSymbolicLink())throw Error('첨부할 일반 파일을 선택해주세요.');
      const name=(memory?file.name:path.basename(file)).normalize('NFC');if(!name||name.length>256||/[\\/\u0000-\u001f\u007f-\u009f]/u.test(name))throw Error('첨부 파일 이름을 확인해주세요.');
      let bytes;
      if(memory){
        if(file.bytes.length<1||file.bytes.length>16*1024*1024||total+file.bytes.length>32*1024*1024)throw Error('파일은 각각 16MiB, 첨부 합계는 32MiB까지 가능해요.');
        bytes=Buffer.from(file.bytes);total+=bytes.length;
      }else{
        const changed='선택한 파일이 변경됐어요. 다시 첨부해주세요.';
        const before=await fs.promises.lstat(file);
        if(!before.isFile())throw Error(changed);
        if(before.size<1||before.size>16*1024*1024||total+before.size>32*1024*1024)throw Error('파일은 각각 16MiB, 첨부 합계는 32MiB까지 가능해요.');
        const handle=await fs.promises.open(file,openFlags);
        try{
          if(!sameFile(before,await handle.stat()))throw Error(changed);
          const buffer=Buffer.alloc(before.size+1);let count=0;
          while(count<buffer.length){
            const {bytesRead}=await handle.read(buffer,count,Math.min(buffer.length-count,65536),null);
            if(!bytesRead)break;
            count+=bytesRead;
          }
          if(count!==before.size||!sameFile(before,await handle.stat())||!sameFile(before,await fs.promises.lstat(file)))throw Error(changed);
          bytes=buffer.subarray(0,count);total+=count;
        }finally{await handle.close();}
      }
      const id=randomUUID(),hash=createHash('sha256').update(bytes).digest('hex');
      const raster=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216&&bytes[2]===255||bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
      if(imagesOnly&&!raster)throw Error('이미지는 PNG/JPEG/WebP 파일을 선택해주세요.');
      if(raster){
        const [image]=await this.images.capture({id,type:'imageGeneration',status:'completed',result:bytes.toString('base64')});if(image.status!=='ready')throw Error(image.error);
        attachments.push({id,kind:'image',name,bytes:bytes.length,hash,extension:'.'+image.mime.split('/')[1],mime:image.mime,width:image.width,height:image.height,previewId:image.previewId});
      }else{
        let extension=path.extname(name).toLowerCase();if(!/^\.[a-z0-9]{1,16}$/.test(extension))extension='.bin';
        const destination=path.join(this.root,hash+extension);
        const attachment={id,kind:'file',name,bytes:bytes.length,hash,extension};
        pending.set(destination,{bytes,verify:()=>this.read(attachment)});
        attachments.push(attachment);
      }
    }
    await publishCacheFiles(this.root,pending,{label:'첨부'});
    return attachments;
  }
  read(attachment){
    if(this.error)throw Error(this.error);
    if(!attachment||typeof attachment.hash!=='string'||!/^[a-f0-9]{64}$/.test(attachment.hash)||!Number.isSafeInteger(attachment.bytes)||attachment.bytes<1||attachment.bytes>16*1024*1024)throw Error('첨부 정보를 확인해주세요.');
    if(attachment.kind==='image')return this.images.read({id:attachment.hash,mime:attachment.mime});
    if(attachment.kind!=='file'||typeof attachment.extension!=='string'||!/^\.[a-z0-9]{1,16}$/.test(attachment.extension)||fs.realpathSync(this.root)!==this.root)throw Error('첨부 경로를 확인해주세요.');
    const file=path.join(this.root,attachment.hash+attachment.extension),changed='첨부 사본이 변경됐어요. 다시 첨부해주세요.';
    const bytes=readBoundedFile(file,{limit:attachment.bytes,expectedSize:attachment.bytes,changed,oversized:changed});
    if(bytes.length!==attachment.bytes||createHash('sha256').update(bytes).digest('hex')!==attachment.hash)throw Error('첨부 사본이 변경됐어요. 다시 첨부해주세요.');
    return{file};
  }
}
module.exports={AttachmentStore};
