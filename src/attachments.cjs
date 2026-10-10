const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');

class AttachmentStore {
  constructor(directory,images){
    this.root=path.resolve(directory);this.images=images;this.error=null;
    try{if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('링크 폴더');fs.mkdirSync(directory,{recursive:true});this.root=fs.realpathSync(directory);}catch{this.error='첨부 보관 폴더를 준비하지 못했어요. 기록 폴더를 확인해주세요.';}
  }
  async import(files,{imagesOnly=false}={}){
    if(this.error)throw Error(this.error);
    if(!Array.isArray(files)||!files.length||files.length>8)throw Error('첨부는 한 번에 최대 8개까지 선택해주세요.');
    const attachments=[];let total=0;
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
        const handle=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
        try{
          const before=await handle.stat();if(!before.isFile()||before.size<1||before.size>16*1024*1024||total+before.size>32*1024*1024)throw Error('파일은 각각 16MiB, 첨부 합계는 32MiB까지 가능해요.');
          const buffer=Buffer.alloc(before.size+1);let count=0;
          while(count<buffer.length){const read=await handle.read(buffer,count,buffer.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}
          const after=await handle.stat();if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('선택한 파일이 변경됐어요. 다시 첨부해주세요.');bytes=buffer.subarray(0,count);total+=count;
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
        if(fs.realpathSync(this.root)!==this.root)throw Error('첨부 폴더가 변경됐어요.');
        const destination=path.join(this.root,hash+extension);let used=0;
        for(const entry of fs.readdirSync(this.root,{withFileTypes:true})){const stat=fs.lstatSync(path.join(this.root,entry.name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('첨부 폴더의 파일을 확인해주세요.');used+=stat.size;}
        const attachment={id,kind:'file',name,bytes:bytes.length,hash,extension};
        if(fs.existsSync(destination))this.read(attachment);
        else{
          if(used+bytes.length>512*1024*1024)throw Error('첨부 저장 공간이 512MiB 한도에 도달했어요.');
          const temporary=destination+'.tmp-'+randomUUID();
          try{await fs.promises.writeFile(temporary,bytes,{flag:'wx',mode:0o600});if(fs.realpathSync(this.root)!==this.root)throw Error('첨부 폴더가 변경됐어요.');try{fs.linkSync(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;this.read(attachment);}}finally{fs.rmSync(temporary,{force:true});}
        }
        attachments.push(attachment);
      }
    }
    return attachments;
  }
  read(attachment){
    if(this.error)throw Error(this.error);
    if(!attachment||!/^[a-f0-9]{64}$/.test(attachment.hash)||!Number.isSafeInteger(attachment.bytes)||attachment.bytes<1||attachment.bytes>16*1024*1024)throw Error('첨부 정보를 확인해주세요.');
    if(attachment.kind==='image')return this.images.read({id:attachment.hash,mime:attachment.mime});
    if(attachment.kind!=='file'||!/^\.[a-z0-9]{1,16}$/.test(attachment.extension)||fs.realpathSync(this.root)!==this.root)throw Error('첨부 경로를 확인해주세요.');
    const file=path.join(this.root,attachment.hash+attachment.extension);if(fs.lstatSync(file).isSymbolicLink())throw Error('첨부 파일의 링크는 사용할 수 없어요.');
    const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
    try{const stat=fs.fstatSync(descriptor);if(!stat.isFile()||stat.size!==attachment.bytes)throw Error('첨부 사본이 변경됐어요. 다시 첨부해주세요.');const buffer=Buffer.alloc(attachment.bytes+1);let count=0;while(count<buffer.length){const read=fs.readSync(descriptor,buffer,count,buffer.length-count,null);if(!read)break;count+=read;}bytes=buffer.subarray(0,count);}finally{fs.closeSync(descriptor);}
    if(bytes.length!==attachment.bytes||createHash('sha256').update(bytes).digest('hex')!==attachment.hash)throw Error('첨부 사본이 변경됐어요. 다시 첨부해주세요.');
    return{file};
  }
}
module.exports={AttachmentStore};
