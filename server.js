import 'dotenv/config';

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import axios from 'axios';

import { initDb } from './src/db.js';
import { createBot } from './src/bot.js';
import { validateInitData, parseInitData } from './src/telegramAuth.js';
import { geminiTextToImage } from './src/gemini.js';
import {
  freepikMysticTextToImage,
  freepikSeedreamEdit,
} from './src/freepik.js';
import { safeMkdirp, nowMs } from './src/util.js';

// ================== ENV ==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@gurenko_kristina_ai';
const ENABLE_CHANNEL_GATE = (process.env.ENABLE_CHANNEL_GATE || '1') !== '0';

const OWNER_ID = Number(process.env.OWNER_ID || 0);

const BASE_URL = process.env.BASE_URL || '';
const USE_WEBHOOK = (process.env.USE_WEBHOOK || '1') !== '0';
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/telegram';

const WEBAPP_URL = process.env.WEBAPP_URL || '';

const SQLITE_PATH = process.env.SQLITE_PATH || './data.sqlite';

const FREEPIK_API_KEY = process.env.FREEPIK_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const START_BONUS_CREDITS = Number(process.env.START_BONUS_CREDITS || 2);

// Packs (Stars)
const PACKS = [
  { id: 'p10', title: '10 генераций', credits: 10, stars: 49, description: 'Пак на 10 генераций' },
  { id: 'p30', title: '30 генераций', credits: 30, stars: 129, description: 'Пак на 30 генераций' },
  { id: 'p100', title: '100 генераций', credits: 100, stars: 399, description: 'Пак на 100 генераций' },
];

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing. Set it in Render Environment variables.');
  process.exit(1);
}

// ================== Paths ==================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webappDir = path.join(__dirname, 'src', 'webapp');
const filesDir = process.env.FILES_DIR || '/var/data/files';

safeMkdirp(path.dirname(SQLITE_PATH));
safeMkdirp(filesDir);

// ================== DB ==================
const db = initDb(SQLITE_PATH);

// ================== Express ==================
const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

// Root
app.get('/', (req, res) => {
  res.type('html').send(
    `<!doctype html><html><head><meta charset="utf-8" /><title>Kristina AI Agent</title></head>
     <body style="font-family:ui-sans-serif,system-ui; padding:24px;">
     <h2>✅ Kristina AI Agent</h2>
     <p>Mini App: <a href="/miniapp">/miniapp</a></p>
     <p>Health: <a href="/api/health">/api/health</a></p>
     </body></html>`
  );
});

// Serve Mini App
app.use('/miniapp', express.static(webappDir));

// Serve generated files
app.use('/files', express.static(filesDir));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ================== Channel subscription check ==================
async function isSubscribed(userId) {
  if (OWNER_ID && Number(userId) === OWNER_ID) return true;
  if (!ENABLE_CHANNEL_GATE) return true;

  // Works reliably only if the bot is admin in the channel.
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
  const { data } = await axios.get(url, {
    params: { chat_id: CHANNEL_USERNAME, user_id: userId },
    timeout: 15_000,
  });

  const status = data?.result?.status;
  return ['member', 'administrator', 'creator'].includes(status);
}

// ================== Telegram auth middleware for Mini App API ==================
async function requireTelegramAuth(req, res, next) {
  const initData = req.header('X-Telegram-InitData') || '';

  const ok = validateInitData(initData, BOT_TOKEN);
  if (!ok.ok) return res.status(401).json({ error: 'unauthorized', reason: ok.reason });

  req.tg = parseInitData(initData);

  const userId = req.tg?.user?.id;

  // owner bypass
  if (OWNER_ID && Number(userId) === OWNER_ID) return next();

  if (userId && ENABLE_CHANNEL_GATE) {
    try {
      const subOk = await isSubscribed(userId);
      if (!subOk) return res.status(403).json({ error: 'not_subscribed', channel: CHANNEL_USERNAME });
    } catch {
      // Soft mode: do not block if Telegram didn't respond.
    }
  }

  next();
}

