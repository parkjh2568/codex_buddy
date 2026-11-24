const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadPack}=require('../src/packs.cjs'),{PersonaLibrary}=require('../src/personas.cjs'),{PackLibrary}=require('../src/pack-library.cjs');
const {createHash}=require('node:crypto');

test('persona saves require raw-byte versions and preserve external edits until explicitly reviewed',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-conflict-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),file=path.join(library.root,'onggi-clip/friendly.md');
  const original=library.read('onggi-clip','friendly');assert.match(original.contentHash,/^[a-f0-9]{64}$/);assert.equal(library.catalog()[0].entries.find(e=>e.id==='friendly').contentHash,original.contentHash);
  assert.throws(()=>library.save('onggi-clip','friendly','draft'),/원본 버전/);assert.equal(library.read('onggi-clip','friendly').text,original.text);
  fs.writeFileSync(file,'external');const current=library.read('onggi-clip','friendly');
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),error=>error.code==='PERSONA_CONFLICT'&&error.currentHash===current.contentHash&&error.currentText==='external');assert.equal(fs.readFileSync(file,'utf8'),'external');
  const stat=fs.statSync(file);fs.writeFileSync(file,'changed!');fs.utimesSync(file,stat.atime,stat.mtime);
  assert.throws(()=>library.save('onggi-clip','friendly','draft',current.contentHash),error=>error.code==='PERSONA_CONFLICT'&&error.currentText==='changed!');
  const reviewed=library.read('onggi-clip','friendly');fs.utimesSync(file,new Date(),new Date(Date.now()+10000));
  assert.deepEqual(library.save('onggi-clip','friendly','draft',reviewed.contentHash),{contentHash:createHash('sha256').update('draft').digest('hex')});assert.equal(fs.readFileSync(file,'utf8'),'draft');
  const plain=library.read('onggi-clip','friendly');fs.writeFileSync(file,Buffer.from('\ufeffdraft'));
  assert.equal(library.read('onggi-clip','friendly').text,plain.text);assert.throws(()=>library.save('onggi-clip','friendly','next',plain.contentHash),error=>error.code==='PERSONA_CONFLICT');
  assert.ok(!fs.readdirSync(path.dirname(file)).some(name=>name.endsWith('.tmp')));
});

test('persona save rechecks after staging and never replaces deleted, linked or malformed external files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-recheck-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),file=path.join(library.root,'onggi-clip/friendly.md'),original=library.read('onggi-clip','friendly'),write=fs.writeFileSync;
  const replacement=Buffer.from([0xff]);
  t.mock.method(fs,'writeFileSync',(target,...args)=>{const result=write(target,...args);if(typeof target==='number')write(file,replacement);return result;});
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),error=>error.code==='PERSONA_CONFLICT'&&error.currentHash===undefined&&error.currentText===undefined);assert.deepEqual(fs.readFileSync(file),replacement);t.mock.restoreAll();
  fs.unlinkSync(file);assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),error=>error.code==='PERSONA_CONFLICT');assert.ok(!fs.existsSync(file));
  const outside=path.join(root,'outside.md');fs.writeFileSync(outside,'outside');fs.symlinkSync(outside,file);assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash));assert.equal(fs.readFileSync(outside,'utf8'),'outside');assert.ok(fs.lstatSync(file).isSymbolicLink());
  assert.ok(!fs.readdirSync(path.dirname(file)).some(name=>name.endsWith('.tmp')));
});

test('persona write and rename failures retain the original and reset retains malformed raw backups',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-write-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),file=path.join(library.root,'onggi-clip/friendly.md'),original=library.read('onggi-clip','friendly'),write=fs.writeFileSync,rename=fs.renameSync;
  t.mock.method(fs,'writeFileSync',(target,...args)=>{if(typeof target==='number'){write(target,args[0].slice(0,3),args[1]);throw Object.assign(Error('disk full'),{code:'ENOSPC'});}return write(target,...args);});
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),/disk full/);assert.equal(fs.readFileSync(file,'utf8'),original.text);t.mock.restoreAll();
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===file)throw Object.assign(Error('file locked'),{code:'EPERM'});return rename(from,to);});
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),/file locked/);assert.equal(fs.readFileSync(file,'utf8'),original.text);t.mock.restoreAll();
  assert.ok(!fs.readdirSync(path.dirname(file)).some(name=>name.endsWith('.tmp')));
  const malformed=Buffer.from([0xff,0x00,0x61]);fs.writeFileSync(file,malformed);assert.throws(()=>library.read('onggi-clip','friendly'));
  library.manage('onggi-clip','reset',{id:'friendly'});assert.equal(library.read('onggi-clip','friendly').text,original.text);assert.ok(fs.readdirSync(path.dirname(file)).filter(name=>name.startsWith('friendly.backup-')).some(name=>fs.readFileSync(path.join(path.dirname(file),name)).equals(malformed)));
});

