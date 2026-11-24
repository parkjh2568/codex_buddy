const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { loadPack, STATES } = require('../src/packs.cjs');

const ids = ['onggi-clip', 'onggi-sprout', 'onggi-clip-blink', 'onggi-pixel-bean'];
const source = path.join(__dirname, '../scripts/create-characters.cjs');

function fixture(t, copy = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onggi-generator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.copyFileSync(source, path.join(root, 'scripts/create-characters.cjs'));
  fs.writeFileSync(path.join(root, 'src/packs.cjs'), `module.exports = require(${JSON.stringify(path.join(__dirname, '../src/packs.cjs'))});\n`);
  fs.writeFileSync(path.join(root, 'src/bounded-file.cjs'), `module.exports = require(${JSON.stringify(path.join(__dirname, '../src/bounded-file.cjs'))});\n`);
  if (copy) fs.cpSync(path.join(__dirname, '../characters'), path.join(root, 'characters'), { recursive: true });
  return root;
}

function snapshot(root) {
  const files = {};
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, entry), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) files[entry] = 'link:' + fs.readlinkSync(file);
    else if (stat.isFile()) files[entry] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return files;
}

test('character regeneration preserves each independent persona, metadata and extra file across two runs', t => {
  const root = fixture(t), characters = path.join(root, 'characters'), retained = {};
  for (const id of ids) {
    const directory = path.join(characters, id), file = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.name = `${id} 편집 이름`; manifest.description = `${id} 설명`;
    manifest.version = '9.2-editor'; manifest.author = id; manifest.source = `${id} original`; manifest.license = `${id} license`;
    manifest.editorNotes = { keep: id }; Object.defineProperty(manifest, '__proto__', { value: { keep: id }, enumerable: true });
    manifest.personas.base = 'personas/independent-base.md';
    manifest.personas.modes.push({ id: 'extra-mode', name: `${id} 추가 모드`, file: 'personas/extra.md', description: '독립 편집' });
    fs.writeFileSync(file, JSON.stringify(manifest));
    for (const name of ['base', 'friendly', 'warm-long', 'concise', 'blunt', 'independent-base', 'extra']) fs.writeFileSync(path.join(directory, 'personas', name + '.md'), `${id}: 편집된 ${name}\n`);
    fs.mkdirSync(path.join(directory, 'notes'));
    fs.writeFileSync(path.join(directory, 'notes/private.txt'), Buffer.from([0, 1, 254, 255]));
    fs.writeFileSync(path.join(directory, 'handmade.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><text>${id}</text></svg>`);
    retained[id] = { manifest, files: snapshot(directory) };
    fs.writeFileSync(path.join(directory, 'idle.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  }
  const result = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const id of ids) {
    const directory = path.join(characters, id), manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    for (const field of ['name', 'description', 'version', 'author', 'source', 'license', 'editorNotes', '__proto__', 'personas']) assert.deepEqual(manifest[field], retained[id].manifest[field], `${id}/${field}`);
    for (const [file, hash] of Object.entries(retained[id].files)) if (file.endsWith('.md') || file === 'handmade.svg' || file.startsWith('notes/')) assert.equal(snapshot(directory)[file], hash, `${id}/${file}`);
    assert.equal(manifest.id, id); assert.equal(manifest.schemaVersion, id.includes('blink') || id.includes('pixel') ? 2 : 1);
    assert.deepEqual(Object.keys(manifest.states), STATES); assert.ok(loadPack(directory).personas.some(mode => mode.id === 'extra-mode'));
  }
  const first = snapshot(characters);
  const repeated = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(repeated.status, 0, repeated.stderr); assert.deepEqual(snapshot(characters), first);
  for (const id of ids) assert.equal(loadPack(path.join(characters, id)).manifest.id, id);
});

test('missing provided templates are created exclusively and fresh generation produces four loadable stable packs', t => {
  const root = fixture(t, false), characters = path.join(root, 'characters');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const id of ids) { const pack = loadPack(path.join(characters, id)); assert.equal(pack.personas.length, 5); assert.equal(pack.manifest.id, id); }
  }
  const before = snapshot(characters), target = path.join(characters, 'onggi-clip-blink/personas/friendly.md');
  fs.unlinkSync(target);
  const script = path.join(root, 'scripts/create-characters.cjs'), requireFromScript = createRequire(script);
  let raced = false;
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), { __dirname: path.dirname(script), TextDecoder, Buffer, console: { log() {} }, require: name => name === 'node:fs' ? { ...fs, writeFileSync(file, data, options) {
    if (file === target && options?.flag === 'wx') { raced = true; fs.writeFileSync(file, '다른 편집기가 방금 만든 원본\n'); }
    return fs.writeFileSync(file, data, options);
  } } : requireFromScript(name) });
  assert.equal(raced, true); assert.equal(fs.readFileSync(target, 'utf8'), '다른 편집기가 방금 만든 원본\n');
  const after = snapshot(characters);
  for (const [file, hash] of Object.entries(before)) if (path.join(characters, file) !== target) assert.equal(after[file], hash);
  for (const id of ids) loadPack(path.join(characters, id));
});

