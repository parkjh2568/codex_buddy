const fs = require('node:fs');
const path = require('node:path');
const { STATES } = require('../src/packs.cjs');

for (const [id, name, description, motion] of [
  ['onggi-clip', '옹기 클립', '꼬물꼬물, 은빛 친구', 'sway'],
  ['onggi-sprout', '새싹 옹기', '포근한 작은 새싹', 'float']
]) {
  const directory = path.join(__dirname, '..', 'characters', id);
  fs.mkdirSync(directory, { recursive: true });
  const states = {};
  for (const state of STATES) {
    const sleeping = state === 'sleeping', thinking = state === 'thinking', alert = state === 'attention', error = state === 'error', talking = state === 'replying';
    let art;
    if (id === 'onggi-clip') {
      const body = 'M 72 95 C 70 113 66 156 82 162 C 101 171 107 149 106 129 L 100 57 C 96 22 54 16 38 46 C 24 70 28 154 39 185 C 51 220 86 235 112 216 C 137 198 129 156 140 143 L 147 132';
      const eyeY = thinking ? 80 : 83;
      art = `<path d="${body}" fill="none" stroke="#707875" stroke-width="13" stroke-linecap="round"/>
      <path d="${body}" fill="none" stroke="#b0b8b3" stroke-width="9" stroke-linecap="round"/>
      <path d="${body}" fill="none" stroke="#d7dcd7" stroke-width="3" stroke-linecap="round" transform="translate(-1.5 -1)"/>
      <ellipse cx="46" cy="${eyeY + 5}" rx="24" ry="26" fill="#b9bfba"/>
      <ellipse cx="104" cy="${eyeY + 16}" rx="24" ry="26" fill="#b9bfba"/>
      <ellipse cx="44" cy="${eyeY}" rx="24" ry="26" fill="#fffef8"/>
      <ellipse cx="102" cy="${eyeY + 11}" rx="24" ry="26" fill="#fffef8"/>
      ${sleeping ? '<path d="M30 84 Q43 92 57 84 M88 95 Q102 103 116 95" stroke="#484641" stroke-width="5" stroke-linecap="round" fill="none"/>' : `<ellipse cx="${thinking ? 39 : alert ? 44 : 47}" cy="${thinking ? eyeY - 4 : eyeY + 2}" rx="${alert ? 11 : 15}" ry="${alert ? 14 : 18}" fill="#45433e"/><ellipse cx="${thinking ? 97 : alert ? 102 : 105}" cy="${thinking ? eyeY + 7 : eyeY + 13}" rx="${alert ? 11 : 15}" ry="${alert ? 14 : 18}" fill="#45433e"/><circle cx="${thinking ? 35 : 43}" cy="${thinking ? eyeY - 10 : eyeY - 4}" r="4" fill="#ffffffa8"/><circle cx="${thinking ? 93 : 101}" cy="${thinking ? eyeY + 1 : eyeY + 7}" r="4" fill="#ffffffa8"/>`}
      <path d="${error ? 'M29 48 L56 59 M91 72 L116 61' : thinking ? 'M27 52 Q40 44 57 48 M91 59 Q105 63 116 70' : 'M27 48 Q42 43 56 48 M91 60 Q106 59 117 67'}" fill="none" stroke="#55504a" stroke-width="9" stroke-linecap="round"/>
      ${talking ? '<path d="M69 113 Q77 123 85 115" fill="none" stroke="#737d70" stroke-width="3" stroke-linecap="round"/>' : ''}
      ${alert ? '<path d="M151 46 L151 62 M151 70 L151 71" stroke="#8eab67" stroke-width="5" stroke-linecap="round"/>' : ''}`;
    } else {
      art = `<path d="M89 108 Q87 72 91 47" fill="none" stroke="#718b52" stroke-width="7" stroke-linecap="round"/>
      <path d="M89 76 C46 87 24 55 28 33 C54 28 84 39 89 76" fill="#a6bb78"/>
      <path d="M91 61 C95 26 122 12 149 19 C153 42 131 72 91 61" fill="#7f9c5e"/>
      <path d="M88 70 Q54 52 36 41 M95 57 Q118 35 138 27" fill="none" stroke="#d0dcb0" stroke-width="3" stroke-linecap="round"/>
      <path d="M43 105 Q88 91 137 105 L126 197 Q88 218 53 197 Z" fill="#cba87c"/>
      <path d="M51 110 L60 191 Q88 205 117 191 L126 110" fill="#e7c89e"/>
      <rect x="36" y="99" width="108" height="23" rx="11" fill="#ecd2ac"/><path d="M46 106 L133 106" stroke="#f9e7cd" stroke-width="3" stroke-linecap="round"/>
      ${sleeping ? '<path d="M65 150 Q72 155 79 150 M103 150 Q110 155 117 150" fill="none" stroke="#655546" stroke-width="4" stroke-linecap="round"/>' : `<ellipse cx="72" cy="${thinking ? 144 : 151}" rx="5" ry="${alert ? 9 : 7}" fill="#655546"/><ellipse cx="109" cy="${thinking ? 144 : 151}" rx="5" ry="${alert ? 9 : 7}" fill="#655546"/>`}
      <ellipse cx="60" cy="163" rx="8" ry="4" fill="#dda696"/><ellipse cx="120" cy="163" rx="8" ry="4" fill="#dda696"/>
      <path d="${error ? 'M83 173 Q90 167 97 173' : 'M83 170 Q90 178 97 170'}" fill="none" stroke="#806450" stroke-width="3" stroke-linecap="round"/>
      ${alert ? '<path d="M157 76 L157 92 M157 101 L157 102" stroke="#8eab67" stroke-width="5" stroke-linecap="round"/>' : ''}`;
    }
    fs.writeFileSync(path.join(directory, state + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 250" role="img" aria-label="${name}">${art}</svg>`);
    states[state] = state + '.svg';
  }
  const personaConfig=fs.existsSync(path.join(directory,'manifest.json'))?JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')).personas:undefined;
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id, name, description, version: '1.0.0', size: { width: 150, height: 190 }, bubbleAnchor: { x: .65, y: .12 }, motion, states, ...(personaConfig?{personas:personaConfig}:{}) }, null, 2));
}
const clipDirectory=path.join(__dirname,'..','characters','onggi-clip'),blinkDirectory=path.join(__dirname,'..','characters','onggi-clip-blink');
fs.cpSync(clipDirectory,blinkDirectory,{recursive:true});
for(const file of fs.readdirSync(blinkDirectory).filter(file=>file.endsWith('.svg'))){const target=path.join(blinkDirectory,file);fs.writeFileSync(target,fs.readFileSync(target,'utf8').replace('<svg xmlns=','<svg width="180" height="250" xmlns='));}
const blink=JSON.parse(fs.readFileSync(path.join(blinkDirectory,'manifest.json'),'utf8'));
Object.assign(blink,{schemaVersion:2,id:'onggi-clip-blink',name:'옹기 클립 · 눈 깜빡임',description:'생동감 프로필에서 가끔 눈을 깜빡이는 친구',author:'OnggiBot',source:'Built-in SVG character',license:'Project character assets',animation:{canvas:{width:180,height:250},pivot:{x:.5,y:1},rendering:'smooth',blink:{loop:true,frames:[{file:'idle.svg',durationMs:4000},{file:'sleeping.svg',durationMs:120},{file:'idle.svg',durationMs:120}]}}});
fs.writeFileSync(path.join(blinkDirectory,'manifest.json'),JSON.stringify(blink,null,2)+'\n');
console.log('Generated two v1 packs and one v2 blink pack, seven states each.');