test('persona staging collisions and replacements preserve externally owned files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-staging-owner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),file=path.join(library.root,'onggi-clip/friendly.md'),original=library.read('onggi-clip','friendly'),open=fs.openSync,write=fs.writeFileSync;let temporary;
  t.mock.method(fs,'openSync',(target,...args)=>{if(!temporary&&typeof target==='string'&&target.startsWith(file+'.')&&args[0]==='wx'){temporary=target;write(target,'external collision',{flag:'wx'});}return open(target,...args);});
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),{code:'EEXIST'});assert.equal(fs.readFileSync(temporary,'utf8'),'external collision');assert.equal(fs.readFileSync(file,'utf8'),original.text);t.mock.restoreAll();fs.unlinkSync(temporary);
  t.mock.method(fs,'openSync',(target,...args)=>{if(typeof target==='string'&&target.startsWith(file+'.')&&args[0]==='wx')temporary=target;return open(target,...args);});
  t.mock.method(fs,'writeFileSync',(target,...args)=>{const result=write(target,...args);if(typeof target==='number'){fs.unlinkSync(temporary);write(temporary,'external replacement',{flag:'wx'});}return result;});
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),/임시 파일/);assert.equal(fs.readFileSync(temporary,'utf8'),'external replacement');assert.equal(fs.readFileSync(file,'utf8'),original.text);
  t.mock.restoreAll();fs.unlinkSync(temporary);
  t.mock.method(fs,'openSync',(target,...args)=>{if(typeof target==='string'&&target.startsWith(file+'.')&&args[0]==='wx')temporary=target;return open(target,...args);});
  t.mock.method(fs,'writeFileSync',(target,...args)=>{const result=write(target,...args);if(typeof target==='number')fs.writeSync(target,Buffer.from('external inode edit'),0,19,0);return result;});
  assert.throws(()=>library.save('onggi-clip','friendly','draft',original.contentHash),/임시 파일/);assert.equal(fs.readFileSync(temporary,'utf8'),'external inode edit');assert.equal(fs.readFileSync(file,'utf8'),original.text);
});

test('persona reset returns its own committed version when an external edit immediately follows the save',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-reset-version-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),file=path.join(library.root,'onggi-clip/friendly.md'),template=pack.personas.find(entry=>entry.id==='friendly').text;
  library.save('onggi-clip','friendly','local before reset',library.read('onggi-clip','friendly').contentHash);
  const saved=library.save.bind(library);t.mock.method(library,'save',(...args)=>{const result=saved(...args);fs.writeFileSync(file,'external after reset');return result;});
  const result=library.manage('onggi-clip','reset',{id:'friendly'});assert.deepEqual(result,{id:'friendly',contentHash:createHash('sha256').update(template).digest('hex')});assert.notEqual(result.contentHash,library.read('onggi-clip','friendly').contentHash);
  assert.throws(()=>library.save('onggi-clip','friendly','retained UI draft',result.contentHash),error=>error.code==='PERSONA_CONFLICT'&&error.currentText==='external after reset');assert.equal(fs.readFileSync(file,'utf8'),'external after reset');
  assert.ok(fs.readdirSync(path.dirname(file)).filter(name=>name.startsWith('friendly.backup-')).some(name=>fs.readFileSync(path.join(path.dirname(file),name),'utf8')==='local before reset'));
});

