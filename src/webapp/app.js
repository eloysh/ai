/* global Telegram */

const tg = window.Telegram?.WebApp;

const el = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = 'info') {
  const root = el('#toast');
  root.textContent = msg;
  root.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    root.className = 'toast';
  }, 3200);
}

function setLoading(on, text) {
  const node = el('#loading');
  el('#loadingText').textContent = text || 'Загрузка…';
  node.classList.toggle('show', !!on);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-InitData': tg?.initData || ''
  };

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch {}
    const e = new Error(data?.error || `HTTP_${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }

  return res.json();
}

function openTelegramLink(url) {
  try {
    tg.openTelegramLink(url);
  } catch {
    window.open(url, '_blank');
  }
}

function setTab(tab) {
  els('.tab').forEach((t) => t.classList.remove('active'));
  el(`.tab[data-tab="${tab}"]`).classList.add('active');

  els('.view').forEach((v) => v.classList.remove('active'));
  el(`#view-${tab}`).classList.add('active');
}

let userState = {
  user: null,
  packs: [],
  prompts: [],
  engines: []
};

async function loadInitial() {
  setLoading(true, 'Подключаюсь…');

  try {
    const engines = await api('/api/engines');
    userState.engines = engines.items || [];

    const me = await api('/api/me');
    userState.user = me.user;
    userState.deepLink = me.deepLink;
    userState.channel = me.channel;
    userState.packs = me.packs || [];

    renderHeader();
    renderProfile();
    renderBuy();
    await loadPrompts();

    setLoading(false);
  } catch (e) {
    setLoading(false);

    if (e.status === 403 && e.data?.error === 'not_subscribed') {
      showGate();
      return;
    }

    toast('Ошибка запуска: ' + (e.data?.message || e.message), 'error');
  }
}

function renderHeader() {
  const name = userState.user?.first_name || 'Кристина';
  el('#welcomeName').textContent = name;
}

function renderProfile() {
  const u = userState.user;
  if (!u) return;

  el('#credits').textContent = String(u.credits ?? 0);
  el('#spent').textContent = String(u.total_spent_stars ?? 0);

  const link = userState.deepLink || '';
  el('#refLink').value = link;

  const history = u.last_result_url
    ? `<a href="${u.last_result_url}" target="_blank">Открыть последний результат</a>`
    : '<span class="muted">Пока пусто</span>';

  el('#lastResult').innerHTML = history;
}

async function loadPrompts() {
  setLoading(true, 'Загружаю промты…');
  try {
    const data = await api('/api/prompts');
    userState.prompts = data.items || [];
    renderPrompts();
    setLoading(false);
  } catch (e) {
    setLoading(false);
    if (e.status === 403 && e.data?.error === 'not_subscribed') return showGate();
    toast('Не удалось загрузить промты', 'error');
  }
}

