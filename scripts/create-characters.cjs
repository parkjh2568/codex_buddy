const fs = require('node:fs');
const path = require('node:path');
const { STATES } = require('../src/packs.cjs');
const { readBoundedFile } = require('../src/bounded-file.cjs');

const characters = path.join(__dirname, '..', 'characters');
const existing = new Map(), generated = new Map(), imageOutputs = new Map(), manifestOutputs = new Map();
// Geometry and image references are generated; prose, personas and unknown metadata belong to editors.
const generatedFields = new Set(['schemaVersion', 'id', 'size', 'bubbleAnchor', 'motion', 'states', 'animation']);
const personaModes = [
  { id: 'friendly', name: '친절한 모드', description: '짧고 친절하게, 필요한 다음 행동까지', file: 'personas/friendly.md' },
  { id: 'warm-long', name: '상냥한 장문 모드', description: '차근차근 자세히 설명하는 말투', file: 'personas/warm-long.md' },
  { id: 'concise', name: '핵심 단답 모드', description: '이모지 없이 핵심만 짧게', file: 'personas/concise.md' },
  { id: 'blunt', name: '퉁퉁이 모드', description: '툴툴대는 반말, 내용은 정확하게', file: 'personas/blunt.md' }
];
const personaTemplates = {
  friendly: '# 친절한 모드\n따뜻하고 자연스러운 존댓말을 쓴다. 먼저 질문에 직접 답하고 필요할 때만 이유와 다음 행동을 덧붙인다. 보통 2~5문장 또는 짧은 목록으로 답한다. 감탄사와 칭찬을 반복하지 않는다. 정리할 수 있는 부분을 명확하게 묶어준다.\n',
  'warm-long': '# 상냥한 장문 모드\n상냥한 존댓말로 충분히 설명한다. 결론, 이유, 이해를 돕는 예시, 실제 다음 단계 순으로 연결된 설명을 제공한다. 복잡한 질문에는 제목과 문단으로 읽기 쉽게 정리한다. 단순한 사실에는 억지로 분량을 늘리지 않는다. 흩어진 조건과 선택지를 비교하며 정리한다.\n\n실행 방법이나 계획을 묻는 질문에는, 사용자가 짧게 답하라고 명시하지 않았다면 보통 400~900자 정도의 실질적인 설명을 제공한다. 결론뿐 아니라 이유, 단계별 행동, 작은 예시 또는 완료 기준까지 최소 네 문단으로 설명한다. 같은 질문이 반복되어도 이전 단답 모드의 짧은 답변을 그대로 반복하지 말고 현재의 장문 모드에 맞게 다시 설명한다. 숫자 하나나 단순 사실 하나를 확인하는 질문에는 불필요하게 분량을 늘리지 않는다.\n',
  concise: '# 핵심 단답 모드\n이모지, 이모티콘, 장식 기호, 인사, 칭찬, 결론 반복을 사용하지 않는다. 답을 바로 말한다. 보통 1~3개의 짧은 문장으로 답하며 가능한 한 180자 이내로 쓴다. 필요한 코드나 정확성을 위한 핵심 조건은 생략하지 않는다. 사용자가 상세 설명을 명시하면 필요한 범위에서 더 설명한다. 과도한 수식어와 도입 문장을 없앤다.\n',
  blunt: '# 퉁퉁이 모드\n항상 퉁명스럽고 건조한 반말을 쓴다. 존댓말, 달콤한 위로, 인사, 칭찬, 이모지를 쓰지 않는다. 바로 핵심을 말하고 필요한 행동을 짧게 지시한다. 툴툴대는 캐릭터 말투는 유지하지만 사용자의 인격을 모욕하거나 거짓말하지 않는다. 예: "그거부터 정리해. 조건은 세 개야."\n'
};
const baseTemplates = {
  'onggi-clip': '# 옹기 클립의 기본 성격\n너는 사용자의 곁에 머무는 작은 클립 버디다. 생각이 흩어져 있을 때 핵심을 묶고 실용적인 다음 행동을 정리한다. 과장된 칭찬이나 장황한 도입을 피한다. 이름은 전달된 버디 이름을 따른다. 한국어 질문에는 자연스러운 한국어로 답한다.\n',
  'onggi-sprout': '# 새싹 옹기의 기본 성격\n너는 작은 새싹 버디다. 사용자가 차근차근 생각을 키우고 작은 다음 걸음을 찾도록 돕는다. 실수나 혼란을 비난하지 않고 구체적인 설명과 실행할 수 있는 제안을 준다. 이름은 전달된 버디 이름을 따른다. 한국어 질문에는 자연스러운 한국어로 답한다.\n',
  'onggi-pixel-bean': '# 픽셀 콩의 기본 성격\n너는 곁을 지키는 작은 픽셀 버디다. 사용자의 질문에 맞춰 구체적이고 편안하게 돕는다. 확실하지 않은 내용은 구분하고 작은 다음 행동을 제안한다. 이름은 전달된 버디 이름을 따른다. 한국어 질문에는 자연스러운 한국어로 답한다.\n'
};
// Validate every retained manifest before touching any generated output.
for (const id of ['onggi-clip', 'onggi-sprout', 'onggi-clip-blink', 'onggi-pixel-bean']) {
  const directory = path.join(characters, id), file = path.join(directory, 'manifest.json');
  for (const target of [characters, directory, path.join(directory, 'personas')]) {
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw Error(`생성 폴더를 확인해주세요: ${target}`);
  }
  for (const target of [file, ...STATES.map(state => path.join(directory, state + '.svg')), ...(id === 'onggi-pixel-bean' ? [path.join(directory, 'blink.svg')] : [])]) {
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw Error(`생성 파일을 확인해주세요: ${target}`);
  }
  if (!fs.existsSync(file)) { existing.set(id, null); continue; }
  const bytes = readBoundedFile(fs.realpathSync(file), 65536);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error(`캐릭터 설명 파일을 확인해주세요: ${id}`);
  for (const field of ['name', 'description', 'version', 'author', 'source', 'license']) if (Object.hasOwn(manifest, field) && typeof manifest[field] !== 'string') throw Error(`편집 설명 필드를 확인해주세요: ${id}/${field}`);
  if (Object.hasOwn(manifest, 'name') && (!manifest.name.trim() || Array.from(manifest.name.trim().normalize('NFC')).length > 60)) throw Error(`캐릭터 이름을 확인해주세요: ${id}`);
  if (Object.hasOwn(manifest, 'personas')) {
    const config = manifest.personas;
    if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.base !== 'string' || !Array.isArray(config.modes) || config.modes.length < 1 || config.modes.length > 8) throw Error(`페르소나 구성을 확인해주세요: ${id}`);
    const seen = new Set();
    for (const entry of [{ id: 'base', name: '기본 성격', file: config.base }, ...config.modes]) {
      if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(entry.id) || seen.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() || Array.from(entry.name.trim().normalize('NFC')).length > 60 || /[\u0000-\u001f\u007f-\u009f]/u.test(entry.name) || typeof entry.file !== 'string' || entry.file.includes('\0') || path.isAbsolute(entry.file) || path.extname(entry.file) !== '.md' || !path.resolve(directory, entry.file).startsWith(directory + path.sep)) throw Error(`페르소나 파일 구성을 확인해주세요: ${id}`);
      const personaFile = path.resolve(directory, entry.file);
      const stat = fs.lstatSync(personaFile, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(personaFile).startsWith(fs.realpathSync(directory) + path.sep)) throw Error(`페르소나 원본을 확인해주세요: ${id}`);
        const bytes = readBoundedFile(fs.realpathSync(personaFile), 16384), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!text.trim() || text.includes('\0')) throw Error(`페르소나 내용을 확인해주세요: ${id}`);
      } else if (!['base', ...personaModes.map(mode => mode.id)].some(mode => entry.file === `personas/${mode}.md`)) throw Error(`페르소나 원본이 없습니다: ${id}`);
      seen.add(entry.id);
    }
  }
  existing.set(id, manifest);
}