test('persona registry, recovery journal and MD reject oversized, invalid UTF8 and symlink sources',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-persona-limits-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),directory=path.join(library.root,'onggi-clip'),file=path.join(directory,'friendly.md'),index=path.join(directory,'modes.json'),journal=path.join(directory,'mode-create.json');
  fs.writeFileSync(file,'x'.repeat(16385));assert.throws(()=>library.read('onggi-clip','friendly'));assert.throws(()=>library.manage('onggi-clip','reset',{id:'friendly'}));assert.equal(fs.statSync(file).size,16385);
  fs.writeFileSync(file,'x'.repeat(16384));assert.equal(library.read('onggi-clip','friendly').text.length,16384);
  for(const bytes of [Buffer.alloc(65537,0x20),Buffer.concat([Buffer.from('{"version":1,"modes":[],"extra":"'),Buffer.from([0xff]),Buffer.from('"}')])]){
    fs.writeFileSync(index,bytes);const failed=new PersonaLibrary(root,[pack]);assert.ok(failed.errors.has('onggi-clip'));assert.deepEqual(fs.readFileSync(index),bytes);
  }
  fs.unlinkSync(index);fs.writeFileSync(journal,' '.repeat(131073));assert.ok(new PersonaLibrary(root,[pack]).errors.has('onggi-clip'));assert.equal(fs.statSync(journal).size,131073);fs.unlinkSync(journal);
  const outside=path.join(root,'outside.json');fs.writeFileSync(outside,'{"version":1,"modes":[]}');fs.symlinkSync(outside,index);assert.ok(new PersonaLibrary(root,[pack]).errors.has('onggi-clip'));assert.ok(fs.lstatSync(index).isSymbolicLink());
});

test('custom modes persist, archive without deleting MD, protect defaults and detect registry deletion',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-modes-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip'));let library=new PersonaLibrary(root,[pack]);
  library.save('onggi-clip','friendly','# 내 수정본',library.read('onggi-clip','friendly').contentHash);
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

test('mode creation recovery preserves external registry edits and accepts provable legacy states',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-mode-registry-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip'));
  for(const scenario of ['unchanged','renamed','added','archived','deleted','reformatted','committed','committed-md-deleted','legacy-before','legacy-after','legacy-conflict','recovery-race']){
    const directory=path.join(root,scenario),library=new PersonaLibrary(directory,[pack]),first=library.manage('onggi-clip','clone',{id:'friendly',name:'original'}),index=path.join(library.root,'onggi-clip/modes.json'),journal=path.join(library.root,'onggi-clip/mode-create.json'),before=fs.readFileSync(index),rename=fs.renameSync;
    t.mock.method(fs,'renameSync',(from,to)=>{if(to===index)throw Error('interrupted commit');return rename(from,to);});
    assert.throws(()=>library.manage('onggi-clip','clone',{id:'concise',name:'pending'}),/interrupted/);t.mock.restoreAll();
    const pending=JSON.parse(fs.readFileSync(journal,'utf8'));assert.equal(pending.version,2);assert.equal(pending.beforeRegistryHash,createHash('sha256').update(before).digest('hex'));
    const edited=JSON.parse(before);
    if(['renamed','legacy-conflict'].includes(scenario))edited.modes[0].name='external name';
    if(scenario==='added')edited.modes.push({id:'user-'+require('node:crypto').randomUUID(),name:'external mode',archived:false});
    if(scenario==='archived')edited.modes[0].archived=true;
    if(['renamed','added','archived','legacy-conflict'].includes(scenario))fs.writeFileSync(index,JSON.stringify(edited));
    if(scenario==='deleted')fs.unlinkSync(index);
    if(scenario==='reformatted')fs.writeFileSync(index,Buffer.concat([Buffer.from('\ufeff'),before]));
    if(['committed','committed-md-deleted','legacy-after'].includes(scenario))fs.writeFileSync(index,JSON.stringify({version:1,modes:pending.modes},null,2));
    if(scenario==='committed-md-deleted')fs.unlinkSync(path.join(library.root,'onggi-clip',pending.id+'.md'));
    if(scenario.startsWith('legacy-')){pending.version=1;delete pending.beforeRegistryHash;fs.writeFileSync(journal,JSON.stringify(pending));}
    if(scenario==='recovery-race'){
      const write=fs.writeFileSync,open=fs.openSync;let staged;
      t.mock.method(fs,'openSync',(file,...args)=>{const descriptor=open(file,...args);if(typeof file==='string'&&file.startsWith(index+'.')&&args[0]==='wx')staged=descriptor;return descriptor;});
      t.mock.method(fs,'writeFileSync',(file,...args)=>{const result=write(file,...args);if(file===staged)write(index,'external during recovery');return result;});
    }
    const preserved=fs.existsSync(index)?fs.readFileSync(index):null,recovered=new PersonaLibrary(directory,[pack]);t.mock.restoreAll();
    if(['unchanged','committed','legacy-before','legacy-after'].includes(scenario)){
      assert.equal(recovered.errors.has('onggi-clip'),false,scenario);assert.equal(recovered.read('onggi-clip',pending.id).name,'pending');assert.equal(recovered.read('onggi-clip',first.id).name,'original');assert.equal(fs.existsSync(journal),false);
    }else{
      assert.match(recovered.errors.get('onggi-clip'),/외부/,scenario);assert.ok(fs.existsSync(journal));
      if(scenario==='recovery-race')assert.equal(fs.readFileSync(index,'utf8'),'external during recovery');else if(preserved===null)assert.equal(fs.existsSync(index),false);else assert.deepEqual(fs.readFileSync(index),preserved,scenario);
      if(scenario==='committed-md-deleted')assert.equal(fs.existsSync(path.join(library.root,'onggi-clip',pending.id+'.md')),false);else assert.equal(fs.readFileSync(path.join(library.root,'onggi-clip',pending.id+'.md'),'utf8'),pending.text);
    }
  }
});

