const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPack } = require('../src/packs.cjs');
for (const directory of ['src','scripts','test']) {
  for (const file of fs.readdirSync(path.join(__dirname,'..',directory), { recursive: true })) {
    if (!/\.(cjs|js|mjs)$/.test(file)) continue;
    const checked = spawnSync(process.execPath, ['--check', path.join(directory,file)], { cwd: path.join(__dirname,'..'), encoding:'utf8' });
    if (checked.status !== 0) { console.error(checked.stderr); process.exit(1); }
  }
}
for (const directory of fs.readdirSync(path.join(__dirname,'..','characters'))) {
  const loaded = loadPack(path.join(__dirname,'..','characters',directory));
  console.log(`PACK_OK ${loaded.manifest.id} (${Object.keys(loaded.assets).length} states)`);
}
console.log('Syntax and built-in character packs verified.');
