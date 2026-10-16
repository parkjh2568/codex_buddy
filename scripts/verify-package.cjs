const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(root,'artifacts/package-verification'));
let installed=false,archive,imageItems;
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--installed')installed=true;
  else if(['--archive','--image-items'].includes(arg)){const value=process.argv[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+arg);if(arg==='--archive')archive=path.resolve(value);else imageItems=path.resolve(value);}
  else throw Error('Unknown argument: '+arg);
}
archive??=path.join(root,'dist',...(installed?[]:['staging']),`OnggiBot-${process.platform}-${process.arch}`,...(process.platform==='darwin'?['OnggiBot.app','Contents','Resources']:['resources']),'app.asar');
if(!fs.existsSync(archive))throw Error('Build the package before verifying its ASAR: '+archive);
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.on('window-all-closed',()=>{});
const timer=setTimeout(()=>{console.error('PACKAGE_VERIFICATION_TIMEOUT');app.exit(1);},60000);
app.whenReady().then(async()=>{
  const result={at:new Date().toISOString(),archive,runtime:{electron:process.versions.electron,node:process.versions.node,arch:process.arch},hashes:{}};
  const files=['src/main.cjs','src/codex.cjs','src/models.cjs','src/preload.cjs','src/packs.cjs','src/personas.cjs','src/pack-library.cjs','src/asset-validator.cjs','src/connection-setup.cjs','src/response-images.cjs','src/attachments.cjs','src/skins.cjs','src/store.cjs','src/store-worker.cjs','src/ui/renderer.bundle.js','src/ui/renderer.bundle.js.LEGAL.txt','src/ui/index.html','src/ui/style.css','src/ui/notice.js','src/ui/notice.html','src/ui/validate-images.html','THIRD_PARTY_NOTICES.txt'];
  files.push('src/storage-maintenance.cjs');
  const excluded=['README.md','TASKS.md','AGENTS.md','.gitignore','src/ui/renderer.mjs','assets/tray-source.png'];
  for(const folder of ['characters','skins','assets'])for(const entry of fs.readdirSync(path.join(root,folder),{recursive:true,withFileTypes:true}))if(entry.isFile()){const file=path.relative(root,path.join(entry.parentPath,entry.name));if(!excluded.includes(file.split(path.sep).join('/')))files.push(file);}
  for(const file of files){const source=fs.readFileSync(path.join(root,file)),packaged=fs.readFileSync(path.join(archive,file));assert.ok(source.equals(packaged),file+' bytes differ');result.hashes[file]=createHash('sha256').update(source).digest('hex');}
  const expected=new Set([...files,'package.json'].map(file=>file.split(path.sep).join('/'))),packagedFiles=[];
  for(const entry of fs.readdirSync(archive,{recursive:true,withFileTypes:true}))if(entry.isFile())packagedFiles.push(path.relative(archive,path.join(entry.parentPath,entry.name)).split(path.sep).join('/'));
  assert.deepEqual(new Set(packagedFiles),expected,'Unexpected or missing packaged file');
  for(const file of excluded)assert.equal(fs.existsSync(path.join(archive,file)),false,'Development file leaked into ASAR: '+file);
  for(const file of ['src/store.cjs','src/store-worker.cjs'])assert.ok(fs.readFileSync(path.join(root,file)).equals(fs.readFileSync(path.join(archive+'.unpacked',file))),file+' unpacked bytes differ');
  if(process.platform==='darwin')assert.ok(fs.readFileSync(path.join(root,'assets/icon.icns')).equals(fs.readFileSync(path.join(path.dirname(archive),'electron.icns'))),'bundle icon differs');
  const metadata=require(path.join(archive,'package.json'));assert.equal(metadata.onggiProjectVersion,require(path.join(root,'package.json')).version);result.projectVersion=metadata.onggiProjectVersion;result.excluded=excluded;
  const {ResponseImages}=require(path.join(archive,'src/response-images.cjs')),{AssetValidator}=require(path.join(archive,'src/asset-validator.cjs')),{Store}=require(path.join(archive,'src/store.cjs')),{AttachmentStore}=require(path.join(archive,'src/attachments.cjs'));
  const profile=fs.mkdtempSync(path.join(output,'store-')),store=new Store(profile,{demo:false,workspace:profile});
  try{
    let item;
    if(imageItems){item=JSON.parse(fs.readFileSync(imageItems)).find(i=>i.type==='imageGeneration');assert.ok(item,'No imageGeneration item in the supplied record');}
    else{
      const bitmap=Buffer.alloc(1024*1536*4);let seed=0x13579bdf;
      for(let offset=0;offset<bitmap.length;offset+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bitmap[offset]=seed&255;bitmap[offset+1]=(seed>>>8)&255;bitmap[offset+2]=(seed>>>16)&255;bitmap[offset+3]=255;}
      const png=nativeImage.createFromBitmap(bitmap,{width:1024,height:1536}).toPNG();assert.ok(png.length>3*1024*1024);item={id:'synthetic-large-image',type:'imageGeneration',status:'completed',result:png.toString('base64')};
    }
    const library=new ResponseImages(path.join(profile,'response-images'),new AssetValidator()),[image]=await library.capture(item,{workspace:profile});assert.equal(image.status,'ready',image.error);
    if(!imageItems){assert.equal(image.width,1024);assert.equal(image.height,1536);}
    assert.ok(fs.readFileSync(library.read(image).file).equals(Buffer.from(item.result.replace(/^data:image\/[^;]+;base64,/,''),'base64')),'Original image bytes changed');
    const preview=library.read({id:image.previewId,mime:'image/png'});const bytes=fs.readFileSync(preview.file);assert.ok(preview.bytes.equals(bytes));assert.ok(bytes.readUInt32BE(16)<=512&&bytes.readUInt32BE(20)<=512);
    store.data.messages=[{id:'image-only',role:'assistant',text:'',mode:'codex',status:'completed',images:[image]}];
    const attachments=new AttachmentStore(path.join(profile,'attachments'),library),document=path.join(profile,'사본 검증.txt');fs.writeFileSync(document,'PACKAGED_ATTACHMENT_MARKER');
    const imported=await attachments.import([document,library.read(image).file]);fs.writeFileSync(document,'CHANGED_SOURCE');assert.equal(fs.readFileSync(attachments.read(imported[0]).file,'utf8'),'PACKAGED_ATTACHMENT_MARKER');
    store.data.messages.push({id:'user-attachments',role:'user',text:'inspect',mode:'codex',status:'completed',attachments:imported});await store.saveAsync();await store.closeWorker();
    const restored=new Store(profile,{});assert.equal(restored.data.messages[0].images[0].id,image.id);assert.equal(restored.data.messages[1].attachments.length,2);assert.ok(!fs.readFileSync(path.join(store.historyDirectory,store.data.activeConversationId+'.json'),'utf8').includes(item.result));
    result.packagedAttachments={fileSnapshotPreserved:true,imageDecoded:true,count:imported.length,storeReloaded:true};
    const {StorageMaintenance}=require(path.join(archive,'src/storage-maintenance.cjs')),maintenance=new StorageMaintenance(profile),orphan=Buffer.from('PACKAGED_STORAGE_RECOVERY'),orphanHash=createHash('sha256').update(orphan).digest('hex'),orphanFile=path.join(attachments.root,orphanHash+'.bin');
    fs.writeFileSync(orphanFile,orphan,{flag:'wx',mode:0o600});const options={conversations:store.data.conversations,messages:store.data.messages},inspection=await maintenance.inspect(options),candidate=inspection.items.find(entry=>entry.name.endsWith(orphanHash+'.bin'));
    assert.ok(candidate?.eligible);const moved=await maintenance.quarantine({token:inspection.token,ids:[candidate.id]},options,()=>true);assert.equal(moved.moved.length,1);assert.equal(fs.existsSync(orphanFile),false);
    const recovered=await maintenance.restore(moved.batch,()=>true);assert.equal(recovered.restored.length,1);assert.ok(fs.readFileSync(orphanFile).equals(orphan));
    result.packagedStorage={referencedCachePreserved:true,selectedOrphanQuarantined:true,restoreBytesPreserved:true,backupPreserved:recovered.backupPreserved};
    result.packagedImage={synthetic:!imageItems,width:image.width,height:image.height,bytes:image.bytes,originalId:image.id,previewId:image.previewId,previewWidth:bytes.readUInt32BE(16),previewHeight:bytes.readUInt32BE(20),originalBytesPreserved:true,storeReloaded:true};
  }finally{await store.closeWorker();fs.rmSync(profile,{recursive:true,force:true});}
  result.passed=true;fs.writeFileSync(path.join(output,'package-verification.json'),JSON.stringify(result,null,2));console.log('PACKAGE_RUNTIME_ASSETS_WORKER_ICON_AND_IMAGES_OK',files.length,result.projectVersion);app.quit();
}).catch(error=>{console.error(error.stack);app.exit(1);}).finally(()=>clearTimeout(timer));