test('registry writes recheck original bytes after staging and missing legacy registry recovery stays bounded',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-mode-registry-stage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),library=new PersonaLibrary(root,[pack]),first=library.manage('onggi-clip','clone',{id:'friendly',name:'original'}),index=path.join(library.root,'onggi-clip/modes.json'),write=fs.writeFileSync,open=fs.openSync;let staged;
  t.mock.method(fs,'openSync',(file,...args)=>{const descriptor=open(file,...args);if(typeof file==='string'&&file.startsWith(index+'.')&&args[0]==='wx')staged=descriptor;return descriptor;});
  t.mock.method(fs,'writeFileSync',(file,...args)=>{const result=write(file,...args);if(file===staged)write(index,'external during save');return result;});
  assert.throws(()=>library.manage('onggi-clip','rename',{id:first.id,name:'local'}),/외부/);assert.equal(fs.readFileSync(index,'utf8'),'external during save');t.mock.restoreAll();
  const legacyRoot=path.join(root,'legacy'),legacy=new PersonaLibrary(legacyRoot,[pack]),journal=path.join(legacy.root,'onggi-clip/mode-create.json'),id='user-'+require('node:crypto').randomUUID(),text=legacy.read('onggi-clip','friendly').text;
  fs.writeFileSync(journal,JSON.stringify({version:1,id,text,modes:[{id,name:'legacy',archived:false}]}));assert.equal(new PersonaLibrary(legacyRoot,[pack]).read('onggi-clip',id).name,'legacy');
});

test('registry save and recovery preserve colliding, replaced and partially written staging files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-registry-stage-owner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip'));
  for(const phase of ['save','recover'])for(const scenario of ['collision','replacement','same-inode-edit','partial']){
    const directory=path.join(root,phase+'-'+scenario),library=new PersonaLibrary(directory,[pack]),first=library.manage('onggi-clip','clone',{id:'friendly',name:'original'}),index=path.join(library.root,'onggi-clip/modes.json'),rename=fs.renameSync,write=fs.writeFileSync,open=fs.openSync;let temporary,descriptor;
    if(phase==='recover'){
      t.mock.method(fs,'renameSync',(from,to)=>{if(to===index)throw Error('interrupted');return rename(from,to);});assert.throws(()=>library.manage('onggi-clip','clone',{id:'concise',name:'pending'}),/interrupted/);t.mock.restoreAll();
    }
    const before=fs.readFileSync(index);
    t.mock.method(fs,'openSync',(file,...args)=>{
      if(!temporary&&typeof file==='string'&&file.startsWith(index+'.')&&args[0]==='wx'){
        temporary=file;if(scenario==='collision')write(file,'foreign collision',{flag:'wx'});descriptor=open(file,...args);return descriptor;
      }
      return open(file,...args);
    });
    t.mock.method(fs,'writeFileSync',(file,...args)=>{
      if(file===descriptor){
        if(scenario==='partial'){write(file,'partial');throw Error('disk full');}
        const result=write(file,...args);
        if(scenario==='same-inode-edit')write(temporary,'external inode edit');
        if(scenario==='replacement'){rename(temporary,temporary+'.original');write(temporary,args[0],{flag:'wx'});}
        return result;
      }
      return write(file,...args);
    });
    if(phase==='save')assert.throws(()=>library.manage('onggi-clip','rename',{id:first.id,name:'local'}));else assert.ok(new PersonaLibrary(directory,[pack]).errors.has('onggi-clip'));
    t.mock.restoreAll();assert.deepEqual(fs.readFileSync(index),before);assert.ok(fs.existsSync(temporary),phase+'/'+scenario);
    if(scenario!=='replacement')assert.equal(fs.readFileSync(temporary,'utf8'),scenario==='collision'?'foreign collision':scenario==='partial'?'partial':'external inode edit');
    else assert.ok(fs.existsSync(temporary+'.original'));
  }
});