function ensureUserFromTg(tgUser) {
  if (!tgUser?.id) return null;

  const existing = db.getUser.get(tgUser.id);

  if (!existing) {
    db.insertUser.run({
      user_id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      last_name: tgUser.last_name || null,
      joined_at: nowMs(),
      credits: START_BONUS_CREDITS,
      referred_by: null,
      last_active_at: nowMs(),
    });
  } else {
    db.updateUserMeta.run({
      user_id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      last_name: tgUser.last_name || null,
      last_active_at: nowMs(),
    });
  }

  return db.getUser.get(tgUser.id);
}

// ================== API ==================

app.get('/api/config', requireTelegramAuth, (req, res) => {
  const channelLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;

  res.json({
    channelUsername: CHANNEL_USERNAME,
    channelLink,
    botUsername: BOT_USERNAME,
    webappUrl: WEBAPP_URL || null,
    packs: PACKS,
    engines: [
      {
        id: 'nano_banana',
        title: 'Nano Banana (Gemini)',
        type: 'image',
        input: ['text'],
      },
      {
        id: 'freepik_mystic',
        title: 'Freepik Mystic',
        type: 'image',
        input: ['text'],
      },
      {
        id: 'freepik_seedream',
        title: 'Freepik Edit (по фото)',
        type: 'image',
        input: ['text', 'image'],
      },
    ],
  });
});

