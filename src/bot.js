import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';

import { escapeHtml } from './util.js';
import { geminiTextToImage } from './gemini.js';
import { freepikMysticTextToImage, freepikSeedreamEditImage, normalizeBase64 } from './freepik.js';

// --- editable packs ---
const PACKS = [
  { id: 'p10', title: '10 генераций', credits: 10, stars: 49, description: 'Пак на 10 генераций' },
  { id: 'p30', title: '30 генераций', credits: 30, stars: 129, description: 'Пак на 30 генераций' },
  { id: 'p100', title: '100 генераций', credits: 100, stars: 399, description: 'Пак на 100 генераций' }
];

export function getPacks() {
  return PACKS;
}

export function createBot({
  botToken,
  botUsername,
  channelUsername,
  webAppUrl,
  freepikApiKey,
  geminiApiKey,
  ownerId,
  startBonusCredits,
  referralBonusCredits,
  enableChannelGate,
  db,
  publicBaseUrl
}) {
  const bot = new Telegraf(botToken);

  const state = new Map(); // userId -> { stage, engine, aspect_ratio }

  const fullBotUsername = botUsername || null;

  // --- subscription gate ---
  async function isSubscribed(userId) {
    if (ownerId && Number(userId) === Number(ownerId)) return true;
    if (!enableChannelGate) return true;

    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    const res = await axios.get(url, {
      params: { chat_id: channelUsername, user_id: userId },
      timeout: 15_000
    });

    const status = res.data?.result?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  }

  function gateKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.url('✅ Подписаться на канал', `https://t.me/${channelUsername.replace('@', '')}`)],
      [Markup.button.callback('🔄 Проверить подписку', 'gate_check')]
    ]);
  }

  function mainKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.webApp('🌟 Открыть Mini App', webAppUrl)],
      [Markup.button.callback('🎨 Генерация', 'menu_gen'), Markup.button.callback('📚 Промты', 'menu_prompts')],
      [Markup.button.callback('👤 Профиль', 'menu_profile'), Markup.button.callback('💫 Купить Stars', 'menu_buy')],
      [Markup.button.callback('🔗 Поделиться', 'menu_share')],
      [Markup.button.callback('🆘 Поддержка', 'menu_help')]
    ]);
  }

  function engineKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🍌 Nano Banana (Gemini)', 'engine:nano')],
      [Markup.button.callback('✨ Freepik Mystic', 'engine:mystic')],
      [Markup.button.callback('🖼 Freepik Edit (по фото)', 'engine:seedream')],
      [Markup.button.callback('⬅️ Назад', 'back_menu')]
    ]);
  }

  function shareKeyboard(userId) {
    const refCode = Number(userId).toString(36);
    const deepLink = fullBotUsername
      ? `https://t.me/${fullBotUsername}?start=ref_${refCode}`
      : `https://t.me/<YOUR_BOT_USERNAME>?start=ref_${refCode}`;

    const shareBot = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent('Держи моего AI-бота 🔥')}`;
    const shareChannel = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${channelUsername.replace('@','')}`)}&text=${encodeURIComponent('Подпишись на канал — там все промты и гайды 🤍')}`;

    return Markup.inlineKeyboard([
      [Markup.button.url('🔗 Поделиться ботом', shareBot)],
      [Markup.button.url('📣 Поделиться каналом', shareChannel)],
      [Markup.button.url('🧡 Открыть канал', `https://t.me/${channelUsername.replace('@','')}`)],
      [Markup.button.callback('⬅️ Назад', 'back_menu')]
    ]);
  }

  function buyKeyboard() {
    return Markup.inlineKeyboard([
      ...PACKS.map((p) => [Markup.button.callback(`${p.title} — ${p.stars}⭐️`, `buy:${p.id}`)]),
      [Markup.button.callback('⬅️ Назад', 'back_menu')]
    ]);
  }

  function ensureUser(from, referredBy = null) {
    const existing = db.getUser.get(from.id);
    if (!existing) {
      db.insertUser.run({
        user_id: from.id,
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        joined_at: Date.now(),
        credits: startBonusCredits,
        referred_by: referredBy,
        last_active_at: Date.now()
      });
      return { user: db.getUser.get(from.id), isNew: true };
    }

    db.updateUserMeta.run({
      user_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      last_active_at: Date.now()
    });

    return { user: db.getUser.get(from.id), isNew: false };
  }

  function parseStartParam(text) {
    const m = String(text || '').match(/^\/start(?:\s+(.+))?/);
    const param = (m?.[1] || '').trim();
    return param || null;
  }

  async function showGate(ctx) {
    return ctx.reply(
      `Чтобы пользоваться ботом, подпишись на канал: ${channelUsername}\n\nПосле подписки нажми «Проверить подписку».`,
      gateKeyboard()
    );
  }

  async function showMenu(ctx) {
    return ctx.reply('Готово ✅\n\nВыбирай, что делаем:', mainKeyboard());
  }

  // --- start ---
  bot.start(async (ctx) => {
    try {
      const startParam = parseStartParam(ctx.message?.text);
      let referrerId = null;
      let referredBy = null;
      if (startParam?.startsWith('ref_')) {
        referredBy = startParam;
        const code = startParam.replace('ref_', '').trim();
        const parsed = parseInt(code, 36);
        if (!Number.isNaN(parsed)) referrerId = parsed;
      }

      const { isNew } = ensureUser(ctx.from, referredBy);

      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);

      // referral bonus
      if (isNew && referrerId && referrerId !== ctx.from.id) {
        const already = db.hasReferral.get(referrerId, ctx.from.id);
        if (!already) {
          db.insertReferral.run(referrerId, ctx.from.id, Date.now());
          db.addCredits.run(referralBonusCredits, ctx.from.id);
          db.addCredits.run(referralBonusCredits, referrerId);
          bot.telegram.sendMessage(
            referrerId,
            `🎁 Новый подписчик по твоей ссылке! +${referralBonusCredits} генерац(ии) добавлено ✅`
          ).catch(() => {});
        }
      }

      await ctx.reply(
        `Привет, ${escapeHtml(ctx.from.first_name || 'друг')} 🤍\n\n` +
          `Я — Kristina AI Agent. Здесь ты можешь:\n` +
          `• генерировать Nano Banana и Freepik\n` +
          `• получать промты из канала\n` +
          `• покупать генерации за Stars\n`,
        { parse_mode: 'HTML' }
      );

      return showMenu(ctx);
    } catch (e) {
      return ctx.reply(
        'Не смог проверить подписку 🙈\n\nВажно: добавь бота админом в канал, иначе Telegram не даст проверить участников.'
      );
    }
  });

  bot.action('gate_check', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return ctx.reply('Пока не вижу подписку 😌 Подпишись и нажми ещё раз.', gateKeyboard());
      return showMenu(ctx);
    } catch {
      return ctx.reply('Ошибка проверки подписки. Проверь, что бот админ в канале и канал указан правильно.');
    }
  });

  bot.action('back_menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showMenu(ctx);
  });

  // --- menu actions ---
  bot.action('menu_gen', async (ctx) => {
    await ctx.answerCbQuery();
    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {}

    state.set(ctx.from.id, { stage: 'choose_engine' });
    return ctx.reply('Выбери движок генерации:', engineKeyboard());
  });

  bot.action(/^engine:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const engine = String(ctx.match?.[1] || '').trim();

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {}

    ensureUser(ctx.from);

    if (engine === 'seedream') {
      state.set(ctx.from.id, { stage: 'await_photo', engine: 'seedream', aspect_ratio: 'social_story_9_16' });
      return ctx.reply('Отправь фото (картинку), а следующим сообщением — промт (что сделать с фото).');
    }

    const label = engine === 'nano' ? 'Nano Banana (Gemini)' : 'Freepik Mystic';
    state.set(ctx.from.id, { stage: 'await_prompt', engine, aspect_ratio: 'social_story_9_16' });
    return ctx.reply(`Ок ✅\nНапиши промт для: ${label}`);
  });

  bot.action('menu_prompts', async (ctx) => {
    await ctx.answerCbQuery();
    const items = db.listPrompts.all(10);
    if (!items.length) return ctx.reply('Пока нет промтов. Добавь пост в канал и я подхвачу ✅');

    const text = items
      .map((p) => `#${p.id} — ${p.title || 'Промт'}\n${p.text.slice(0, 220)}${p.text.length > 220 ? '…' : ''}`)
      .join('\n\n');

    const kb = Markup.inlineKeyboard([
      ...items.slice(0, 5).map((p) => [Markup.button.callback(`Использовать #${p.id}`, `use_prompt:${p.id}`)]),
      [Markup.button.callback('⬅️ Назад', 'back_menu')]
    ]);

    return ctx.reply(`📚 Свежие промты:\n\n${text}`, kb);
  });

  bot.action(/^use_prompt:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = Number(ctx.match?.[1]);
    const row = db.getPromptById.get(id);
    if (!row) return ctx.reply('Не нашла этот промт 🙈');

    state.set(ctx.from.id, { stage: 'await_prompt', engine: 'mystic', aspect_ratio: 'social_story_9_16', preset: row.text });
    return ctx.reply('Ок ✅ Напиши “ДА” чтобы сгенерировать по этому промту, или напиши свой промт текстом.');
  });

  bot.action('menu_profile', async (ctx) => {
    await ctx.answerCbQuery();

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {}

    const { user } = ensureUser(ctx.from);
    const refCode = Number(ctx.from.id).toString(36);
    const deepLink = fullBotUsername
      ? `https://t.me/${fullBotUsername}?start=ref_${refCode}`
      : `https://t.me/<YOUR_BOT_USERNAME>?start=ref_${refCode}`;

    const text =
      `<b>👤 Профиль</b>\n\n` +
      `• ID: <code>${user.user_id}</code>\n` +
      `• Username: @${escapeHtml(user.username || 'без_ника')}\n` +
      `• Генерации: <b>${user.credits}</b>\n` +
      `• Потрачено Stars: <b>${user.total_spent_stars || 0}</b>\n` +
      (user.last_result_url ? `\nПоследний результат: ${escapeHtml(user.last_result_url)}\n` : '') +
      `\n<b>🔗 Твоя ссылка для друзей</b>\n${escapeHtml(deepLink)}`;

    return ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💫 Купить генерации', 'menu_buy')],
        [Markup.button.callback('🔗 Поделиться', 'menu_share')],
        [Markup.button.webApp('🌟 Mini App', webAppUrl)],
        [Markup.button.callback('⬅️ Назад', 'back_menu')]
      ])
    });
  });

  bot.action('menu_share', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply('Поделиться ботом и каналом:', shareKeyboard(ctx.from.id));
  });

  bot.action('menu_help', async (ctx) => {
    await ctx.answerCbQuery();
    const text =
      `<b>🆘 Поддержка</b>\n\n` +
      `• Nano Banana: Gemini Image API\n` +
      `• Freepik: Mystic + Seedream Edit\n` +
      `• Оплата: Telegram Stars\n\n` +
      `Если что-то не работает — напиши Кристине: @gurenko_kristina`;

    return ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'back_menu')]]) });
  });

  // --- purchases ---
  bot.action('menu_buy', async (ctx) => {
    await ctx.answerCbQuery();

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {}

    ensureUser(ctx.from);
    return ctx.reply('💫 Покупка генераций за Telegram Stars\n\nВыбери пакет:', buyKeyboard());
  });

  bot.action(/^buy:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const packId = String(ctx.match?.[1] || '').trim();
    const pack = PACKS.find((p) => p.id === packId);
    if (!pack) return ctx.reply('Пакет не найден 🙈');

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {}

    ensureUser(ctx.from);

    const payload = `pack:${pack.id}`;
    await bot.telegram.sendInvoice(ctx.from.id, {
      title: pack.title,
      description: `${pack.description}. Начислим +${pack.credits} генераций.`,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: pack.title, amount: pack.stars }]
    });
  });

  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch {}
  });

  bot.on('message', async (ctx, next) => {
    const sp = ctx.message?.successful_payment;
    if (!sp) return next();

    try {
      const payload = sp.invoice_payload || '';
      const totalStars = Number(sp.total_amount || 0);
      const chargeId = sp.telegram_payment_charge_id || null;

      const packId = payload.startsWith('pack:') ? payload.replace('pack:', '').trim() : null;
      const pack = PACKS.find((p) => p.id === packId);
      const creditsAdded = pack ? pack.credits : 0;

      ensureUser(ctx.from);
      if (creditsAdded > 0) db.addCredits.run(creditsAdded, ctx.from.id);
      if (totalStars > 0) db.addSpentStars.run(totalStars, ctx.from.id);

      db.insertPurchase.run({
        user_id: ctx.from.id,
        payload,
        stars: totalStars,
        credits_added: creditsAdded,
        telegram_charge_id: chargeId,
        created_at: Date.now()
      });

      return ctx.reply(
        `✅ Оплата прошла!\nНачислила: +${creditsAdded} генераций\nБаланс обновлён 🔥`,
        mainKeyboard()
      );
    } catch {
      return ctx.reply('Оплата прошла, но я не смогла начислить генерации автоматически 🙈 Напиши /paysupport');
    }
  });

  bot.command('paysupport', async (ctx) => {
    return ctx.reply(
      '💬 Поддержка по оплате\n\nЕсли у тебя списались Stars, а генерации не начислились — пришли скрин оплаты и свой @username. Мы разберёмся ✅'
    );
  });

  // --- generation ---
  bot.on('text', async (ctx) => {
    const s = state.get(ctx.from.id);
    if (!s) return;

    // gate for all actions
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) {
        state.delete(ctx.from.id);
        return showGate(ctx);
      }
    } catch {
      // ignore
    }

    ensureUser(ctx.from);

    // seedream expects prompt after photo
    if (s.stage === 'await_prompt' && s.engine === 'seedream') {
      // should not happen; prompt handled in photo handler below
    }

    const text = ctx.message.text?.trim();
    if (!text) return;

    // prompt preset flow
    const prompt = text === 'ДА' && s.preset ? s.preset : text;
    state.delete(ctx.from.id);

    // spend credit
    const cost = s.engine === 'seedream' ? 2 : 1;
    const spend = db.spendCredit.run(ctx.from.id, cost);
    if (spend.changes === 0) {
      return ctx.reply('На балансе нет генераций 😌\n\nПополнить можно за Stars:', buyKeyboard());
    }

    await ctx.reply('Запускаю генерацию… ⏳');

    try {
      if (s.engine === 'nano') {
        const { mimeType, buffer } = await geminiTextToImage({
          apiKey: geminiApiKey,
          prompt
        });

        await ctx.replyWithPhoto({ source: buffer }, { caption: '🍌 Nano Banana готово ✅' });
        return;
      }

      if (s.engine === 'mystic') {
        const out = await freepikMysticTextToImage({
          apiKey: freepikApiKey,
          prompt,
          aspect_ratio: s.aspect_ratio || 'social_story_9_16'
        });
        if (out.url) {
          db.setLastResult.run(out.url, ctx.from.id);
          await ctx.replyWithPhoto(out.url, { caption: '✨ Freepik Mystic готово ✅' });
          return;
        }
      }

      // fallback
      await ctx.reply('Сейчас не удалось получить результат 😢 Попробуй другой промт.');
    } catch (e) {
      db.addCredits.run(1, ctx.from.id); // refund
      await ctx.reply(`Ошибка генерации: ${String(e?.message || e)}`);
    }
  });

  // seedream photo handler
  bot.on('photo', async (ctx) => {
    const s = state.get(ctx.from.id);
    if (!s || s.stage !== 'await_photo' || s.engine !== 'seedream') return;

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) {
        state.delete(ctx.from.id);
        return showGate(ctx);
      }
    } catch {}

    // download photo file as base64
    try {
      const sizes = ctx.message.photo || [];
      const best = sizes[sizes.length - 1];
      const file = await bot.telegram.getFile(best.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const imgRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const b64 = Buffer.from(imgRes.data).toString('base64');

      state.set(ctx.from.id, { ...s, stage: 'await_prompt_after_photo', referenceImageBase64: b64 });
      return ctx.reply('Фото получила ✅\nТеперь напиши промт: что сделать с этим фото?');
    } catch (e) {
      state.delete(ctx.from.id);
      return ctx.reply('Не смогла скачать фото 🙈 Попробуй ещё раз.');
    }
  });

  bot.on('text', async (ctx) => {
    const s = state.get(ctx.from.id);
    if (!s || s.stage !== 'await_prompt_after_photo') return;

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) {
        state.delete(ctx.from.id);
        return showGate(ctx);
      }
    } catch {}

    const prompt = ctx.message.text?.trim();
    state.delete(ctx.from.id);

    if (!prompt) return ctx.reply('Промт пустой 😅');

    // spend credits (seedream cost = 2)
    ensureUser(ctx.from);
    const spend = db.spendCredit.run(ctx.from.id, 2);
    if (spend.changes === 0) {
      return ctx.reply('На балансе нет генераций 😌\n\nПополнить можно за Stars:', buyKeyboard());
    }

    await ctx.reply('Запускаю обработку фото… ⏳');

    try {
      const out = await freepikSeedreamEditImage({
        apiKey: freepikApiKey,
        prompt,
        aspect_ratio: s.aspect_ratio || 'social_story_9_16',
        referenceImageBase64: normalizeBase64(s.referenceImageBase64)
      });

      if (out.url) {
        db.setLastResult.run(out.url, ctx.from.id);
        await ctx.replyWithPhoto(out.url, { caption: '🖼 Freepik Edit готово ✅' });
        return;
      }

      await ctx.reply('Не дождалась результата 😢 Попробуй ещё раз.');
    } catch (e) {
      db.addCredits.run(2, ctx.from.id); // refund
      await ctx.reply(`Ошибка обработки: ${String(e?.message || e)}`);
    }
  });

  // --- channel prompt ingestion ---
  bot.on('channel_post', async (ctx) => {
    try {
      if (!ctx.channelPost?.text) return;
      if (ctx.channelPost.chat?.username && `@${ctx.channelPost.chat.username}` !== channelUsername) return;

      const raw = ctx.channelPost.text.trim();
      const lines = raw.split('\n');
      let title = null;
      let text = raw;
      if (lines[0] && lines[0].length <= 60 && lines.length >= 2) {
        title = lines[0].replace(/^#+\s*/, '').trim();
        text = lines.slice(1).join('\n').trim();
      }
      if (!text) return;

      db.insertPrompt.run({
        title,
        text,
        message_id: ctx.channelPost.message_id,
        created_at: Date.now()
      });
    } catch {
      // ignore
    }
  });

  // --- simple admin commands ---
  bot.command('addcredits', async (ctx) => {
    if (ownerId && ctx.from.id !== Number(ownerId)) return;
    const parts = ctx.message.text.split(' ').filter(Boolean);
    const userId = Number(parts[1]);
    const amount = Number(parts[2]);
    if (!userId || !amount) return ctx.reply('Использование: /addcredits <userId> <amount>');
    db.addCredits.run(amount, userId);
    ctx.reply(`✅ Добавила ${amount} генераций пользователю ${userId}`);
  });

  // --- debug route for webhooks ---
  bot.catch((err, ctx) => {
    console.error('BOT ERROR', err);
    if (publicBaseUrl) {
      bot.telegram.sendMessage(ownerId, `❌ Bot error: ${String(err?.message || err)}`).catch(() => {});
    }
  });

  return bot;
}
