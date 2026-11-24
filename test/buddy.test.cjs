const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadPack}=require('../src/packs.cjs'),{PersonaLibrary}=require('../src/personas.cjs'),{loadSkins}=require('../src/skins.cjs');
const {setImmediate}=require('node:timers');
test('both default characters have independent base and four Markdown modes; edits are re-read',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-personas-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const packs=['onggi-clip','onggi-sprout'].map(id=>loadPack(path.join(__dirname,'..','characters',id))),library=new PersonaLibrary(root,packs);
  for(const pack of packs){assert.deepEqual(pack.personas.map(p=>p.id),['base','friendly','warm-long','concise','blunt']);for(const id of ['friendly','warm-long','concise','blunt'])assert.ok(library.resolve(pack.manifest.id,id,'옹기봇').instructions.includes(library.read(pack.manifest.id,id).text));}
  assert.notEqual(library.read('onggi-clip','base').text,library.read('onggi-sprout','base').text);
  const before=library.resolve('onggi-clip','concise','친구');fs.writeFileSync(path.join(root,'onggi-clip','concise.md'),'# 바뀐 모드\n두 문장만 답한다.');
  assert.notEqual(library.resolve('onggi-clip','concise','친구').hash,before.hash);assert.ok(before.instructions.includes('핵심 단답'));
  library.save('onggi-sprout','base','# 작은 새싹\n부드럽게 설명한다.',library.read('onggi-sprout','base').contentHash);assert.equal(new PersonaLibrary(root,packs).read('onggi-sprout','base').text,'# 작은 새싹\n부드럽게 설명한다.');
});
test('persona paths, size, UTF-8 and empty contents fail closed',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-persona-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'..','characters','onggi-clip')),library=new PersonaLibrary(path.join(root,'personas'),[pack]);
  assert.throws(()=>library.save('onggi-clip','../outside','text'));assert.throws(()=>library.save('onggi-clip','friendly',''));assert.throws(()=>library.save('onggi-clip','friendly','한'.repeat(6000)));
  const file=path.join(library.root,'onggi-clip','friendly.md');fs.writeFileSync(file,Buffer.from([0xff]));assert.throws(()=>library.read('onggi-clip','friendly'));
  assert.ok(new PersonaLibrary(library.root,[pack]).catalog()[0].entries.find(e=>e.id==='friendly').error);library.manage('onggi-clip','reset',{id:'friendly'});assert.equal(library.read('onggi-clip','friendly').text,pack.personas.find(entry=>entry.id==='friendly').text);
  fs.unlinkSync(file);const outside=path.join(root,'outside.md');fs.writeFileSync(outside,'외부 파일');fs.symlinkSync(outside,file);assert.throws(()=>library.read('onggi-clip','friendly'),/경로/);
});
test('skin packs accept only a fixed palette of colors',t=>{
  assert.deepEqual(loadSkins(path.join(__dirname,'..','skins')).map(s=>s.id).sort(),['classic','mono','night','paper']);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-skins-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const paper=JSON.parse(fs.readFileSync(path.join(__dirname,'..','skins','paper.json'),'utf8'));paper.colors.cream='url(https://example.com)';fs.writeFileSync(path.join(root,'paper.json'),JSON.stringify(paper));assert.throws(()=>loadSkins(root),/색상/);
});

test('paper palette keeps text and interactive boundaries readable across its surfaces',()=>{
  const {colors}=loadSkins(path.join(__dirname,'../skins')).find(skin=>skin.id==='paper');
  const rgb=color=>color.slice(1).match(/../g).map(value=>parseInt(value,16));
  const luminance=values=>values.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const surfaces=['cream','surface','wash','field'],pairs=surfaces.flatMap(background=>['text','muted','green','danger'].map(foreground=>[foreground,background,4.5]));
  pairs.push(['accentInk','green',4.5],['accentInk','danger',4.5]);
  const boundary=rgb(colors.text).map((value,index)=>Math.round(value*.6+rgb(colors.surface)[index]*.4));
  for(const background of surfaces)pairs.push(['control-line',background,3]);
  for(const [foreground,background,minimum]of pairs){const a=luminance(foreground==='control-line'?boundary:rgb(colors[foreground])),b=luminance(rgb(colors[background]));assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=minimum,foreground+' on '+background);}
});

