const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');

class ResponseImages {
  constructor(directory,validator){
    this.root=path.resolve(directory);this.validator=validator;this.error=null;
    try{if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('링크 폴더');fs.mkdirSync(directory,{recursive:true});this.root=fs.realpathSync(directory);}catch{this.error='응답 이미지 보관 폴더를 준비하지 못했어요. 텍스트 대화는 유지하며 이미지 저장은 차단합니다.';}
  }
  async capture(item,{workspace,threadId}={}){
    const inputs=item.type==='imageGeneration'?[{itemId:item.id,data:item.result,savedPath:item.savedPath,status:item.status,failure:item.failure}]:item.type==='mcpToolCall'?(item.result?.content??[]).filter(c=>c?.type==='image').slice(0,8).map((c,i)=>({itemId:item.id+':'+i,data:c.data,status:item.status==='failed'||item.result?.isError?'failed':'completed'})):[];
    const images=[];
    for(const input of inputs){
      try{
        if(this.error)throw Error(this.error);
        if(input.status!=='completed'||input.failure)throw Error(input.failure?.type==='usageLimitExceeded'?'이미지 생성 사용량 한도에 도달했어요.':'이미지 생성이 완료되지 않았어요.');
        let bytes;
        if(input.data){
          if(typeof input.data!=='string'||input.data.length>24*1024*1024)throw Error('응답 이미지는 최대 16MiB까지 표시할 수 있어요.');
          const data=input.data.replace(/^data:image\/(?:png|jpeg|webp);base64,/,'');
          if(data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error('이미지 응답 형식을 확인해주세요.');
          bytes=Buffer.from(data,'base64');
        }else{
          if(typeof input.savedPath!=='string'||!path.isAbsolute(input.savedPath))throw Error('이미지 결과가 비어 있어요.');
          const file=fs.realpathSync(input.savedPath),roots=[];
          if(workspace)roots.push(fs.realpathSync(workspace));
          if(typeof threadId==='string'&&/^[a-zA-Z0-9-]{1,200}$/.test(threadId)){
            const generated=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'generated_images',threadId);
            if(fs.existsSync(generated))roots.push(fs.realpathSync(generated));
          }
          if(fs.lstatSync(input.savedPath).isSymbolicLink()||!roots.some(root=>file.startsWith(root+path.sep)))throw Error('이미지 저장 경로가 이 대화의 소유 범위 밖에 있어요.');
          const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
          try{const stat=fs.fstatSync(descriptor);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('이미지 파일 크기를 확인해주세요.');const buffer=Buffer.alloc(stat.size+1);let count=0;while(count<buffer.length){const read=fs.readSync(descriptor,buffer,count,buffer.length-count,null);if(!read)break;count+=read;}if(count!==stat.size)throw Error('이미지 파일이 변경됐어요.');bytes=buffer.subarray(0,count);}finally{fs.closeSync(descriptor);}
        }
        if(!bytes.length||bytes.length>16*1024*1024)throw Error('응답 이미지는 최대 16MiB까지 표시할 수 있어요.');
        let mime,width,height;
        if(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
          mime='image/png';width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
        }else if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
          mime='image/jpeg';let offset=2;
          while(offset+4<=bytes.length){
            if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;
            const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
            const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
            if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}offset+=length;
          }
        }else if(bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length){
          mime='image/webp';let offset=12;
          while(offset+8<=bytes.length){
            const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8;
            if(start+length>bytes.length)break;
            if(type==='VP8X'&&length===10){width=bytes.readUIntLE(start+4,3)+1;height=bytes.readUIntLE(start+7,3)+1;break;}
            if(type==='VP8 '&&length>=10&&bytes.subarray(start+3,start+6).equals(Buffer.from([157,1,42]))){width=bytes.readUInt16LE(start+6)&16383;height=bytes.readUInt16LE(start+8)&16383;break;}
            if(type==='VP8L'&&length>=5&&bytes[start]===47){const bits=bytes.readUInt32LE(start+1);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;break;}offset=start+length+(length%2);
          }
        }
        if(!mime||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||width*height>16777216)throw Error('PNG/JPEG/WebP와 최대 4096px 이미지만 표시할 수 있어요.');
        const id=createHash('sha256').update(bytes).digest('hex'),source='data:'+mime+';base64,'+bytes.toString('base64');
        const candidate={manifest:{states:{idle:'response'}},imageFiles:[{file:'response',source,width:null,height:null,animated:false,frameCount:1}],assets:{idle:source},animationFrames:[]};
        await this.validator.validate(candidate,10000,{maxDimension:4096,maxPixels:16777216,thumbnailSize:512});
        if(candidate.decodedImages){width=candidate.decodedImages[0].width;height=candidate.decodedImages[0].height;}
        const preview=Buffer.from(candidate.thumbnail.split(',')[1],'base64'),previewId=createHash('sha256').update(preview).digest('hex');
        if(fs.realpathSync(this.root)!==this.root)throw Error('응답 이미지 폴더가 변경됐어요.');
        let used=0;
        for(const entry of fs.readdirSync(this.root,{withFileTypes:true})){const stat=fs.lstatSync(path.join(this.root,entry.name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('응답 이미지 폴더의 파일을 확인해주세요.');used+=stat.size;}
        for(const [key,type,content]of [[id,mime,bytes],[previewId,'image/png',preview]]){
          const file=path.join(this.root,key+'.'+type.split('/')[1]);
          if(fs.existsSync(file)){this.read({id:key,mime:type});continue;}
          if(used+content.length>512*1024*1024)throw Error('응답 이미지 저장 공간이 512MiB 한도에 도달했어요.');
          const temporary=file+'.tmp-'+randomUUID();
          try{await fs.promises.writeFile(temporary,content,{flag:'wx',mode:0o600});if(fs.realpathSync(this.root)!==this.root)throw Error('응답 이미지 폴더가 변경됐어요.');try{fs.linkSync(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;this.read({id:key,mime:type});}used+=content.length;}finally{fs.rmSync(temporary,{force:true});}
        }
        images.push({itemId:input.itemId,status:'ready',id,previewId,mime,width,height,bytes:bytes.length});
      }catch(error){const message=typeof error?.message==='string'?error.message:'';images.push({itemId:input.itemId,status:'failed',error:/^(응답|이미지|PNG)/.test(message)?message:'이미지를 읽거나 저장하지 못했어요. 원본 결과는 CLI 기록에 남아 있어요.'});}
    }
    return images;
  }
  read({id,mime}){
    if(this.error)throw Error(this.error);
    if(!/^[a-f0-9]{64}$/.test(id)||!['image/png','image/jpeg','image/webp'].includes(mime)||fs.realpathSync(this.root)!==this.root)throw Error('표시할 이미지 정보를 확인해주세요.');
    const file=path.join(this.root,id+'.'+mime.split('/')[1]);if(fs.lstatSync(file).isSymbolicLink())throw Error('이미지 파일의 링크는 사용할 수 없습니다.');
    const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
    try{const stat=fs.fstatSync(descriptor);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('이미지 파일 크기를 확인해주세요.');const buffer=Buffer.alloc(stat.size+1);let count=0;while(count<buffer.length){const read=fs.readSync(descriptor,buffer,count,buffer.length-count,null);if(!read)break;count+=read;}if(count!==stat.size)throw Error('저장 이미지가 변경됐어요.');bytes=buffer.subarray(0,count);}finally{fs.closeSync(descriptor);}
    if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==id)throw Error('저장 이미지가 변경됐어요. 대화를 다시 열어 원본을 확인해주세요.');
    if(!(mime==='image/png'&&bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'||mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||mime==='image/webp'&&bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'))throw Error('저장 이미지의 형식이 올바르지 않아요.');
    return{file,bytes};
  }
}
module.exports={ResponseImages};
