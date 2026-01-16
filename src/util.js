import fs from 'fs';

export function safeMkdirp(dir) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

export function nowMs() {
  return Date.now();
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function trimLong(str = '', n = 400) {
  const s = String(str);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function guessExt(mime = '') {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('mp4')) return 'mp4';
  return 'bin';
}