test('pack lifecycle preserves edited personas and exports only referenced data',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-lifecycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source');fs.cpSync(path.join(__dirname,'../characters/onggi-clip'),source,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));manifest.id='custom-clip';fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(source,'secret.txt'),'never export');
  const profile=path.join(root,'profile');fs.mkdirSync(profile);const manager=new PackLibrary(profile),store={data:{settings:{characterId:'onggi-clip',personaModes:{}}},save(){},writeBlocked:false};let library;
  manager.change(loadPack(source),'install',store,candidate=>{library=new PersonaLibrary(path.join(profile,'personas'),[candidate]);store.data.settings.characterId=candidate.manifest.id;});
  library.save('custom-clip','friendly','# 보존할 수정본',library.read('custom-clip','friendly').contentHash);
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

test('pre-journal pack failure removes only unchanged stage files and preserves foreign or partial outputs',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-stage-owner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-clip'));
  for(const scenario of ['normal','added','modified','replaced','partial','symlink','collision']){
    const profile=path.join(root,scenario);fs.mkdirSync(profile);const manager=new PackLibrary(profile),store={data:{settings:{characterId:'onggi-clip',personaModes:{}}},writeBlocked:false,save(){}},write=fs.writeFileSync,open=fs.openSync,mkdir=fs.mkdirSync,descriptors=new Map();let stage;
    t.mock.method(fs,'mkdirSync',(file,...args)=>{if(typeof file==='string'&&path.basename(file).startsWith('.stage-')){stage=file;if(scenario==='collision'){mkdir(file);write(path.join(file,'external.txt'),'collision');throw Object.assign(Error('external collision'),{code:'EEXIST'});}}return mkdir(file,...args);});
    t.mock.method(fs,'openSync',(file,...args)=>{const descriptor=open(file,...args);if(typeof file==='string'&&stage&&file.startsWith(stage+path.sep)&&args[0]==='wx')descriptors.set(descriptor,file);return descriptor;});
    t.mock.method(fs,'writeFileSync',(file,...args)=>{
      if(scenario==='partial'&&typeof file==='number'&&descriptors.has(file)){write(file,Buffer.from('partial'));throw Error('stage write failed');}
      if(file===manager.journal){
        if(scenario==='added')write(path.join(stage,'external.txt'),'foreign');
        if(scenario==='modified')write(path.join(stage,'manifest.json'),'external edit');
        if(scenario==='replaced'){fs.renameSync(path.join(stage,'manifest.json'),path.join(stage,'retained-original.json'));write(path.join(stage,'manifest.json'),'external replacement');}
        if(scenario==='symlink'){const outside=path.join(profile,'outside.txt');write(outside,'external');fs.symlinkSync(outside,path.join(stage,'external-link'));}
        throw Error('journal write failed');
      }
      return write(file,...args);
    });
    assert.throws(()=>manager.change(pack,'install',store,()=>assert.fail('must not commit')),/failed|collision/);t.mock.restoreAll();
    assert.equal(fs.existsSync(path.join(manager.root,pack.manifest.id)),false);assert.equal(fs.existsSync(manager.journal),false);assert.equal(store.writeBlocked,false);
    if(scenario==='normal'){assert.equal(fs.existsSync(stage),false);continue;}
    assert.equal(fs.existsSync(stage),true,scenario);if(scenario!=='collision')assert.match(manager.warning,/보존/);
    if(['added','collision'].includes(scenario))assert.equal(fs.readFileSync(path.join(stage,'external.txt'),'utf8'),scenario==='added'?'foreign':'collision');
    if(['modified','replaced','partial'].includes(scenario))assert.equal(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'),scenario==='modified'?'external edit':scenario==='replaced'?'external replacement':'partial');
    if(scenario==='symlink'){assert.equal(fs.lstatSync(path.join(stage,'external-link')).isSymbolicLink(),true);assert.equal(fs.readFileSync(path.join(profile,'outside.txt'),'utf8'),'external');}
  }
});

test('archive catalog reads bounded metadata only and defers malformed image validation to preview',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pack-archive-metadata-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const library=new PackLibrary(root),archive=path.join(library.directory,'.archive-'+require('node:crypto').randomUUID());fs.mkdirSync(archive);
  const manifest={schemaVersion:1,id:'archived',name:'Archived',version:'2.0',states:{idle:'missing.svg'}};fs.writeFileSync(path.join(archive,'manifest.json'),JSON.stringify(manifest));
  const open=fs.openSync;let opened=[];t.mock.method(fs,'openSync',(file,...args)=>{if(typeof file==='string'){opened.push(file);assert.equal(path.basename(file),'manifest.json');}return open(file,...args);});
  const [entry]=library.archives();assert.equal(entry.id,'archived');assert.equal(entry.name,'Archived');assert.equal(entry.version,'2.0');assert.equal(entry.token,path.basename(archive));assert.ok(Number.isFinite(entry.at));assert.equal(opened.length,1);t.mock.restoreAll();
  assert.throws(()=>loadPack(archive));
  for(const bytes of [Buffer.alloc(65537,0x20),Buffer.from([0xff]),Buffer.from('null'),Buffer.from(JSON.stringify({...manifest,id:['wrong']})),Buffer.from(JSON.stringify({...manifest,schemaVersion:3}))]){fs.writeFileSync(path.join(archive,'manifest.json'),bytes);assert.deepEqual(library.archives(),[]);}
  const outside=path.join(root,'external-manifest.json');fs.writeFileSync(outside,JSON.stringify(manifest));fs.unlinkSync(path.join(archive,'manifest.json'));fs.symlinkSync(outside,path.join(archive,'manifest.json'));assert.deepEqual(library.archives(),[]);
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
  const profile=path.join(root,'packs');fs.mkdirSync(profile);const manager=new PackLibrary(profile),exported=loadPack(manager.export(pack,root,library));library.save('onggi-clip',id,'# More recent local edit',library.read('onggi-clip',id).contentHash);library=new PersonaLibrary(directory,[exported]);assert.equal(library.read('onggi-clip',id).kind,'user');assert.equal(library.read('onggi-clip',id).text,'# More recent local edit');assert.equal(library.catalog()[0].entries.filter(e=>e.id===id).length,1);assert.throws(()=>library.manage('onggi-clip','reset',{id}),/제공/);
  library.manage('onggi-clip','archive',{id});library=new PersonaLibrary(directory,[exported]);assert.ok(library.catalog()[0].entries.find(e=>e.id===id).archived);assert.throws(()=>library.read('onggi-clip',id));
  library.manage('onggi-clip','unarchive',{id});const file=path.join(library.root,'onggi-clip',id+'.md');fs.unlinkSync(file);library=new PersonaLibrary(directory,[exported]);assert.ok(!fs.existsSync(file));assert.equal(library.catalog()[0].entries.find(e=>e.id===id).kind,'user');assert.ok(library.catalog()[0].entries.find(e=>e.id===id).error);
});

test('original pixel buddy exports only referenced data and roundtrips its seven states and blink',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-pixel-pack-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'../characters/onggi-pixel-bean')),library=new PackLibrary(root),exported=library.export(pack,root),restored=loadPack(exported);
  assert.equal(restored.manifest.id,'onggi-pixel-bean');assert.equal(Object.keys(restored.assets).length,7);assert.equal(restored.manifest.animation.rendering,'pixel');assert.equal(restored.animationFrames.length,3);assert.equal(restored.personas.length,5);assert.equal(restored.manifest.source,pack.manifest.source);assert.equal(restored.manifest.license,pack.manifest.license);
  assert.ok([...restored.contents.keys()].every(file=>/\.(svg|md)$/.test(file)));assert.equal(restored.revision,pack.revision);
});