test('notice skin round trips use cached palettes and reject stale hit acknowledgements',async()=>{
  const vm=require('node:vm'),skins=loadSkins(path.join(__dirname,'../skins')),frames=[],hits=[],pending=[],colors=new Map();let receive,writes=0;
  const bubble={hidden:true,firstChild:{textContent:''},style:{setProperty(){}},setAttribute(){},addEventListener(){},getBoundingClientRect(){return{x:4,y:8,width:document.body.dataset.skin==='classic'?176:188,height:36};}};
  const document={body:{dataset:{},classList:{toggle(){}},style:{setProperty(key,value){writes++;colors.set(key,value);}}},querySelector:()=>bubble,addEventListener(){}};
  const context=vm.createContext({document,requestAnimationFrame:fn=>frames.push(fn),window:{onggi:{onState:fn=>{receive=fn;},action:(action,payload)=>{if(action==='notice-hit'){hits.push(payload);return new Promise(resolve=>pending.push(resolve));}return Promise.resolve({ok:true});}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui/notice.js'),'utf8'),context);
  const state={settings:{skinId:'classic',buddyName:'친구'},skins,noticeHitRevision:1,bubbleVisible:true,noticeAnchorX:80,characterState:'idle'};
  receive(state);assert.equal(document.body.dataset.skin,'classic');assert.equal(colors.get('--cream'),'#ffffd7');assert.equal(writes,10);frames.shift()();assert.equal(hits[0].width,176);
  receive({...state,skins:undefined});assert.equal(writes,10);frames.shift()();assert.equal(hits.length,1);
  receive({...state,skins:undefined,settings:{...state.settings,skinId:'night'},noticeHitRevision:2});frames.shift()();assert.equal(document.body.dataset.skin,'night');assert.equal(writes,20);assert.equal(hits[1].revision,2);
  pending[0]({ok:false});await new Promise(resolve=>setImmediate(resolve));assert.equal(bubble.hidden,false);
  pending[1]({ok:true,revision:2});await new Promise(resolve=>setImmediate(resolve));
  for(const skinId of ['paper','classic']){receive({...state,skins:undefined,settings:{...state.settings,skinId},noticeHitRevision:2});frames.shift()();assert.equal(document.body.dataset.skin,skinId);assert.equal(colors.get('--cream'),skins.find(s=>s.id===skinId).colors.cream);}
  assert.equal(writes,40);
});
test('character pack Markdown cannot refer outside its directory',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-pack-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const destination=path.join(root,'pack');fs.cpSync(path.join(__dirname,'..','characters','onggi-clip'),destination,{recursive:true});fs.writeFileSync(path.join(root,'outside.md'),'외부');
  const manifest=JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'));manifest.personas.base='../outside.md';fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>loadPack(destination),/팩 내부/);
});

test('raster packs reject invalid headers, excessive pixels and manifest links; immutable bytes deduplicate aliases',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-raster-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const manifest={schemaVersion:1,id:'raster',name:'Raster',states:{idle:'idle.png',sleeping:'./idle.png'}};
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(root,'idle.png'),'not an image');
  assert.throws(()=>loadPack(root),/PNG/);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
  fs.writeFileSync(path.join(root,'idle.png'),png);const loaded=loadPack(root);assert.equal(loaded.imageFiles.length,1);assert.equal(loaded.imageFiles[0].width,1);assert.equal(loaded.files.length,1);
  fs.writeFileSync(path.join(root,'idle.png'),'changed');assert.ok(loaded.contents.get('idle.png').equals(png));
  const huge=Buffer.from(png);huge.writeUInt32BE(2049,16);fs.writeFileSync(path.join(root,'idle.png'),huge);assert.throws(()=>loadPack(root),/2048/);
  fs.writeFileSync(path.join(root,'idle.png'),png.subarray(0,40));assert.throws(()=>loadPack(root),/PNG/);
  const outside=path.join(root,'outside.json');fs.writeFileSync(outside,JSON.stringify(manifest));fs.unlinkSync(path.join(root,'manifest.json'));fs.symlinkSync(outside,path.join(root,'manifest.json'));assert.throws(()=>loadPack(root),/경로/);
});

test('v2 blink frames remain data only, deduplicate assets and preserve v1 fallback',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-frames-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.cpSync(path.join(__dirname,'../characters/onggi-clip-blink'),root,{recursive:true});
  const pack=loadPack(root);assert.equal(pack.manifest.schemaVersion,2);assert.equal(pack.animationFrames.length,3);assert.equal(pack.animationFrames[0],pack.animationFrames[2]);assert.equal(pack.imageFiles.length,7);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  for(const invalid of [{...manifest,animation:{...manifest.animation,script:'run'}},{...manifest,animation:{...manifest.animation,blink:{...manifest.animation.blink,frames:[{file:'idle.svg',durationMs:1},{file:'idle.svg',durationMs:120}]}}},{...manifest,animation:{...manifest.animation,pivot:{x:2,y:1}}}]){fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(invalid));assert.throws(()=>loadPack(root),/프레임|애니메이션/);}
  const v1=loadPack(path.join(__dirname,'../characters/onggi-clip'));assert.equal(v1.manifest.schemaVersion,1);assert.equal(v1.animationFrames.length,0);
});

test('SVG styles, prefixed active elements and event attributes are rejected without changing original files',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-static-svg-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,id:'static-svg',name:'Static',states:{idle:'idle.svg'}}));
  for(const content of ['<style>@keyframes flash{to{fill:red}}</style>','<rect style="animation:flash 1s infinite"/>','<s:style xmlns:s="http://www.w3.org/2000/svg"/>','<s:animate xmlns:s="http://www.w3.org/2000/svg"/>','<rect onload="run()"/>']){const svg='<svg xmlns="http://www.w3.org/2000/svg">'+content+'</svg>';fs.writeFileSync(path.join(root,'idle.svg'),svg);assert.throws(()=>loadPack(root),/SVG/);assert.equal(fs.readFileSync(path.join(root,'idle.svg'),'utf8'),svg);}
  fs.writeFileSync(path.join(root,'idle.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');assert.ok(loadPack(root).assets.idle);
});

