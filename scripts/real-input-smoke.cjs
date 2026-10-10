const {app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto'),assert=require('node:assert/strict');
const {CodexConnection}=require('../src/codex.cjs'),{ConnectionSetup}=require('../src/connection-setup.cjs'),{AttachmentStore}=require('../src/attachments.cjs'),{ResponseImages}=require('../src/response-images.cjs'),{AssetValidator}=require('../src/asset-validator.cjs');
const output=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'../artifacts/real-input-smoke'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.on('window-all-closed',()=>{});
const timer=setTimeout(()=>{console.error('REAL_INPUT_SMOKE_TIMEOUT');app.exit(1);},120000);
app.whenReady().then(async()=>{
  const executable=ConnectionSetup.findExecutable(process.env.ONGGI_CODEX_PATH);if(!executable)throw Error('Codex CLI not found. Set ONGGI_CODEX_PATH.');
  const workspace=fs.mkdtempSync(path.join(output,'workspace-')),marker='ONGGI_'+randomBytes(8).toString('hex');fs.writeFileSync(path.join(workspace,'검증 자료.txt'),'검증 표식: '+marker);
  const bitmap=Buffer.alloc(128*128*4);for(let offset=0;offset<bitmap.length;offset+=4){bitmap[offset]=220;bitmap[offset+1]=70;bitmap[offset+2]=20;bitmap[offset+3]=255;}
  fs.writeFileSync(path.join(workspace,'검증 이미지.png'),nativeImage.createFromBitmap(bitmap,{width:128,height:128}).toPNG());
  const images=new ResponseImages(path.join(output,'images'),new AssetValidator()),library=new AttachmentStore(path.join(output,'files'),images),[file,image]=await library.import([path.join(workspace,'검증 자료.txt'),path.join(workspace,'검증 이미지.png')]);
  const connection=new CodexConnection({experimentalApi:true}),messages=new Map();let threadId,completed,disconnected,requests=0;
  connection.on('request',request=>{requests++;if(request.method==='item/tool/requestUserInput')connection.respond(request.id,{answers:{}});else if(request.method.endsWith('/requestApproval'))connection.respond(request.id,request.method==='item/permissions/requestApproval'?{permissions:{},scope:'turn'}:{decision:'decline'});else connection.write({id:request.id,error:{code:-32601,message:'Verification does not accept tool calls'}});});
  connection.on('notification',event=>{if(event.params?.threadId!==threadId)return;if(event.method==='item/completed'&&event.params.item.type==='agentMessage')messages.set(event.params.item.id,event.params.item.text);if(event.method==='turn/completed')completed=event.params.turn;});connection.on('disconnected',message=>{disconnected=message;});
  try{
    await connection.connect(executable,workspace);
    const {thread}=await connection.request('thread/start',{cwd:workspace,model:'gpt-5.6-luna',sandbox:'read-only',approvalPolicy:'on-request',approvalsReviewer:'user',ephemeral:true});threadId=thread.id;
    const input=[{type:'text',text:'첨부한 이미지의 주요 색상을 보고, 첨부 파일의 내용을 읽어 검증 표식을 그대로 추출해주세요. 색상은 영어 소문자 한 단어로 답하세요. marker는 파일을 실제로 읽은 값이어야 합니다.'},{type:'localImage',path:library.read(image).file},{type:'text',text:'[옹기봇 첨부 자료]\n다음은 사용자가 이 질문에 첨부한 파일의 보관 사본입니다. 질문에 필요한 파일 내용을 읽어 답변하세요.\n'+JSON.stringify([{name:file.name,path:library.read(file).file,bytes:file.bytes}])}];
    const {turn}=await connection.request('turn/start',{threadId,input,model:'gpt-5.6-luna',effort:'high',approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'},outputSchema:{type:'object',properties:{color:{type:'string'},marker:{type:'string'}},required:['color','marker'],additionalProperties:false}});
    const deadline=Date.now()+90000;while(!completed&&!disconnected&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));assert.equal(completed?.id,turn.id,disconnected??'Owned turn did not complete');assert.equal(completed.status,'completed');
    const reply=JSON.parse([...messages.values()].at(-1));assert.equal(reply.marker,marker);assert.equal(reply.color.toLowerCase(),'blue');
    fs.writeFileSync(path.join(output,'real-input-verification.json'),JSON.stringify({at:new Date().toISOString(),passed:true,model:'gpt-5.6-luna',effort:'high',ephemeral:true,imageUnderstood:true,fileMarkerRead:true,newPermissionsGranted:false,requests,reply},null,2));console.log('REAL_CODEX_IMAGE_AND_FILE_INPUT_OK');
  }finally{connection.stop();}
  app.quit();
}).catch(error=>{console.error(error.stack);app.exit(1);}).finally(()=>clearTimeout(timer));
