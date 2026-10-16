const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const STATES = ['idle', 'listening', 'thinking', 'replying', 'attention', 'error', 'sleeping'];

function loadPack(directory) {
  const root = fs.realpathSync(directory), manifestPath = path.join(root, 'manifest.json');
  if (fs.lstatSync(manifestPath).isSymbolicLink() || !fs.statSync(manifestPath).isFile() || fs.statSync(manifestPath).size > 65536) throw new Error('캐릭터 설명 파일의 경로·크기를 확인해주세요.');
  const manifestBytes=fs.readFileSync(manifestPath);if(manifestBytes.length>65536)throw Error('캐릭터 설명 파일 크기를 확인해주세요.');
  const manifest = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || ![1,2].includes(manifest.schemaVersion) || typeof manifest.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(manifest.id)) throw new Error('지원하지 않는 캐릭터 팩 형식입니다.');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || Array.from(manifest.name.trim().normalize('NFC')).length > 60) throw new Error('캐릭터 이름을 확인해주세요.');
  if (!manifest.states || typeof manifest.states !== 'object' || Array.isArray(manifest.states) || typeof manifest.states.idle !== 'string') throw new Error('기본 자세(idle)가 필요합니다.');
  const size = manifest.size ?? { width: 150, height: 180 };
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 60 || size.width > 220 || size.height < 60 || size.height > 220) throw new Error('캐릭터 크기는 60~220 범위여야 합니다.');
  const anchor = manifest.bubbleAnchor ?? { x: 0.5, y: 0.1 };
  if (![anchor.x, anchor.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('말풍선 위치는 0~1 범위여야 합니다.');
  let animation=null;
  if(manifest.schemaVersion===2){
    const a=manifest.animation;
    if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['canvas','pivot','rendering','blink'].includes(k))||!a.canvas||![a.canvas.width,a.canvas.height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=2048)||!a.pivot||![a.pivot.x,a.pivot.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||!['smooth','pixel'].includes(a.rendering)||!a.blink||typeof a.blink.loop!=='boolean'||!Array.isArray(a.blink.frames)||a.blink.frames.length<2||a.blink.frames.length>32)throw Error('지원하지 않는 캐릭터 팩 애니메이션 형식입니다.');
    if(Object.keys(a.canvas).some(k=>!['width','height'].includes(k))||Object.keys(a.pivot).some(k=>!['x','y'].includes(k))||Object.keys(a.blink).some(k=>!['loop','frames'].includes(k)))throw Error('애니메이션 필드를 확인해주세요.');
    let duration=0;
    for(const frame of a.blink.frames){if(!frame||Object.keys(frame).some(k=>!['file','durationMs'].includes(k))||typeof frame.file!=='string'||!Number.isSafeInteger(frame.durationMs)||frame.durationMs<42||frame.durationMs>10000)throw Error('프레임은 이미지와 42~10000ms 시간으로 지정해주세요.');duration+=frame.durationMs;}
    if(duration>60000)throw Error('한 동작은 60초 이하여야 합니다.');
    animation={canvas:{width:a.canvas.width,height:a.canvas.height},pivot:{x:a.pivot.x,y:a.pivot.y},rendering:a.rendering,blink:{loop:a.blink.loop,frames:a.blink.frames.map(f=>({...f}))}};
  }
  const assets = {}, animationFrames=[], contents = new Map(), imageFiles = [], canonical = new Map(), states = {};
  let personas = null, total = 0, pixels = 0;
  if (manifest.personas) {
    const config = manifest.personas;
    if (typeof config.base !== 'string' || !Array.isArray(config.modes) || config.modes.length < 1 || config.modes.length > 8) throw Error('페르소나 구성을 확인해주세요.');
    const entries = [{id:'base',name:'기본 성격',file:config.base}, ...config.modes], seen = new Set();
    personas = [];
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(entry.id) || seen.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() || Array.from(entry.name.trim().normalize('NFC')).length > 60 || /[\u0000-\u001f\u007f-\u009f]/u.test(entry.name) || typeof entry.file !== 'string' || path.isAbsolute(entry.file) || path.extname(entry.file) !== '.md') throw Error('페르소나 파일 구성이 올바르지 않습니다.');
      const file = fs.realpathSync(path.resolve(root, entry.file));
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile() || fs.statSync(file).size > 16384) throw Error('페르소나는 팩 내부의 16KiB 이하 MD 파일이어야 합니다.');
      const relative = path.relative(root,file).split(path.sep).join('/'), bytes = fs.readFileSync(file), text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(bytes.length>16384)throw Error('페르소나는 16KiB 이하 MD 파일이어야 합니다.');
      if (!text.trim() || text.includes('\u0000')) throw Error('페르소나 내용을 확인해주세요.');
      personas.push({id:entry.id,name:entry.name.trim().normalize('NFC'),description:String(entry.description ?? '').slice(0,160),text,file:relative});
      contents.set(relative,bytes); seen.add(entry.id);
    }
  }
  const references=[...STATES.map(state=>({state,file:manifest.states[state]??manifest.states.idle})),...(animation?.blink.frames??[]).map((frame,index)=>({index,file:frame.file}))];
  for (const reference of references) {
    const relative = reference.file;
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\u0000')) throw new Error('캐릭터 이미지 경로가 올바르지 않습니다.');
    const file = fs.realpathSync(path.resolve(root,relative));
    if (!file.startsWith(root + path.sep)) throw new Error('팩 외부 파일은 사용할 수 없습니다.');
    const normalized = path.relative(root,file).split(path.sep).join('/'), extension = path.extname(file).toLowerCase(), mime = {'.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'}[extension];
    if (!mime || !fs.statSync(file).isFile() || fs.statSync(file).size > 3 * 1024 * 1024) throw new Error('이미지는 SVG, PNG, WebP로 최대 3MB까지 지원합니다.');
    if (!canonical.has(file)) {
      const content = fs.readFileSync(file);
      if(content.length>3*1024*1024)throw Error('이미지는 최대 3MB까지 지원합니다.');
      let width = null, height = null, frameCount = 1;
      if (extension === '.svg') {
        const text = new TextDecoder('utf-8',{fatal:true}).decode(content);
        if (!/<svg\b/i.test(text)) throw new Error('SVG 이미지 형식을 확인해주세요.');
        if (/<\s*(?:[\w.-]+:)?(?:style|script|foreignObject|iframe|animate\w*|set)\b|\bstyle\s*=|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|\b(?:href|src)\s*=|url\s*\(/i.test(text)) throw new Error('SVG의 실행 코드·style·외부 참조·자동 재생은 사용할 수 없습니다. 단순 속성이나 PNG/WebP로 내보내주세요.');
      } else if (extension === '.png') {
        if (content.length < 45 || !content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('PNG 이미지 형식을 확인해주세요.');
        let offset = 8, header = false, data = false, ended = false;
        while (offset < content.length) {
          if (offset + 12 > content.length) throw new Error('PNG chunk가 잘렸습니다.');
          const length = content.readUInt32BE(offset), type = content.toString('ascii',offset+4,offset+8), end = offset + length + 12;
          if (end > content.length || (!header && type !== 'IHDR')) throw new Error('PNG chunk 구성이 올바르지 않습니다.');
          if (type === 'IHDR') {
            if (header || length !== 13) throw new Error('PNG 크기 정보가 올바르지 않습니다.');
            width = content.readUInt32BE(offset+8); height = content.readUInt32BE(offset+12); header = true;
            if (![0,2,3,4,6].includes(content[offset+17]) || ![1,2,4,8,16].includes(content[offset+16]) || content[offset+18] || content[offset+19] || content[offset+20] > 1) throw new Error('PNG 헤더를 확인해주세요.');
          }
          if (type === 'IDAT') data = true;
          if (type === 'acTL') { if (length !== 8) throw new Error('PNG 프레임 정보를 확인해주세요.'); frameCount = content.readUInt32BE(offset+8); }
          if (type === 'IEND') { if (length || end !== content.length) throw new Error('PNG 끝을 확인해주세요.'); ended = true; }
          offset = end;
        }
        if (!header || !data || !ended) throw new Error('PNG 이미지가 완전하지 않습니다.');
      } else {
        if (content.length < 20 || content.toString('ascii',0,4) !== 'RIFF' || content.toString('ascii',8,12) !== 'WEBP' || content.readUInt32LE(4) + 8 !== content.length) throw new Error('WebP 이미지 형식을 확인해주세요.');
        let offset = 12, hasImage = false, animation = false, frames = 0;
        while (offset < content.length) {
          if (offset + 8 > content.length) throw new Error('WebP chunk가 잘렸습니다.');
          const type = content.toString('ascii',offset,offset+4), length = content.readUInt32LE(offset+4), start = offset+8, end = start+length;
          if (end + (length % 2) > content.length) throw new Error('WebP chunk 크기를 확인해주세요.');
          if (type === 'VP8X') {
            if (length !== 10 || width !== null) throw new Error('WebP 확장 헤더를 확인해주세요.');
            width = content.readUIntLE(start+4,3)+1; height = content.readUIntLE(start+7,3)+1; animation = Boolean(content[start] & 2);
          } else if (type === 'VP8 ') {
            if (length < 10 || !content.subarray(start+3,start+6).equals(Buffer.from([157,1,42]))) throw new Error('WebP VP8 헤더를 확인해주세요.');
            if (width === null) { width = content.readUInt16LE(start+6)&16383; height = content.readUInt16LE(start+8)&16383; } hasImage = true;
          } else if (type === 'VP8L') {
            if (length < 5 || content[start] !== 47) throw new Error('WebP VP8L 헤더를 확인해주세요.');
            if (width === null) { const bits=content.readUInt32LE(start+1); width=(bits&16383)+1;height=((bits>>>14)&16383)+1; } hasImage = true;
          } else if (type === 'ANMF') { if (length < 16) throw new Error('WebP 프레임이 잘렸습니다.'); frames++;hasImage=true; }
          offset = end + (length % 2);
        }
        if (!hasImage || (animation && !frames)) throw new Error('WebP 이미지가 완전하지 않습니다.');
        frameCount = animation ? frames : 1;
      }
      if (extension !== '.svg') {
        if (![width,height,frameCount].every(Number.isSafeInteger) || width < 1 || height < 1 || width > 2048 || height > 2048 || frameCount < 1 || frameCount > 32) throw new Error('이미지는 2048×2048 이하, 최대 32프레임이어야 합니다.');
        pixels += width * height * frameCount;
        if (pixels > 8388608) throw new Error('팩의 이미지 픽셀 예산을 초과했습니다.');
      }
      total += content.length;
      if (total > 24 * 1024 * 1024) throw new Error('캐릭터 팩이 너무 큽니다.');
      const source = `data:${mime};base64,${content.toString('base64')}`;
      canonical.set(file,source); contents.set(normalized,content); imageFiles.push({file:normalized,source,width,height,frameCount,animated:frameCount>1});
    }
    if(reference.state){states[reference.state]=normalized;assets[reference.state]=canonical.get(file);}
    else{animation.blink.frames[reference.index].file=normalized;animationFrames[reference.index]=canonical.get(file);}
  }
  const metadata = {schemaVersion:manifest.schemaVersion,id:manifest.id,name:manifest.name,description:String(manifest.description ?? '').slice(0,240),version:String(manifest.version ?? '1.0.0').slice(0,30),size,bubbleAnchor:anchor,motion:['sway','bounce','float'].includes(manifest.motion)?manifest.motion:'sway',states,...(animation?{animation}:{}),
    ...(personas?{personas:{base:personas[0].file,modes:personas.slice(1).map(({id,name,file,description})=>({id,name,file,description}))}}:{}),
    author:String(manifest.author??'').slice(0,120),source:String(manifest.source??'').slice(0,300),license:String(manifest.license??'').slice(0,300)};
  const hash = createHash('sha256').update(JSON.stringify(metadata));
  for (const [file,bytes] of contents) hash.update(file).update(bytes);
  return {manifest:metadata,assets,animationFrames,personas,files:[...contents.keys()],contents,imageFiles,revision:hash.digest('hex'),root};
}
module.exports = { loadPack, STATES };