function renderPrompts() {
  const list = el('#promptsList');
  list.innerHTML = '';

  const items = userState.prompts;
  if (!items.length) {
    list.innerHTML = `<div class="empty">Пока нет промтов. Добавь пост в канал — и бот подхватит ✅</div>`;
    return;
  }

  items.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'promptCard';

    const title = (p.title || 'Промт').slice(0, 80);
    const preview = (p.text || '').slice(0, 220);

    card.innerHTML = `
      <div class="promptTitle">${escapeHtml(title)}</div>
      <div class="promptText">${escapeHtml(preview)}${(p.text || '').length > 220 ? '…' : ''}</div>
      <div class="row gap">
        <button class="btn small" data-use="${p.id}">Использовать</button>
        <button class="btn ghost small" data-copy="${p.id}">Копировать</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function renderEngines() {
  const sel = el('#engine');
  sel.innerHTML = '';

  const engines = userState.engines.length
    ? userState.engines
    : [
      { id: 'nano_banana', title: '🍌 Nano Banana (Gemini)' },
      { id: 'freepik_mystic', title: '✨ Freepik Mystic' },
      { id: 'freepik_seedream_edit', title: '🪄 Freepik Edit по фото' }
    ];

  engines.forEach((e) => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.title;
    sel.appendChild(opt);
  });
}

function renderBuy() {
  const grid = el('#packs');
  grid.innerHTML = '';

  (userState.packs || []).forEach((p) => {
    const card = document.createElement('div');
    card.className = 'pack';
    card.innerHTML = `
      <div class="packTitle">${escapeHtml(p.title)}</div>
      <div class="packMeta">+${p.credits} генераций</div>
      <button class="btn" data-buy="${p.id}">${p.stars} ⭐</button>
    `;
    grid.appendChild(card);
  });
}

function showGate() {
  const gate = el('#gate');
  gate.classList.add('show');
  el('#gateChannel').textContent = userState.channel || '@gurenko_kristina_ai';
}

function hideGate() {
  el('#gate').classList.remove('show');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function generate() {
  const engine = el('#engine').value;
  const aspect_ratio = el('#aspect').value;
  const prompt = el('#prompt').value.trim();

  if (!prompt) return toast('Напиши промт 🙂', 'warn');

  let image_base64 = null;
  const file = el('#imageFile')?.files?.[0] || null;
  if (file) {
    image_base64 = await fileToBase64(file);
  }

  setLoading(true, 'Генерирую…');
  el('#result').innerHTML = '';

  try {
    const data = await api('/api/generate', {
      method: 'POST',
      body: { engine, prompt, aspect_ratio, image_base64 }
    });

    setLoading(false);

    if (data.type === 'video') {
      const v = document.createElement('video');
      v.controls = true;
      v.src = data.url;
      v.className = 'resultMedia';
      el('#result').appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = data.url;
      img.className = 'resultMedia';
      el('#result').appendChild(img);
    }

    toast('Готово ✅', 'ok');
    await refreshMe();
  } catch (e) {
    setLoading(false);

    if (e.status === 402 && e.data?.error === 'no_credits') {
      toast('Нет генераций — выбери пакет ниже ⭐', 'warn');
      setTab('buy');
      return;
    }

    if (e.status === 403 && e.data?.error === 'not_subscribed') {
      showGate();
      return;
    }

    toast('Ошибка: ' + (e.data?.message || e.message), 'error');
  }
}

async function refreshMe() {
  try {
    const me = await api('/api/me');
    userState.user = me.user;
    userState.deepLink = me.deepLink;
    userState.channel = me.channel;
    userState.packs = me.packs || userState.packs;
    renderProfile();
    renderBuy();
  } catch {
    // ignore
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      // keep DataURL (server will normalize)
      resolve(res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function buyPack(packId) {
  setLoading(true, 'Создаю оплату…');
  try {
    const data = await api('/api/invoice', { method: 'POST', body: { pack_id: packId } });
    setLoading(false);

    if (tg?.openInvoice) {
      tg.openInvoice(data.url, (status) => {
        if (status === 'paid') {
          toast('Оплачено ✅ Обновляю баланс…', 'ok');
          setTimeout(refreshMe, 1200);
        }
      });
    } else {
      window.open(data.url, '_blank');
    }
  } catch (e) {
    setLoading(false);
    toast('Не удалось создать оплату', 'error');
  }
}

function bind() {
  // Tabs
  els('.tab').forEach((t) => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
  });

  // Generate
  el('#btnGenerate').addEventListener('click', generate);

  // Reload prompts
  el('#btnReloadPrompts').addEventListener('click', loadPrompts);

  // Copy ref link
  el('#btnCopyRef').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el('#refLink').value);
      toast('Скопировано ✅', 'ok');
    } catch {
      toast('Не получилось скопировать 🙈', 'warn');
    }
  });

  // Share
  el('#btnShareBot').addEventListener('click', () => {
    const link = userState.deepLink;
    if (!link) return toast('Ссылка ещё не готова', 'warn');
    const u = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Забирай бот с промтами и генерацией 🔥')}`;
    openTelegramLink(u);
  });

  el('#btnShareChannel').addEventListener('click', () => {
    const ch = (userState.channel || '').replace('@', '');
    const u = `https://t.me/${ch}`;
    openTelegramLink(u);
  });

  // Gate actions
  el('#btnGoChannel').addEventListener('click', () => {
    const ch = (userState.channel || '@gurenko_kristina_ai').replace('@', '');
    openTelegramLink(`https://t.me/${ch}`);
  });

  el('#btnCheckSub').addEventListener('click', async () => {
    setLoading(true, 'Проверяю…');
    try {
      await refreshMe();
      hideGate();
      setLoading(false);
      toast('Готово ✅', 'ok');
    } catch {
      setLoading(false);
      toast('Пока не вижу подписку', 'warn');
    }
  });

  // Delegation: prompts use/copy
  el('#promptsList').addEventListener('click', async (ev) => {
    const useId = ev.target?.dataset?.use;
    const copyId = ev.target?.dataset?.copy;

    if (useId) {
      const p = userState.prompts.find((x) => String(x.id) === String(useId));
      if (p) {
        el('#prompt').value = p.text;
        setTab('gen');
        toast('Промт подставлен ✅', 'ok');
      }
    }

    if (copyId) {
      const p = userState.prompts.find((x) => String(x.id) === String(copyId));
      if (p) {
        try {
          await navigator.clipboard.writeText(p.text);
          toast('Скопировано ✅', 'ok');
        } catch {
          toast('Не получилось скопировать 🙈', 'warn');
        }
      }
    }
  });

  // Delegation: buy
  el('#packs').addEventListener('click', (ev) => {
    const packId = ev.target?.dataset?.buy;
    if (packId) buyPack(packId);
  });

  // show/hide image picker hint
  el('#engine').addEventListener('change', () => {
    const id = el('#engine').value;
    const need = id === 'freepik_seedream_edit';
    el('#imageRow').classList.toggle('show', need);
  });
}

function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.MainButton.hide();
  } catch {
    // ignore
  }
}

// --- boot ---
initTelegram();
renderEngines();
bind();
setTab('gen');
loadInitial();
