import crypto from 'crypto';

// Telegram Mini App: initData validation
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export function validateInitData(initData, botToken) {
  try {
    if (!initData || typeof initData !== 'string') return { ok: false, reason: 'empty' };
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { ok: false, reason: 'no_hash' };

    params.delete('hash');

    // data_check_string
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    const ok = timingSafeEqualHex(hash, computedHash);
    return ok ? { ok: true } : { ok: false, reason: 'hash_mismatch' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const userRaw = params.get('user');
  let user = null;
  if (userRaw) {
    try { user = JSON.parse(userRaw); } catch { /* ignore */ }
  }
  const queryId = params.get('query_id') || null;
  return { user, queryId, raw: initData };
}