app.get('/api/me', requireTelegramAuth, (req, res) => {
  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: 'no_user' });

  const refCode = Number(user.user_id).toString(36);
  const deepLink = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=ref_${refCode}` : null;

  res.json({
    user,
    deepLink,
    channelUsername: CHANNEL_USERNAME,
  });
});

app.get('/api/prompts', requireTelegramAuth, (req, res) => {
  const items = db.listPrompts.all(30);
  res.json({ items });
});

app.get('/api/history', requireTelegramAuth, (req, res) => {
  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: 'no_user' });

  const items = db.listHistory.all(user.user_id, 20);
  res.json({ items });
});

// Stars invoice link for Mini App
app.post('/api/invoice', requireTelegramAuth, async (req, res) => {
  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: 'no_user' });

  const { pack_id } = req.body || {};
  const pack = PACKS.find((p) => p.id === pack_id);
  if (!pack) return res.status(400).json({ error: 'pack_not_found' });

  try {
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;
    const payload = `pack:${pack.id}`;

    const { data } = await axios.post(
      apiUrl,
      {
        title: pack.title,
        description: `${pack.description}. Начислим +${pack.credits} генераций.`,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: pack.title, amount: pack.stars }],
      },
      { timeout: 15_000 }
    );

    if (!data?.ok) return res.status(500).json({ error: 'tg_error', data });
    return res.json({ url: data.result, pack });
  } catch (e) {
    return res.status(500).json({ error: 'invoice_error', message: e.message });
  }
});

// Unified generation endpoint
app.post('/api/generate', requireTelegramAuth, async (req, res) => {
  const { engine, prompt, aspect_ratio, image_base64, image_mime } = req.body || {};

  if (!engine) return res.status(400).json({ error: 'engine_required' });
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt_required' });

  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: 'no_user' });

  // spend 1 credit
  const spend = db.spendCredit.run({ user_id: user.user_id });
  if (spend.changes === 0) return res.status(402).json({ error: 'no_credits' });

  const createdAt = nowMs();

  try {
    let result = null;

    if (engine === 'nano_banana') {
      if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');

      const out = await geminiTextToImage({
        apiKey: GEMINI_API_KEY,
        prompt: prompt.trim(),
      });

      // Save to files dir
      const ext = out.mimeType?.includes('png') ? 'png' : (out.mimeType?.includes('webp') ? 'webp' : 'jpg');
      const name = `nb_${user.user_id}_${Date.now()}.${ext}`;
      const filePath = path.join(filesDir, name);
      fs.writeFileSync(filePath, out.buffer);

      const url = `${BASE_URL || ''}/files/${name}`;
      result = { type: 'image', url };

      db.insertGen.run({
        user_id: user.user_id,
        engine,
        prompt: prompt.trim(),
        aspect_ratio: aspect_ratio || '9:16',
        task_id: null,
        status: 'COMPLETED',
        result_url: url,
        created_at: createdAt,
      });

      db.setLastResult.run({ user_id: user.user_id, last_result_url: url });

      return res.json({ ok: true, ...result });
    }

    if (engine === 'freepik_mystic') {
      if (!FREEPIK_API_KEY) throw new Error('FREEPIK_API_KEY missing');

      const out = await freepikMysticTextToImage({
        apiKey: FREEPIK_API_KEY,
        prompt: prompt.trim(),
        aspectRatio: aspect_ratio || 'social_story_9_16',
      });

      result = { type: 'image', url: out.url };

      db.insertGen.run({
        user_id: user.user_id,
        engine,
        prompt: prompt.trim(),
        aspect_ratio: aspect_ratio || '9:16',
        task_id: out.taskId,
        status: 'COMPLETED',
        result_url: out.url,
        created_at: createdAt,
      });

      db.setLastResult.run({ user_id: user.user_id, last_result_url: out.url });

      return res.json({ ok: true, ...result });
    }

    if (engine === 'freepik_seedream') {
      if (!FREEPIK_API_KEY) throw new Error('FREEPIK_API_KEY missing');
      if (!image_base64) throw new Error('image_base64 required');

      const buf = Buffer.from(image_base64, 'base64');

      const out = await freepikSeedreamEdit({
        apiKey: FREEPIK_API_KEY,
        prompt: prompt.trim(),
        imageBuffer: buf,
        imageMime: image_mime || 'image/jpeg',
      });

      result = { type: 'image', url: out.url };

      db.insertGen.run({
        user_id: user.user_id,
        engine,
        prompt: prompt.trim(),
        aspect_ratio: aspect_ratio || '9:16',
        task_id: out.taskId,
        status: 'COMPLETED',
        result_url: out.url,
        created_at: createdAt,
      });

      db.setLastResult.run({ user_id: user.user_id, last_result_url: out.url });

      return res.json({ ok: true, ...result });
    }

    // unknown engine
    db.addCredits.run({ user_id: user.user_id, amount: 1 });
    return res.status(400).json({ error: 'unknown_engine' });

  } catch (e) {
    // refund 1 credit
    db.addCredits.run({ user_id: user.user_id, amount: 1 });

    return res.status(500).json({
      error: 'gen_error',
      message: e.message,
    });
  }
});

// ================== Bot ==================
const bot = createBot({
  botToken: BOT_TOKEN,
  botUsername: BOT_USERNAME,
  channelUsername: CHANNEL_USERNAME,
  webAppUrl: WEBAPP_URL || (BASE_URL ? `${BASE_URL}/miniapp` : ''),
  ownerId: OWNER_ID,
  enableGate: ENABLE_CHANNEL_GATE,
  freepikApiKey: FREEPIK_API_KEY,
  geminiApiKey: GEMINI_API_KEY,
  baseUrl: BASE_URL,
  packs: PACKS,
  filesDir,
  db,
});

// ================== Webhook binding ==================
if (USE_WEBHOOK && BASE_URL) {
  app.use(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
}

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, async () => {
  console.log(`✅ Web server listening on :${PORT}`);
  console.log('✅ Mini App: /miniapp');

  try {
    if (USE_WEBHOOK && BASE_URL) {
      const hookUrl = `${BASE_URL}${WEBHOOK_PATH}`;
      await bot.telegram.setWebhook(hookUrl);
      console.log(`✅ Bot webhook enabled: ${hookUrl}`);
    } else {
      await bot.launch();
      console.log('✅ Bot started (polling)');
    }
  } catch (e) {
    console.error('❌ Bot start error:', e.message);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
