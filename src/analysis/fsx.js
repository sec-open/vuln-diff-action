const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function existsSync(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

async function writeJson(p, obj) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

async function writeFile(p, data) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, data);
}

module.exports = { ensureDir, existsSync, writeJson, writeFile };