test('pack, persona and skin IDs reject coerced non-string values before library initialization',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-id-types-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'pack');fs.cpSync(path.join(__dirname,'../characters/onggi-clip'),directory,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  for(const id of [undefined,null,true,123,['array-id'],{toString:'valid-id'}]){
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({...manifest,id}));assert.throws(()=>loadPack(directory),/형식/);
    const candidate=structuredClone(manifest);candidate.personas.modes[0].id=id;
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(candidate));assert.throws(()=>loadPack(directory),/페르소나/);
  }
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));assert.ok(new PersonaLibrary(path.join(root,'personas'),[loadPack(directory)]).resolve(manifest.id,'friendly','버디'));
  const skins=path.join(root,'skins');fs.mkdirSync(skins);const paper=JSON.parse(fs.readFileSync(path.join(__dirname,'../skins/paper.json'),'utf8'));
  for(const id of [undefined,null,true,['paper']]){fs.writeFileSync(path.join(skins,'paper.json'),JSON.stringify({...paper,id}));assert.throws(()=>loadSkins(skins),/스킨/);}
  fs.writeFileSync(path.join(skins,'paper.json'),'null');assert.throws(()=>loadSkins(skins),/스킨/);
  fs.writeFileSync(path.join(skins,'paper.json'),JSON.stringify({...paper,colors:{...paper.colors,cream:[paper.colors.cream]}}));assert.throws(()=>loadSkins(skins),/스킨/);
  const {PackLibrary}=require('../src/pack-library.cjs'),library=new PackLibrary(root),journal={version:1,phase:'prepared',operation:'install',id:'pack-id',stage:'.stage-'+require('node:crypto').randomUUID(),backup:'.archive-'+require('node:crypto').randomUUID(),oldRevision:null,newRevision:'a'.repeat(64),before:{characterId:'onggi-clip',personaModes:{}},createdPersonas:[],personaDirectoryCreated:true};
  for(const candidate of [{...journal,id:['pack-id']},{...journal,before:{...journal.before,characterId:null}},{...journal,createdPersonas:[{id:['friendly'],hash:'a'.repeat(64)}]},{...journal,newRevision:['a'.repeat(64)]}]){
    fs.writeFileSync(library.journal,JSON.stringify(candidate));assert.throws(()=>library.recover({writeBlocked:false}),/복구/);assert.deepEqual(JSON.parse(fs.readFileSync(library.journal,'utf8')),candidate);
  }
});

test('failed pack export preserves added, modified, replaced and partially written files',t=>{
  const {PackLibrary}=require('../src/pack-library.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-export-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const library=new PackLibrary(root),pack=loadPack(path.join(__dirname,'../characters/onggi-clip')),exportRoot=path.join(root,'exports');fs.mkdirSync(exportRoot);const parent=fs.realpathSync(exportRoot);
  const exported=library.export(pack,parent);assert.equal(loadPack(exported).revision,pack.revision);
  const write=fs.writeFileSync,open=fs.openSync;let destination,scenario;
  t.mock.method(fs,'openSync',(file,...args)=>{if(typeof file==='string'&&file.startsWith(parent+path.sep)&&path.basename(file)==='manifest.json')destination=path.dirname(file);if(scenario==='normal'&&typeof file==='string'&&file===path.join(destination,pack.contents.keys().next().value))throw Error('fixture disk full');return open(file,...args);});
  t.mock.method(fs,'writeFileSync',(file,bytes,...args)=>{
    if(typeof file==='number'&&Buffer.isBuffer(bytes)&&bytes.equals(pack.contents.values().next().value)){
      if(scenario==='added')write(path.join(destination,'user-note.txt'),'외부에서 추가한 내용');
      if(scenario==='modified')write(path.join(destination,'manifest.json'),'수정한 내용');
      if(scenario==='replaced'){fs.renameSync(path.join(destination,'manifest.json'),path.join(destination,'original.json'));write(path.join(destination,'manifest.json'),'교체한 내용');}
      if(scenario==='partial')write(file,Buffer.from('partial'));
      throw Error('fixture disk full');
    }
    return write(file,bytes,...args);
  });
  for(scenario of ['normal','added','modified','replaced','partial']){
    assert.throws(()=>library.export(pack,parent),scenario==='normal'?/disk full/:/보존/);
    if(scenario==='normal'){assert.equal(fs.existsSync(destination),false);continue;}
    if(scenario==='added')assert.equal(fs.readFileSync(path.join(destination,'user-note.txt'),'utf8'),'외부에서 추가한 내용');
    if(scenario==='modified'||scenario==='replaced')assert.equal(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'),scenario==='modified'?'수정한 내용':'교체한 내용');
    if(scenario==='partial')assert.ok(fs.readdirSync(destination,{recursive:true}).some(file=>fs.statSync(path.join(destination,file)).isFile()&&fs.readFileSync(path.join(destination,file),'utf8')==='partial'));
  }
});
