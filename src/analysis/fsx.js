// Filesystem helpers: ensure directory, existence check, JSON/file writes.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// Ensures a directory exists (recursively).
async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// Synchronous existence check (returns boolean).
function existsSync(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// Writes an object as pretty JSON to a path (creates parent directories).
async function writeJson(p, obj) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

// Writes raw data (Buffer|string) to a path (creates parent directories).
async function writeFile(p, data) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, data);
}

module.exports = { ensureDir, existsSync, writeJson, writeFile };
