import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'chat.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     INTEGER NOT NULL DEFAULT 1,
    user_id     INTEGER NOT NULL,
    user_name   TEXT NOT NULL,
    user_color  TEXT NOT NULL,
    body        TEXT NOT NULL,
    reply_to_id INTEGER,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (reply_to_id) REFERENCES messages(id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(message_id);
`);

// Seed default rooms
const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
if (roomCount === 0) {
  db.prepare('INSERT INTO rooms (slug, name, description) VALUES (?, ?, ?)').run('general', 'general', 'El canal principal');
  db.prepare('INSERT INTO rooms (slug, name, description) VALUES (?, ?, ?)').run('random', 'random', 'Conversación libre');
  db.prepare('INSERT INTO rooms (slug, name, description) VALUES (?, ?, ?)').run('tech', 'tech', 'Tecnología y código');
}

const palette = [
  '#2563eb','#0f766e','#be123c','#7c3aed',
  '#c2410c','#15803d','#0369a1','#b45309',
  '#6d28d9','#0e7490','#b91c1c','#4f46e5'
];

function pickColor(name) {
  const total = [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return palette[total % palette.length];
}

export function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 28);
}

const stmts = {
  findUser:      db.prepare('SELECT * FROM users WHERE lower(name) = lower(?)'),
  touchUser:     db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?'),
  insertUser:    db.prepare('INSERT INTO users (name, color) VALUES (?, ?)'),
  getUser:       db.prepare('SELECT * FROM users WHERE id = ?'),
  insertMsg:     db.prepare('INSERT INTO messages (room_id, user_id, user_name, user_color, body, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)'),
  getMsg:        db.prepare('SELECT * FROM messages WHERE id = ?'),
  recentMsgs:    db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?'),
  allRooms:      db.prepare('SELECT * FROM rooms ORDER BY id ASC'),
  getRoom:       db.prepare('SELECT * FROM rooms WHERE slug = ?'),
  getReactions:  db.prepare('SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as user_ids FROM reactions WHERE message_id = ? GROUP BY emoji'),
  addReaction:   db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'),
  removeReaction:db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  hasReaction:   db.prepare('SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
};

export function getOrCreateUser(name) {
  const cleanName = normalizeName(name);
  if (cleanName.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');
  const existing = stmts.findUser.get(cleanName);
  if (existing) { stmts.touchUser.run(existing.id); return existing; }
  const color = pickColor(cleanName);
  const { lastInsertRowid } = stmts.insertUser.run(cleanName, color);
  return stmts.getUser.get(lastInsertRowid);
}

export function addMessage(user, body, roomId = 1, replyToId = null) {
  const cleanBody = String(body || '').trim().slice(0, 600);
  if (!cleanBody) throw new Error('El mensaje no puede estar vacío.');
  const { lastInsertRowid } = stmts.insertMsg.run(roomId, user.id, user.name, user.color, cleanBody, replyToId || null);
  const msg = stmts.getMsg.get(lastInsertRowid);
  // Attach reply preview if applicable
  if (msg.reply_to_id) {
    const parent = stmts.getMsg.get(msg.reply_to_id);
    if (parent) msg.reply_preview = { id: parent.id, user_name: parent.user_name, body: parent.body.slice(0, 80) };
  }
  msg.reactions = [];
  return msg;
}

export function getRecentMessages(roomId = 1, limit = 80) {
  const msgs = stmts.recentMsgs.all(roomId, limit).reverse();
  return msgs.map(msg => {
    const reactions = stmts.getReactions.all(msg.id).map(r => ({
      emoji: r.emoji,
      count: r.count,
      userIds: r.user_ids.split(',').map(Number)
    }));
    if (msg.reply_to_id) {
      const parent = stmts.getMsg.get(msg.reply_to_id);
      if (parent) msg.reply_preview = { id: parent.id, user_name: parent.user_name, body: parent.body.slice(0, 80) };
    }
    return { ...msg, reactions };
  });
}

export function toggleReaction(messageId, userId, emoji) {
  const existing = stmts.hasReaction.get(messageId, userId, emoji);
  if (existing) {
    stmts.removeReaction.run(messageId, userId, emoji);
  } else {
    stmts.addReaction.run(messageId, userId, emoji);
  }
  return stmts.getReactions.all(messageId).map(r => ({
    emoji: r.emoji,
    count: r.count,
    userIds: r.user_ids.split(',').map(Number)
  }));
}

export function getRooms() { return stmts.allRooms.all(); }
export function getRoom(slug) { return stmts.getRoom.get(slug); }
export function touchUser(userId) { stmts.touchUser.run(userId); }