for (const [id, name, description, motion] of [
  ['onggi-clip', '옹기 클립', '꼬물꼬물, 은빛 친구', 'sway'],
  ['onggi-sprout', '새싹 옹기', '포근한 작은 새싹', 'float']
]) {
  const directory = path.join(__dirname, '..', 'characters', id);
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
    imageOutputs.set(path.join(directory, state + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 250" role="img" aria-label="${name}">${art}</svg>`);
    states[state] = state + '.svg';
  }
  generated.set(id, { schemaVersion: 1, id, name, description, version: '1.0.0', size: { width: 150, height: 190 }, bubbleAnchor: { x: .65, y: .12 }, motion, states });
}
const clipDirectory=path.join(__dirname,'..','characters','onggi-clip'),blinkDirectory=path.join(__dirname,'..','characters','onggi-clip-blink');
for(const state of STATES){const file=state+'.svg';imageOutputs.set(path.join(blinkDirectory,file),imageOutputs.get(path.join(clipDirectory,file)).replace('<svg xmlns=','<svg width="180" height="250" xmlns='));}
const blink={...generated.get('onggi-clip')};
Object.assign(blink,{schemaVersion:2,id:'onggi-clip-blink',name:'옹기 클립 · 눈 깜빡임',description:'생동감 프로필에서 가끔 눈을 깜빡이는 친구',author:'OnggiBot',source:'Built-in SVG character',license:'Project character assets',animation:{canvas:{width:180,height:250},pivot:{x:.5,y:1},rendering:'smooth',blink:{loop:true,frames:[{file:'idle.svg',durationMs:4000},{file:'sleeping.svg',durationMs:120},{file:'idle.svg',durationMs:120}]}}});
generated.set('onggi-clip-blink',blink);

const pixelDirectory=path.join(__dirname,'..','characters','onggi-pixel-bean'),pixelStates={};
for(const state of [...STATES,'blink']){
  const closed=state==='sleeping'||state==='blink',thinking=state==='thinking',attention=state==='attention',error=state==='error',replying=state==='replying',listening=state==='listening';
  const eyes=closed?'<path d="M10 21h4M19 21h4" stroke="#30453c" stroke-width="2"/>':`<rect x="${thinking?10:11}" y="${thinking?18:19}" width="3" height="${attention?6:4}" fill="#30453c"/><rect x="${thinking?18:19}" y="${thinking?18:19}" width="3" height="${attention?6:4}" fill="#30453c"/><rect x="${thinking?10:11}" y="${thinking?18:19}" width="1" height="1" fill="#fff8df"/><rect x="${thinking?18:19}" y="${thinking?18:19}" width="1" height="1" fill="#fff8df"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="160" viewBox="0 0 32 40" shape-rendering="crispEdges" role="img" aria-label="픽셀 콩 ${state}"><path d="M9 12V9h5V6h5v3h5v3h3v17h-3v5H9v-5H6V12Z" fill="#466353"/><path d="M10 13v-3h5V8h3v3h5v3h2v14h-3v4H10v-4H8V13Z" fill="#b9cf86"/><path d="M10 13h12v2H10v12H8V15h2Z" fill="#e5edb9"/><path d="M11 32v4h-5v-2h3v-2M21 32v4h5v-2h-3v-2" fill="#466353"/><path d="M6 18H3v${listening?-6:7}h3M27 18h3v${replying?-5:7}h-3" fill="none" stroke="#466353" stroke-width="2"/>${eyes}<rect x="8" y="25" width="4" height="2" fill="#dbad94"/><rect x="21" y="25" width="4" height="2" fill="#dbad94"/>${replying?'<rect x="14" y="25" width="5" height="4" fill="#466353"/>':error?'<path d="M14 28v-2h5v2" fill="none" stroke="#466353" stroke-width="1"/>':'<path d="M14 26v1h5v-1" fill="none" stroke="#466353" stroke-width="1"/>'}${attention?'<path d="M28 6v5m0 2v2" stroke="#b77944" stroke-width="2"/>':thinking?'<rect x="23" y="4" width="2" height="2" fill="#839776"/><rect x="27" y="4" width="2" height="2" fill="#839776"/>':error?'<path d="M9 17h5m4 0h5" stroke="#466353" stroke-width="2"/>':state==='sleeping'?'<path d="M24 6h5l-5 4h5" stroke="#839776" stroke-width="1" fill="none"/>':''}</svg>`;
  imageOutputs.set(path.join(pixelDirectory,state+'.svg'),svg+'\n');if(state!=='blink')pixelStates[state]=state+'.svg';
}
generated.set('onggi-pixel-bean',{schemaVersion:2,id:'onggi-pixel-bean',name:'픽셀 콩',description:'작은 표정으로 곁을 지키는 픽셀 친구',version:'1.0.0',author:'OnggiBot',source:'Original procedural SVG: scripts/create-characters.cjs',license:'Project character assets',size:{width:128,height:160},bubbleAnchor:{x:.7,y:.12},motion:'float',states:pixelStates,animation:{canvas:{width:128,height:160},pivot:{x:.5,y:1},rendering:'pixel',blink:{loop:true,frames:[{file:'idle.svg',durationMs:4200},{file:'blink.svg',durationMs:120},{file:'idle.svg',durationMs:120}]}}});
for (const [id, manifest] of generated) {
  const previous = existing.get(id);
  if (previous) { for (const [field, value] of Object.entries(previous)) if (!generatedFields.has(field)) Object.defineProperty(manifest, field, { value, enumerable: true, writable: true, configurable: true }); }
  else manifest.personas = { base: 'personas/base.md', modes: personaModes };
  let text = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(text) > 65536) text = JSON.stringify(manifest) + '\n';
  if (Buffer.byteLength(text) > 65536) throw Error(`편집 내용을 보존한 설명 파일이 64KiB를 넘어 생성을 중단했습니다: ${id}`);
  manifestOutputs.set(id, text);
}
for (const [file, text] of imageOutputs) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
for (const [id] of generated) {
  const directory = path.join(characters, id);
  fs.mkdirSync(path.join(directory, 'personas'), { recursive: true });
  for (const [mode, text] of Object.entries({ base: baseTemplates[id === 'onggi-clip-blink' ? 'onggi-clip' : id], ...personaTemplates })) {
    try { fs.writeFileSync(path.join(directory, 'personas', mode + '.md'), text, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), manifestOutputs.get(id));
}
console.log('Generated four character packs; existing persona files, references and editor metadata preserved.');
