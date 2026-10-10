const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadPack}=require('../src/packs.cjs'),{PersonaLibrary}=require('../src/personas.cjs'),{loadSkins}=require('../src/skins.cjs');
test('both default characters have independent base and four Markdown modes; edits are re-read',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-personas-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const packs=['onggi-clip','onggi-sprout'].map(id=>loadPack(path.join(__dirname,'..','characters',id))),library=new PersonaLibrary(root,packs);
  for(const pack of packs){assert.deepEqual(pack.personas.map(p=>p.id),['base','friendly','warm-long','concise','blunt']);for(const id of ['friendly','warm-long','concise','blunt'])assert.ok(library.resolve(pack.manifest.id,id,'옹기봇').instructions.includes(library.read(pack.manifest.id,id).text));}
  assert.notEqual(library.read('onggi-clip','base').text,library.read('onggi-sprout','base').text);
  const before=library.resolve('onggi-clip','concise','친구');fs.writeFileSync(path.join(root,'onggi-clip','concise.md'),'# 바뀐 모드\n두 문장만 답한다.');
  assert.notEqual(library.resolve('onggi-clip','concise','친구').hash,before.hash);assert.ok(before.instructions.includes('핵심 단답'));
  library.save('onggi-sprout','base','# 작은 새싹\n부드럽게 설명한다.');assert.equal(new PersonaLibrary(root,packs).read('onggi-sprout','base').text,'# 작은 새싹\n부드럽게 설명한다.');
});
test('persona paths, size, UTF-8 and empty contents fail closed',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-persona-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pack=loadPack(path.join(__dirname,'..','characters','onggi-clip')),library=new PersonaLibrary(path.join(root,'personas'),[pack]);
  assert.throws(()=>library.save('onggi-clip','../outside','text'));assert.throws(()=>library.save('onggi-clip','friendly',''));assert.throws(()=>library.save('onggi-clip','friendly','한'.repeat(6000)));
  const file=path.join(library.root,'onggi-clip','friendly.md');fs.writeFileSync(file,Buffer.from([0xff]));assert.throws(()=>library.read('onggi-clip','friendly'));
  assert.ok(new PersonaLibrary(library.root,[pack]).catalog()[0].entries.find(e=>e.id==='friendly').error);library.save('onggi-clip','friendly','# 고친 모드');assert.equal(library.read('onggi-clip','friendly').text,'# 고친 모드');
  fs.unlinkSync(file);const outside=path.join(root,'outside.md');fs.writeFileSync(outside,'외부 파일');fs.symlinkSync(outside,file);assert.throws(()=>library.read('onggi-clip','friendly'),/경로/);
});
test('skin packs accept only a fixed palette of colors',t=>{
  assert.deepEqual(loadSkins(path.join(__dirname,'..','skins')).map(s=>s.id).sort(),['mono','night','paper']);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-skins-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const paper=JSON.parse(fs.readFileSync(path.join(__dirname,'..','skins','paper.json'),'utf8'));paper.colors.cream='url(https://example.com)';fs.writeFileSync(path.join(root,'paper.json'),JSON.stringify(paper));assert.throws(()=>loadSkins(root),/색상/);
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
