const fs=require('node:fs');
const path=require('node:path');
function loadSkins(directory){
  const root=fs.realpathSync(directory),keys=['cream','text','muted','line','surface','wash','green','accentInk','field','danger'],skins=[];
  for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.json')).sort()){
    const file=path.join(root,name);
    if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>32768)throw Error('스킨 파일을 확인해주세요.');
    const skin=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!skin||typeof skin!=='object'||Array.isArray(skin)||typeof skin.id!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(skin.id)||skins.some(s=>s.id===skin.id)||typeof skin.name!=='string'||!skin.name.trim()||skin.name.length>60||!skin.colors||Object.keys(skin.colors).length!==keys.length||!keys.every(k=>typeof skin.colors[k]==='string'&&/^#[a-f0-9]{6}$/i.test(skin.colors[k])))throw Error('스킨은 이름과 허용된 색상만 담은 JSON이어야 합니다.');
    skins.push(skin);
  }
  if(!skins.some(s=>s.id==='paper'))throw Error('기본 paper 스킨이 필요합니다.');
  return skins;
}
module.exports={loadSkins};
