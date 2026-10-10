const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadPack}=require('../src/packs.cjs'),{PersonaLibrary}=require('../src/personas.cjs'),{PackLibrary}=require('../src/pack-library.cjs');

test('custom modes persist, archive without deleting MD, protect defaults and detect registry deletion',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-modes-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip'));let library=new PersonaLibrary(root,[pack]);
  library.save('onggi-clip','friendly','# 내 수정본');
  const {id}=library.manage('onggi-clip','clone',{id:'friendly',name:'나만의 말투'});
  assert.equal(library.read('onggi-clip',id).text,'# 내 수정본');
  library.manage('onggi-clip','rename',{id,name:'새 이름'});library.manage('onggi-clip','archive',{id});
  assert.ok(fs.existsSync(path.join(root,'onggi-clip',id+'.md')));assert.throws(()=>library.read('onggi-clip',id));
  library=new PersonaLibrary(root,[pack]);assert.ok(library.catalog()[0].entries.find(e=>e.id===id).archived);
  library.manage('onggi-clip','unarchive',{id});assert.equal(library.read('onggi-clip',id).name,'새 이름');
  assert.throws(()=>library.manage('onggi-clip','rename',{id:'friendly',name:'불가'}),/사용자/);
  library.manage('onggi-clip','reset',{id:'friendly'});assert.equal(library.read('onggi-clip','friendly').text,pack.personas.find(e=>e.id==='friendly').text);
  fs.writeFileSync(path.join(root,'onggi-clip/friendly.md'),Buffer.from([0xff]));library.manage('onggi-clip','reset',{id:'friendly'});assert.equal(library.read('onggi-clip','friendly').text,pack.personas.find(e=>e.id==='friendly').text);
  assert.ok(fs.readdirSync(path.join(root,'onggi-clip')).filter(n=>n.startsWith('friendly.backup-')).some(n=>fs.readFileSync(path.join(root,'onggi-clip',n)).equals(Buffer.from([0xff]))));
  assert.ok(fs.readdirSync(path.join(root,'onggi-clip')).some(n=>n.startsWith('friendly.backup-')));
  fs.unlinkSync(path.join(root,'onggi-clip/modes.json'));assert.throws(()=>library.manage('onggi-clip','archive',{id}),/외부/);
});

test('interrupted mode creation recovers registry and MD together; altered MD is preserved',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-mode-crash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip'));const library=new PersonaLibrary(root,[pack]);
  const rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to.endsWith('modes.json'))throw Object.assign(Error('Windows file locked'),{code:'EPERM'});return rename(from,to);};
  try{assert.throws(()=>library.manage('onggi-clip','clone',{id:'concise',name:'복구 모드'}),/locked/);}finally{fs.renameSync=rename;}
  const pending=JSON.parse(fs.readFileSync(path.join(root,'onggi-clip/mode-create.json')));
  const recovered=new PersonaLibrary(root,[pack]);assert.equal(recovered.read('onggi-clip',pending.id).name,'복구 모드');assert.ok(!fs.existsSync(path.join(root,'onggi-clip/mode-create.json')));
  fs.writeFileSync(path.join(root,'onggi-clip/mode-create.json'),JSON.stringify(pending));fs.writeFileSync(path.join(root,'onggi-clip',pending.id+'.md'),'내가 바꾼 파일');
  const guarded=new PersonaLibrary(root,[pack]);assert.ok(guarded.errors.has('onggi-clip'));assert.equal(fs.readFileSync(path.join(root,'onggi-clip',pending.id+'.md'),'utf8'),'내가 바꾼 파일');
});

test('pack lifecycle preserves edited personas and exports only referenced data',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-lifecycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source');fs.cpSync(path.join(__dirname,'../characters/onggi-clip'),source,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));manifest.id='custom-clip';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(source,'secret.txt'),'never export');
  const profile=path.join(root,'profile');fs.mkdirSync(profile);const manager=new PackLibrary(profile),store={data:{settings:{characterId:'onggi-clip',personaModes:{}}},save(){},writeBlocked:false};let library;
  manager.change(loadPack(source),'install',store,candidate=>{library=new PersonaLibrary(path.join(profile,'personas'),[candidate]);store.data.settings.characterId=candidate.manifest.id;});
  library.save('custom-clip','friendly','# 보존할 수정본');
  const {id}=library.manage('custom-clip','clone',{id:'friendly',name:'복제본'});
  manifest.version='2.0.0';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
  manager.change(loadPack(source),'replace',store,candidate=>{library=new PersonaLibrary(path.join(profile,'personas'),[candidate]);});
  assert.equal(library.read('custom-clip','friendly').text,'# 보존할 수정본');assert.equal(library.read('custom-clip',id).text,'# 보존할 수정본');
  const fresh=loadPack(path.join(profile,'characters/custom-clip')),original=manager.export(fresh,root),edited=manager.export(fresh,root,library);
  assert.ok(!fs.existsSync(path.join(original,'secret.txt')));assert.equal(loadPack(original).personas.length,5);assert.equal(loadPack(edited).personas.length,6);
  assert.equal(loadPack(edited).personas.find(e=>e.id===id).text,'# 보존할 수정본');
  manager.change(fresh,'remove',store,()=>{store.data.settings.characterId='onggi-clip';});
  assert.ok(!fs.existsSync(fresh.root));assert.equal(manager.archives().length,2);assert.ok(fs.existsSync(path.join(profile,'personas/custom-clip',id+'.md')));
});