test('malformed retained manifests stop before modifying any pack', t => {
  const root = fixture(t), characters = path.join(root, 'characters'), file = path.join(characters, 'onggi-pixel-bean/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const invalid = [Buffer.from('{'), Buffer.from([255]), 'null', '[]', JSON.stringify({ ...manifest, name: false }), JSON.stringify({ ...manifest, personas: null }), JSON.stringify({ ...manifest, personas: { base: 'personas/base.md', modes: [null] } }), JSON.stringify({ ...manifest, personas: { base: '../outside.md', modes: manifest.personas.modes } }), JSON.stringify({ ...manifest, personas: { base: 'personas/missing-custom.md', modes: manifest.personas.modes } }), ' '.repeat(65537)];
  for (const bytes of invalid) {
    fs.writeFileSync(file, bytes); const before = snapshot(characters);
    const result = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND/); assert.deepEqual(snapshot(characters), before);
  }
});

test('near-limit editor metadata remains loadable and an oversized generated manifest stops before all writes', t => {
  const root = fixture(t), characters = path.join(root, 'characters'), directory = path.join(characters, 'onggi-pixel-bean'), file = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.editorNotes = ''; manifest.editorNotes = 'x'.repeat(65533 - Buffer.byteLength(JSON.stringify(manifest)));
  fs.writeFileSync(file, JSON.stringify(manifest)); assert.equal(fs.statSync(file).size, 65533); loadPack(directory);
  const result = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(fs.statSync(file).size <= 65536);
  assert.equal(JSON.parse(fs.readFileSync(file)).editorNotes, manifest.editorNotes); loadPack(directory);
  const first = snapshot(characters), repeated = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(repeated.status, 0, repeated.stderr); assert.deepEqual(snapshot(characters), first);
  const minimal = { schemaVersion: 1, id: 'onggi-pixel-bean', name: '보존할 편집', states: { idle: 'idle.svg' }, editorNotes: '' };
  minimal.editorNotes = 'x'.repeat(65533 - Buffer.byteLength(JSON.stringify(minimal))); fs.writeFileSync(file, JSON.stringify(minimal)); loadPack(directory);
  const before = snapshot(characters), blocked = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /64KiB/); assert.deepEqual(snapshot(characters), before);
});

test('generator refuses linked output targets and preserves external originals', t => {
  for (const kind of ['manifest-link', 'svg-link', 'dangling-link', 'hardlink', 'directory-link', 'persona-dangling-link']) {
    const root = fixture(t), characters = path.join(root, 'characters'), directory = path.join(characters, 'onggi-pixel-bean');
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    const original = path.join(outside, 'original.txt'); fs.writeFileSync(original, '외부 원본\n');
    if (kind === 'directory-link') { fs.rmSync(path.join(directory, 'personas'), { recursive: true }); fs.symlinkSync(outside, path.join(directory, 'personas')); }
    else {
      const target = path.join(directory, kind === 'manifest-link' ? 'manifest.json' : kind === 'persona-dangling-link' ? 'personas/friendly.md' : 'idle.svg'); fs.unlinkSync(target);
      if (kind === 'hardlink') fs.linkSync(original, target); else fs.symlinkSync(['dangling-link', 'persona-dangling-link'].includes(kind) ? path.join(outside, 'missing.svg') : original, target);
    }
    const before = snapshot(characters);
    const result = spawnSync(process.execPath, ['scripts/create-characters.cjs'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, kind); assert.match(result.stderr, /생성 (파일|폴더)[을를] 확인|페르소나 원본을 확인/); assert.deepEqual(snapshot(characters), before); assert.equal(fs.readFileSync(original, 'utf8'), '외부 원본\n'); assert.equal(fs.existsSync(path.join(outside, 'missing.svg')), false);
  }
});