const pixelDirectory=path.join(__dirname,'..','characters','onggi-pixel-bean'),pixelStates={};fs.mkdirSync(pixelDirectory,{recursive:true});
for(const state of [...STATES,'blink']){
  const closed=state==='sleeping'||state==='blink',thinking=state==='thinking',attention=state==='attention',error=state==='error',replying=state==='replying',listening=state==='listening';
  const eyes=closed?'<path d="M10 21h4M19 21h4" stroke="#30453c" stroke-width="2"/>':`<rect x="${thinking?10:11}" y="${thinking?18:19}" width="3" height="${attention?6:4}" fill="#30453c"/><rect x="${thinking?18:19}" y="${thinking?18:19}" width="3" height="${attention?6:4}" fill="#30453c"/><rect x="${thinking?10:11}" y="${thinking?18:19}" width="1" height="1" fill="#fff8df"/><rect x="${thinking?18:19}" y="${thinking?18:19}" width="1" height="1" fill="#fff8df"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="160" viewBox="0 0 32 40" shape-rendering="crispEdges" role="img" aria-label="픽셀 콩 ${state}"><path d="M9 12V9h5V6h5v3h5v3h3v17h-3v5H9v-5H6V12Z" fill="#466353"/><path d="M10 13v-3h5V8h3v3h5v3h2v14h-3v4H10v-4H8V13Z" fill="#b9cf86"/><path d="M10 13h12v2H10v12H8V15h2Z" fill="#e5edb9"/><path d="M11 32v4h-5v-2h3v-2M21 32v4h5v-2h-3v-2" fill="#466353"/><path d="M6 18H3v${listening?-6:7}h3M27 18h3v${replying?-5:7}h-3" fill="none" stroke="#466353" stroke-width="2"/>${eyes}<rect x="8" y="25" width="4" height="2" fill="#dbad94"/><rect x="21" y="25" width="4" height="2" fill="#dbad94"/>${replying?'<rect x="14" y="25" width="5" height="4" fill="#466353"/>':error?'<path d="M14 28v-2h5v2" fill="none" stroke="#466353" stroke-width="1"/>':'<path d="M14 26v1h5v-1" fill="none" stroke="#466353" stroke-width="1"/>'}${attention?'<path d="M28 6v5m0 2v2" stroke="#b77944" stroke-width="2"/>':thinking?'<rect x="23" y="4" width="2" height="2" fill="#839776"/><rect x="27" y="4" width="2" height="2" fill="#839776"/>':error?'<path d="M9 17h5m4 0h5" stroke="#466353" stroke-width="2"/>':state==='sleeping'?'<path d="M24 6h5l-5 4h5" stroke="#839776" stroke-width="1" fill="none"/>':''}</svg>`;
  fs.writeFileSync(path.join(pixelDirectory,state+'.svg'),svg+'\n');if(state!=='blink')pixelStates[state]=state+'.svg';
}
fs.mkdirSync(path.join(pixelDirectory,'personas'),{recursive:true});
for(const entry of ['base','friendly','warm-long','concise','blunt']){const file=path.join(pixelDirectory,'personas',entry+'.md');if(!fs.existsSync(file))fs.writeFileSync(file,entry==='base'?'# 픽셀 콩의 기본 성격\n너는 곁을 지키는 작은 픽셀 버디다. 사용자의 질문에 맞춰 구체적이고 편안하게 돕는다. 확실하지 않은 내용은 구분하고 작은 다음 행동을 제안한다. 이름은 전달된 버디 이름을 따른다. 한국어 질문에는 자연스러운 한국어로 답한다.\n':fs.readFileSync(path.join(__dirname,'..','characters','onggi-sprout','personas',entry+'.md'),'utf8'));}
const pixelManifest=path.join(pixelDirectory,'manifest.json'),pixelPersonas=JSON.parse(fs.readFileSync(fs.existsSync(pixelManifest)?pixelManifest:path.join(__dirname,'..','characters','onggi-sprout','manifest.json'),'utf8')).personas;
fs.writeFileSync(path.join(pixelDirectory,'manifest.json'),JSON.stringify({schemaVersion:2,id:'onggi-pixel-bean',name:'픽셀 콩',description:'작은 표정으로 곁을 지키는 픽셀 친구',version:'1.0.0',author:'OnggiBot',source:'Original procedural SVG: scripts/create-characters.cjs',license:'Project character assets',size:{width:128,height:160},bubbleAnchor:{x:.7,y:.12},motion:'float',states:pixelStates,personas:pixelPersonas,animation:{canvas:{width:128,height:160},pivot:{x:.5,y:1},rendering:'pixel',blink:{loop:true,frames:[{file:'idle.svg',durationMs:4200},{file:'blink.svg',durationMs:120},{file:'idle.svg',durationMs:120}]}}},null,2)+'\n');
console.log('Generated original pixel buddy, seven states and one blink frame.');
