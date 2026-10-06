const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
require('esbuild').buildSync({entryPoints:[path.join(root,'src','ui','renderer.mjs')],outfile:path.join(root,'src','ui','renderer.bundle.js'),bundle:true,platform:'browser',format:'iife',target:'chrome120',minify:true,legalComments:'external'});
const pending=Object.keys(require('../package.json').dependencies).map(name=>path.join(root,'node_modules',name)),seen=new Set(),notices=[];
while(pending.length){
  const directory=pending.shift();if(seen.has(directory))continue;seen.add(directory);
  const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
  const licenses=fs.readdirSync(directory).filter(file=>/^(licen[sc]e|copying|notice)(?:[.-]|$)/i.test(file)&&fs.statSync(path.join(directory,file)).isFile());
  if(!licenses.length)throw new Error('라이브러리 라이선스 파일을 확인해주세요: '+pkg.name);
  notices.push(pkg.name+' '+pkg.version+'\n'+licenses.map(file=>file+'\n'+fs.readFileSync(path.join(directory,file),'utf8')).join('\n'));
  for(const name of Object.keys(pkg.dependencies??{})){
    const nested=path.join(directory,'node_modules',name);pending.push(fs.existsSync(nested)?nested:path.join(root,'node_modules',name));
  }
}
const mit=fs.readFileSync(path.join(root,'node_modules','markdown-it','LICENSE'),'utf8');
notices.push('regenerator-runtime (embedded in DOMPurify)\nCopyright (c) 2014-present, Facebook, Inc.\n'+mit.slice(mit.indexOf('Permission is hereby granted')));
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),'Renderer bundle third-party notices\n\n'+notices.join('\n\n────────────────────\n\n'));
console.log('RENDERER_BUNDLE_OK');
