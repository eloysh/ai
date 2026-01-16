import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { safeMkdirp } from './util.js';

export function initDb(sqlitePath) {
  // ensure directory exists (Render Disk usually mounted to /var/data)
  const dir = path.dirname(sqlitePath);
  safeMkdirp(dir);

  const db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      joined_at INTEGER,
      last_active_at INTEGER,
      credits INTEGER DEFAULT 0,
      total_spent_stars INTEGER DEFAULT 0,
      last_result_url TEXT,
      referred_by TEXT
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      text TEXT NOT NULL,
      message_id INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      engine TEXT NOT NULL,
      prompt TEXT NOT NULL,
      aspect_ratio TEXT,
      task_id TEXT,
      status TEXT NOT NULL,
      result_url TEXT,
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(user_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      payload TEXT,
      stars INTEGER DEFAULT 0,
      credits_added INTEGER DEFAULT 0,
      telegram_charge_id TEXT,
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(user_id)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL,
      created_at INTEGER,
      UNIQUE(referrer_id, referred_id)
    );
  `);

  const stmt = {
    getUser: db.prepare('SELECT * FROM users WHERE user_id=?'),

    insertUser: db.prepare(`
      INSERT INTO users (user_id, username, first_name, last_name, joined_at, last_active_at, credits, referred_by)
      VALUES (@user_id, @username, @first_name, @last_name, @joined_at, @last_active_at, @credits, @referred_by)
    `),

    updateUserBasic: db.prepare(`
      UPDATE users
      SET username=@username,
          first_name=@first_name,
          last_name=@last_name,
          last_active_at=@last_active_at
      WHERE user_id=@user_id
    `),

    addCredits: db.prepare('UPDATE users SET credits = credits + ? WHERE user_id=?'),
    spendCredit: db.prepare('UPDATE users SET credits = credits - 1 WHERE user_id=? AND credits>0'),

    addSpentStars: db.prepare('UPDATE users SET total_spent_stars = total_spent_stars + ? WHERE user_id=?'),
    setLastResult: db.prepare('UPDATE users SET last_result_url=? WHERE user_id=?'),

    insertPrompt: db.prepare('INSERT INTO prompts (title, text, message_id, created_at) VALUES (?, ?, ?, ?)'),
    listPrompts: db.prepare('SELECT id, COALESCE(title, "") as title, text, created_at FROM prompts ORDER BY id DESC LIMIT ?'),

    insertGen: db.prepare(`
      INSERT INTO generations (user_id, engine, prompt, aspect_ratio, task_id, status, result_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateGen: db.prepare('UPDATE generations SET status=?, result_url=? WHERE task_id=?'),
    listHistory: db.prepare('SELECT id, engine, prompt, status, result_url, created_at FROM generations WHERE user_id=? ORDER BY id DESC LIMIT ?'),

    insertPurchase: db.prepare('INSERT INTO purchases (user_id, payload, stars, credits_added, telegram_charge_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),

    hasReferral: db.prepare('SELECT 1 FROM referrals WHERE referrer_id=? AND referred_id=?'),
    insertReferral: db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referred_id, created_at) VALUES (?, ?, ?)'),
  };

  function upsertUser({ user_id, username, first_name, last_name, joined_at, last_active_at, credits, referred_by }) {
    const existing = stmt.getUser.get(user_id);
    if (!existing) {
      stmt.insertUser.run({
        user_id,
        username,
        first_name,
        last_name,
        joined_at,
        last_active_at,
        credits,
        referred_by,
      });
    } else {
      stmt.updateUserBasic.run({
        user_id,
        username,
        first_name,
        last_name,
        last_active_at,
      });
    }
    return stmt.getUser.get(user_id);
  }

  return {
    db,
    ...stmt,
    upsertUser: { run: upsertUser },
  };
}