test('pack failure rolls back only owned changes; recovery refuses to delete extra user files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source');fs.cpSync(path.join(__dirname,'../characters/onggi-clip'),source,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));manifest.id='failure-clip';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
  const profile=path.join(root,'profile');fs.mkdirSync(profile);const manager=new PackLibrary(profile),store={data:{settings:{characterId:'onggi-clip',personaModes:{},buddyName:'친구',model:'keep-model'}},save(){},writeBlocked:false};
  const pack=loadPack(source);
  assert.throws(()=>manager.change(pack,'install',store,candidate=>{new PersonaLibrary(path.join(profile,'personas'),[candidate]);store.data.settings.characterId=pack.manifest.id;throw Error('disk full');}),/disk full/);
  assert.equal(store.data.settings.characterId,'onggi-clip');assert.equal(store.data.settings.model,'keep-model');assert.ok(!fs.existsSync(path.join(profile,'characters',pack.manifest.id)));assert.ok(!fs.existsSync(manager.journal));
  assert.throws(()=>manager.change(pack,'install',store,()=>{store.writeBlocked=true;throw Error('crash');}),/crash/);
  const target=path.join(profile,'characters',pack.manifest.id);fs.writeFileSync(path.join(target,'my-notes.txt'),'preserve');store.writeBlocked=false;
  assert.throws(()=>manager.recover(store),/추가 파일/);assert.equal(fs.readFileSync(path.join(target,'my-notes.txt'),'utf8'),'preserve');
  fs.unlinkSync(path.join(target,'my-notes.txt'));manager.recover(store);assert.ok(!fs.existsSync(target));assert.ok(!fs.existsSync(manager.journal));
});

test('locked directory rename leaves the installed version and edited MD unchanged',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-locked-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source');fs.cpSync(path.join(__dirname,'../characters/onggi-clip'),source,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));manifest.id='locked-pack';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
  const profile=path.join(root,'profile');fs.mkdirSync(profile);const manager=new PackLibrary(profile),store={data:{settings:{characterId:'onggi-clip',personaModes:{}}},save(){},writeBlocked:false};
  manager.change(loadPack(source),'install',store,candidate=>{new PersonaLibrary(path.join(profile,'personas'),[candidate]);});
  const target=path.join(manager.root,'locked-pack'),revision=loadPack(target).revision,file=path.join(profile,'personas/locked-pack/friendly.md');fs.writeFileSync(file,'edited');manifest.version='2.0.0';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));
  const rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(from===target)throw Object.assign(Error('directory locked'),{code:'EPERM'});return rename(from,to);});
  assert.throws(()=>manager.change(loadPack(source),'replace',store,()=>assert.fail('commit must not run')),/locked/);assert.equal(loadPack(target).revision,revision);assert.equal(fs.readFileSync(file,'utf8'),'edited');assert.equal(store.writeBlocked,false);assert.equal(fs.existsSync(manager.journal),false);
});

test('Unicode mode names and edited export reimport preserve user ownership, archives and missing MD',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-personalization-roundtrip-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),directory=path.join(root,'personas');let library=new PersonaLibrary(directory,[pack]);
  const {id}=library.manage('onggi-clip','clone',{id:'friendly',name:'😀'.repeat(60)});library=new PersonaLibrary(directory,[pack]);assert.equal(library.read('onggi-clip',id).name,'😀'.repeat(60));assert.throws(()=>library.manage('onggi-clip','rename',{id,name:'😀'.repeat(61)}),/60/);
  const profile=path.join(root,'packs');fs.mkdirSync(profile);const manager=new PackLibrary(profile),exported=loadPack(manager.export(pack,root,library));library.save('onggi-clip',id,'# More recent local edit');library=new PersonaLibrary(directory,[exported]);assert.equal(library.read('onggi-clip',id).kind,'user');assert.equal(library.read('onggi-clip',id).text,'# More recent local edit');assert.equal(library.catalog()[0].entries.filter(e=>e.id===id).length,1);assert.throws(()=>library.manage('onggi-clip','reset',{id}),/제공/);
  library.manage('onggi-clip','archive',{id});library=new PersonaLibrary(directory,[exported]);assert.ok(library.catalog()[0].entries.find(e=>e.id===id).archived);assert.throws(()=>library.read('onggi-clip',id));
  library.manage('onggi-clip','unarchive',{id});const file=path.join(library.root,'onggi-clip',id+'.md');fs.unlinkSync(file);library=new PersonaLibrary(directory,[exported]);assert.ok(!fs.existsSync(file));assert.equal(library.catalog()[0].entries.find(e=>e.id===id).kind,'user');assert.ok(library.catalog()[0].entries.find(e=>e.id===id).error);
});

test('original pixel buddy exports only referenced data and roundtrips its seven states and blink',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pixel-pack-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-pixel-bean')),library=new PackLibrary(root),exported=library.export(pack,root),restored=loadPack(exported);
  assert.equal(restored.manifest.id,'onggi-pixel-bean');assert.equal(Object.keys(restored.assets).length,7);assert.equal(restored.manifest.animation.rendering,'pixel');assert.equal(restored.animationFrames.length,3);assert.equal(restored.personas.length,5);assert.equal(restored.manifest.source,pack.manifest.source);assert.equal(restored.manifest.license,pack.manifest.license);
  assert.ok([...restored.contents.keys()].every(file=>/\.(svg|md)$/.test(file)));assert.equal(restored.revision,pack.revision);
});
