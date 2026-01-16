# Kristina AI Agent — Telegram Bot + Mini App (v4)

Это рабочая сборка бота (Telegraf + Express) и Mini App.

## ✅ Что уже есть

- Проверка подписки на канал `CHANNEL_USERNAME` (и bypass для `OWNER_ID`)
- Telegram Mini App (UI): **генерация / промты / профиль / покупки**
- Nano Banana (Gemini Image API) — text → image
- Freepik Mystic — text → image
- Freepik Seedream v4 Edit — photo + prompt → image
- Telegram Stars: покупка пакетов, начисление кредитов
- Рефералка: +1 генерация пользователю и пригласившему
- Поделиться ботом и каналом (кнопки в профиле и Mini App)

---

## 1) Переменные окружения (Render → Environment)

Обязательные:

- `BOT_TOKEN` — токен от @BotFather
- `BOT_USERNAME` — username бота без `@` (например `gurenko_ai_agent_bot`)
- `BASE_URL` — ваш URL на Render (например `https://ai-kristina.onrender.com`)
- `WEBAPP_URL` — Mini App URL (например `${BASE_URL}/miniapp?v=1`)
- `USE_WEBHOOK` — `1`
- `WEBHOOK_PATH` — `/telegram`

Гейты/канал:

- `CHANNEL_USERNAME` — `@gurenko_kristina_ai`
- `ENABLE_CHANNEL_GATE` — `1`
- `OWNER_ID` — ваш Telegram ID (например `310530888`)

Ключи:

- `GEMINI_API_KEY` — ключ Google AI Studio (Gemini)
- `FREEPIK_API_KEY` — ключ Freepik

База:

- `SQLITE_PATH` — `/var/data/data.sqlite`

Кредиты:

- `START_BONUS_CREDITS` — `2`
- `REFERRAL_BONUS_CREDITS` — `1`

---

## 2) Render Disk (чтобы база не сбрасывалась)

Render → Service → **Disks** → Add Disk

- Mount path: `/var/data`
- Size: 1GB (хватит)

И в Env:

- `SQLITE_PATH=/var/data/data.sqlite`

---

## 3) Важно про канал

Чтобы бот мог проверять подписку и читать посты для промтов:

1) Открой канал → Управление → Администраторы
2) Добавь бота админом
3) Включи право: **Просматривать сообщения** (и желательно остальные)

---

## 4) Проверка

- Бот: `/start`
- Mini App: `${BASE_URL}/miniapp`
- Health: `${BASE_URL}/api/health`

---

## 5) Команды администратора

- `/addcredits <user_id> <n>` — добавить генерации
- `/stats` — статистика

