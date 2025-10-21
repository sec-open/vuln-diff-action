// Common utilities for Phase 2
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// Ordered severities for comparison operations.
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

// Normalizes severity strings; maps NEGLIGIBLE to LOW and unknown values to UNKNOWN.
function normalizeSeverity(sev) {
  if (!sev) return 'UNKNOWN';
  const s = String(sev).toUpperCase();
  if (s === 'NEGLIGIBLE') return 'LOW';
  if (SEV_ORDER.includes(s)) return s;
  return 'UNKNOWN';
}

// Returns worst (highest impact) severity between two values using ordering index.
function worstSeverity(a, b) {
  const ia = SEV_ORDER.indexOf(normalizeSeverity(a));
  const ib = SEV_ORDER.indexOf(normalizeSeverity(b));
  return ia <= ib ? normalizeSeverity(a) : normalizeSeverity(b);
}

// Deduplicates items by JSON stringification; optional limit caps output length.
function uniqueByJSON(arr, limit) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
      if (typeof limit === 'number' && out.length >= limit) break;
    }
  }
  return out;
}

// Reads JSON file and parses into object.
async function readJSON(p) {
  const buf = await fsp.readFile(p, 'utf8');
  return JSON.parse(buf);
}

// Writes object to JSON file with indentation and trailing newline.
async function writeJSON(p, obj) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// Returns current timestamp in ISO format.
function nowISO() {
  return new Date().toISOString();
}

// Picks CVSS entry with highest score from list; extracts score and vector where available.
function pickMaxCvss(cvssList) {
  if (!Array.isArray(cvssList) || cvssList.length === 0) return null;
  let best = null;
  for (const c of cvssList) {
    const score = Number(c?.metrics?.baseScore ?? c?.baseScore ?? c?.score ?? 0);
    if (best === null || score > best.score) {
      best = {
        score,
        vector: c?.vector ?? c?.metrics?.vectorString ?? c?.vectorString ?? null,
      };
    }
  }
  return best;
}

// Ensures value is returned as array of strings.
function ensureStringArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String);
  return [String(x)];
}

module.exports = {
  SEV_ORDER,
  normalizeSeverity,
  worstSeverity,
  uniqueByJSON,
  readJSON,
  writeJSON,
  nowISO,
  pickMaxCvss,
  ensureStringArray,
};
