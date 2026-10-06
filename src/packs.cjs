const fs = require('node:fs');
const path = require('node:path');

const STATES = ['idle', 'listening', 'thinking', 'replying', 'attention', 'error', 'sleeping'];

function loadPack(directory) {
  const root = fs.realpathSync(directory);
  const manifestPath = path.join(root, 'manifest.json');
  if (fs.statSync(manifestPath).size > 65536) throw new Error('캐릭터 설명 파일이 너무 큽니다.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !/^[a-z][a-z0-9-]{0,47}$/.test(manifest.id)) throw new Error('지원하지 않는 캐릭터 팩 형식입니다.');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 60) throw new Error('캐릭터 이름을 확인해주세요.');
  if (!manifest.states || typeof manifest.states.idle !== 'string') throw new Error('기본 자세(idle)가 필요합니다.');
  const size = manifest.size ?? { width: 150, height: 180 };
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width < 60 || size.width > 220 || size.height < 60 || size.height > 220) throw new Error('캐릭터 크기는 60~220 범위여야 합니다.');
  const anchor = manifest.bubbleAnchor ?? { x: 0.5, y: 0.1 };
  if (![anchor.x, anchor.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('말풍선 위치는 0~1 범위여야 합니다.');
  const assets = {}, files = new Set();
  let total = 0;
  for (const state of STATES) {
    const relative = manifest.states[state] ?? manifest.states.idle;
    if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('캐릭터 이미지 경로가 올바르지 않습니다.');
    const file = fs.realpathSync(path.resolve(root, relative));
    if (!file.startsWith(root + path.sep)) throw new Error('팩 외부 파일은 사용할 수 없습니다.');
    const extension = path.extname(file).toLowerCase();
    const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }[extension];
    if (!mime || !fs.statSync(file).isFile() || fs.statSync(file).size > 3 * 1024 * 1024) throw new Error('이미지는 SVG, PNG, WebP로 최대 3MB까지 지원합니다.');
    const content = fs.readFileSync(file);
    if (extension === '.svg' && /<\s*(script|foreignObject|iframe)|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|\b(?:href|src)\s*=|url\s*\(/i.test(content.toString())) throw new Error('외부 참조나 실행 코드가 포함된 SVG는 사용할 수 없습니다.');
    if (!files.has(relative)) total += content.length;
    if (total > 24 * 1024 * 1024) throw new Error('캐릭터 팩이 너무 큽니다.');
    files.add(relative);
    assets[state] = `data:${mime};base64,${content.toString('base64')}`;
  }
  return { manifest: { schemaVersion: 1, id: manifest.id, name: manifest.name, description: String(manifest.description ?? '').slice(0,240), version: String(manifest.version ?? '1.0.0').slice(0,30), size, bubbleAnchor: anchor, motion: ['sway', 'bounce', 'float'].includes(manifest.motion) ? manifest.motion : 'sway', states: manifest.states }, assets, files: [...files], root };
}

module.exports = { loadPack, STATES };
