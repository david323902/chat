import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { addMessage, getOrCreateUser, getRecentMessages, getRooms, toggleReaction, touchUser } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const port = process.env.PORT || 4000;

// socketId -> { user, typing, roomSlug }
const onlineUsers = new Map();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, online: onlineUsers.size, ts: new Date().toISOString() });
});

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 10000
});

function publicUser(user) {
  return { id: user.id, name: user.name, color: user.color };
}

function broadcastOnlineUsers() {
  io.emit('presence:update', [...onlineUsers.values()].map(({ user }) => publicUser(user)));
}

function roomChannel(slug) {
  return `room:${slug}`;
}

io.on('connection', (socket) => {

  socket.on('chat:join', (rawName, callback) => {
    try {
      const user = getOrCreateUser(rawName);
      onlineUsers.set(socket.id, { user, typing: false, roomSlug: 'general' });
      socket.data.user = user;

      const rooms = getRooms();

      callback?.({
        ok: true,
        user: publicUser(user),
        rooms,
        messages: getRecentMessages(1)
      });

      socket.join(roomChannel('general'));
      socket.broadcast.emit('system:notice', `${user.name} se unió al chat`);
      broadcastOnlineUsers();
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', (slug, callback) => {
    try {
      const session = onlineUsers.get(socket.id);
      if (!session) throw new Error('No autenticado.');

      const rooms = getRooms();
      const room = rooms.find(r => r.slug === slug);
      if (!room) throw new Error('Sala no encontrada.');

      // Leave previous room channel
      if (session.roomSlug) socket.leave(roomChannel(session.roomSlug));

      socket.join(roomChannel(slug));
      onlineUsers.set(socket.id, { ...session, roomSlug: slug });

      callback?.({
        ok: true,
        room,
        messages: getRecentMessages(room.id)
      });
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on('chat:message', ({ body, replyToId } = {}, callback) => {
    try {
      if (!socket.data.user) throw new Error('Debes entrar con un nombre antes de enviar mensajes.');
      const session = onlineUsers.get(socket.id);
      const rooms = getRooms();
      const room = rooms.find(r => r.slug === (session?.roomSlug || 'general'));
      if (!room) throw new Error('Sala no encontrada.');

      const message = addMessage(socket.data.user, body, room.id, replyToId);
      touchUser(socket.data.user.id);

      // Broadcast to everyone in the room
      io.to(roomChannel(room.slug)).emit('chat:message', { ...message, room_slug: room.slug });
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on('reaction:toggle', ({ messageId, emoji } = {}, callback) => {
    try {
      if (!socket.data.user) throw new Error('No autenticado.');
      const session = onlineUsers.get(socket.id);
      const reactions = toggleReaction(messageId, socket.data.user.id, emoji);
      const roomSlug = session?.roomSlug || 'general';
      io.to(roomChannel(roomSlug)).emit('reaction:update', { messageId, reactions });
      callback?.({ ok: true, reactions });
    } catch (error) {
      callback?.({ ok: false, error: error.message });
    }
  });

  socket.on('typing:update', (isTyping) => {
    const session = onlineUsers.get(socket.id);
    if (!session) return;
    onlineUsers.set(socket.id, { ...session, typing: Boolean(isTyping) });
    const typingUsers = [...onlineUsers.values()]
      .filter(({ typing, user, roomSlug }) => typing && user.id !== session.user.id && roomSlug === session.roomSlug)
      .map(({ user }) => user.name);
    socket.to(roomChannel(session.roomSlug)).emit('typing:update', typingUsers);
  });

  socket.on('disconnect', () => {
    const session = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    if (session) {
      socket.broadcast.emit('system:notice', `${session.user.name} salió del chat`);
      broadcastOnlineUsers();
    }
  });
});

const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get(/.*/, (_req, res) => res.sendFile(join(distPath, 'index.html')));

server.listen(port, () => {
  console.log(`✅ Chat listo en http://localhost:${port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Puerto ${port} ocupado. Ejecuta: npx kill-port ${port}`);
    process.exit(1);
  } else { throw err; }
});

function shutdown(signal) {
  console.log(`\n${signal} recibido. Cerrando servidor...`);
  io.close();
  server.close(() => { console.log('Servidor cerrado.'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
