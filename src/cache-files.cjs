const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setImmediate } = require('node:timers/promises');

const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
const cacheLimit = 512 * 1024 * 1024;
const activeWrites = new Map();

function sameFile(a, b) {
  return a.isFile() && b.isFile() &&
    ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
}

function readBoundedFile(file, { limit, expectedSize, observed, changed, oversized }) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || (observed && !sameFile(before, observed))) throw Error(changed);
  if (before.size > limit || (expectedSize !== undefined && before.size !== expectedSize)) throw Error(oversized);
  const fd = fs.openSync(file, openFlags);
  try {
    if (!sameFile(before, fs.fstatSync(fd))) throw Error(changed);
    const buffer = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const length = fs.readSync(fd, buffer, count, Math.min(buffer.length - count, 65536), null);
      if (!length) break;
      count += length;
    }
    if (count !== before.size || !sameFile(before, fs.fstatSync(fd)) ||
        !sameFile(before, fs.lstatSync(file))) throw Error(changed);
    return buffer.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}

async function publishCacheFiles(root, files, { label, onStart }) {
  if (!files.size) return;
  const previous = activeWrites.get(root);
  let release;
  const current = new Promise(resolve => { release = resolve; });
  activeWrites.set(root, current);
  onStart?.(current);
  await previous;
  const staged = new Map();
  const changed = label + ' 폴더의 파일이 변경됐어요. 다시 확인해주세요.';
  const rootChanged = label + ' 폴더가 변경됐어요.';
  try {
    const rootBefore = fs.lstatSync(root);
    if (!rootBefore.isDirectory() || fs.realpathSync(root) !== root) throw Error(rootChanged);
    const observed = new Map();
    let used = 0;
    for (const name of fs.readdirSync(root)) {
      const stat = fs.lstatSync(path.join(root, name));
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) throw Error(changed);
      observed.set(name, stat);
      used += stat.size;
      if (observed.size % 128 === 0) {
        await setImmediate();
        const currentRoot = fs.lstatSync(root);
        if (!currentRoot.isDirectory() || currentRoot.dev !== rootBefore.dev || currentRoot.ino !== rootBefore.ino ||
            currentRoot.mtimeMs !== rootBefore.mtimeMs || currentRoot.ctimeMs !== rootBefore.ctimeMs) throw Error(rootChanged);
      }
    }
    const rootScanned = fs.lstatSync(root);
    if (!rootScanned.isDirectory() || rootScanned.dev !== rootBefore.dev || rootScanned.ino !== rootBefore.ino ||
        rootScanned.mtimeMs !== rootBefore.mtimeMs || rootScanned.ctimeMs !== rootBefore.ctimeMs) throw Error(rootChanged);
    let additional = 0;
    for (const [destination, entry] of files) {
      if (observed.has(path.basename(destination))) entry.verify();
      else additional += entry.bytes.length;
    }
    if (!additional) return;
    if (used + additional > cacheLimit) throw Error(label + ' 저장 공간이 512MiB 한도에 도달했어요.');
    for (const [destination, entry] of files) {
      if (observed.has(path.basename(destination))) continue;
      const temporary = destination + '.tmp-' + randomUUID();
      const handle = await fs.promises.open(temporary, 'wx', 0o600);
      try {
        const identity = await handle.stat();
        staged.set(temporary, { identity, destination, entry });
        await handle.writeFile(entry.bytes);
      } finally {
        await handle.close();
      }
    }

    // Recheck the existing tree once for the whole staged set. Same-size edits
    // to existing files still invalidate the publication.
    const rootStaged = fs.lstatSync(root);
    if (!rootStaged.isDirectory() || rootStaged.dev !== rootBefore.dev || rootStaged.ino !== rootBefore.ino ||
        fs.realpathSync(root) !== root || fs.readdirSync(root).length !== observed.size + staged.size) throw Error(rootChanged);
    for (const [name, prior] of observed) {
      if (!sameFile(prior, fs.lstatSync(path.join(root, name)))) throw Error(changed);
    }
    for (const [temporary, { identity, entry }] of staged) {
      const stat = fs.lstatSync(temporary);
      if (stat.dev !== identity.dev || stat.ino !== identity.ino ||
          !readBoundedFile(temporary, { limit: entry.bytes.length, expectedSize: entry.bytes.length, changed, oversized: changed }).equals(entry.bytes)) {
        throw Error(changed);
      }
    }
    const finalRoot = fs.lstatSync(root);
    if (!finalRoot.isDirectory() || finalRoot.dev !== rootStaged.dev || finalRoot.ino !== rootStaged.ino ||
        finalRoot.mtimeMs !== rootStaged.mtimeMs || finalRoot.ctimeMs !== rootStaged.ctimeMs) throw Error(rootChanged);
    for (const [temporary, { destination, entry }] of staged) {
      try {
        fs.linkSync(temporary, destination);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        entry.verify();
      }
    }
  } finally {
    try {
      for (const [temporary, { identity, entry }] of staged) {
        const stat = fs.lstatSync(temporary, { throwIfNoEntry: false });
        if (stat?.isFile() && stat.dev === identity.dev && stat.ino === identity.ino &&
            stat.size === entry.bytes.length) {
          try {
            if (readBoundedFile(temporary, { limit: stat.size, observed: stat, changed, oversized: changed }).equals(entry.bytes))
              fs.unlinkSync(temporary);
          } catch {
            // A different or changed file at this path stays available for inspection.
          }
        }
      }
    } finally {
      release();
      if (activeWrites.get(root) === current) activeWrites.delete(root);
    }
  }
}

module.exports = { openFlags, sameFile, readBoundedFile, publishCacheFiles };
