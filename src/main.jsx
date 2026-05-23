import React from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  LogIn, MessageCircle, Send, Signal, Sparkles, UsersRound,
  Wifi, WifiOff, Hash, Search, X, ArrowDown, Bell, BellOff,
  Check, CheckCheck, Copy, CornerUpLeft, ChevronDown
} from 'lucide-react';
import './styles.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const socket = io(SOCKET_URL, { autoConnect: true, reconnectionDelay: 1000 });

const REACTIONS = ['👍','❤️','😂','😮','😢','🔥'];

function formatTime(value) {
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(`${value}Z`));
}

function formatDateLabel(value) {
  const d = new Date(`${value}Z`);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

function Avatar({ name, color, size = 32 }) {
  return (
    <div className="avatar" style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function groupMessagesByDate(messages) {
  const groups = [];
  let lastDate = null;
  for (const msg of messages) {
    const d = new Date(`${msg.created_at}Z`).toDateString();
    if (d !== lastDate) {
      groups.push({ type: 'separator', label: formatDateLabel(msg.created_at), key: `sep-${msg.created_at}` });
      lastDate = d;
    }
    groups.push({ type: 'message', msg });
  }
  return groups;
}

function ReplyPreview({ preview, onCancel }) {
  return (
    <div className="reply-preview">
      <div className="reply-preview-bar" />
      <div className="reply-preview-content">
        <span className="reply-preview-name">{preview.user_name}</span>
        <span className="reply-preview-text">{preview.body}</span>
      </div>
      {onCancel && (
        <button className="reply-preview-close" onClick={onCancel} aria-label="Cancelar respuesta">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function MessageBubble({ item, mine, currentUser, onReply, onReact, onCopy }) {
  const [showReactions, setShowReactions] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const hoverTimer = React.useRef(null);

  function handleCopy() {
    navigator.clipboard.writeText(item.body).then(() => {
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleMouseEnter() {
    clearTimeout(hoverTimer.current);
    setShowReactions(true);
  }

  function handleMouseLeave() {
    hoverTimer.current = setTimeout(() => setShowReactions(false), 300);
  }

  const myReactions = (item.reactions || []).filter(r => r.userIds.includes(currentUser.id)).map(r => r.emoji);

  return (
    <article
      className={`message ${mine ? 'mine' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!mine && <Avatar name={item.user_name} color={item.user_color} size={34} />}
      <div className="bubble-wrap">
        {item.reply_preview && <ReplyPreview preview={item.reply_preview} />}
        <div className="bubble">
          <div className="message-meta">
            <strong>{mine ? 'Tú' : item.user_name}</strong>
            <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
            {mine && (
              <span className="msg-status" title="Entregado">
                <CheckCheck size={13} strokeWidth={2.5} />
              </span>
            )}
          </div>
          <p>{item.body}</p>
        </div>

        {/* Reaction counts */}
        {(item.reactions || []).length > 0 && (
          <div className="reaction-counts">
            {(item.reactions || []).map(r => (
              <button
                key={r.emoji}
                className={`reaction-pill ${myReactions.includes(r.emoji) ? 'reacted' : ''}`}
                onClick={() => onReact(item.id, r.emoji)}
                title={`${r.count} reacción${r.count > 1 ? 'es' : ''}`}
              >
                {r.emoji} <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Action toolbar */}
        {showReactions && (
          <div className={`msg-toolbar ${mine ? 'toolbar-mine' : ''}`}>
            <div className="toolbar-reactions">
              {REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  className={`toolbar-emoji ${myReactions.includes(emoji) ? 'active' : ''}`}
                  onClick={() => { onReact(item.id, emoji); setShowReactions(false); }}
                  title={`Reaccionar con ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <button className="toolbar-btn" onClick={() => onReply(item)} title="Responder">
                <CornerUpLeft size={14} />
              </button>
              <button className="toolbar-btn" onClick={handleCopy} title="Copiar">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function App() {
  const [draftName, setDraftName] = React.useState(localStorage.getItem('chat:name') || '');
  const [currentUser, setCurrentUser] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const [onlineUsers, setOnlineUsers] = React.useState([]);
  const [rooms, setRooms] = React.useState([]);
  const [currentRoom, setCurrentRoom] = React.useState(null);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [typingUsers, setTypingUsers] = React.useState([]);
  const [connected, setConnected] = React.useState(socket.connected);
  const [joining, setJoining] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showSearch, setShowSearch] = React.useState(false);
  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  const messageEndRef = React.useRef(null);
  const messagesRef = React.useRef(null);
  const typingTimerRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const searchRef = React.useRef(null);
  const isAtBottomRef = React.useRef(true);

  React.useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('chat:message', (msg) => {
      setMessages(prev => [...prev, msg]);
      if (!isAtBottomRef.current) {
        setUnreadCount(c => c + 1);
      }
      if (soundEnabled && document.hidden) {
        playNotificationSound();
        if (Notification.permission === 'granted') {
          new Notification(`${msg.user_name}`, { body: msg.body, icon: '/favicon.ico' });
        }
      } else if (soundEnabled) {
        playNotificationSound();
      }
    });

    socket.on('presence:update', setOnlineUsers);
    socket.on('system:notice', (text) => {
      setNotice(text);
      window.setTimeout(() => setNotice(''), 3500);
    });
    socket.on('typing:update', setTypingUsers);
    socket.on('reaction:update', ({ messageId, reactions }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    });

    return () => {
      socket.off('connect'); socket.off('disconnect');
      socket.off('chat:message'); socket.off('presence:update');
      socket.off('system:notice'); socket.off('typing:update');
      socket.off('reaction:update');
    };
  }, [soundEnabled]);

  // Scroll tracking
  React.useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const handler = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      setIsAtBottom(atBottom);
      isAtBottomRef.current = atBottom;
      if (atBottom) setUnreadCount(0);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [currentUser]);

  React.useEffect(() => {
    if (isAtBottomRef.current) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  React.useEffect(() => {
    if (currentUser) inputRef.current?.focus();
  }, [currentUser]);

  React.useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  // Browser notification permission
  React.useEffect(() => {
    if (currentUser && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [currentUser]);

  function joinChat(e) {
    e.preventDefault();
    if (joining) return;
    setError(''); setJoining(true);
    socket.emit('chat:join', draftName, (res) => {
      setJoining(false);
      if (!res?.ok) { setError(res?.error || 'No pudimos entrar al chat.'); return; }
      localStorage.setItem('chat:name', res.user.name);
      setCurrentUser(res.user);
      setRooms(res.rooms || []);
      setCurrentRoom(res.rooms?.[0] || null);
      setMessages(res.messages || []);
    });
  }

  function switchRoom(room) {
    if (room.slug === currentRoom?.slug) return;
    socket.emit('room:join', room.slug, (res) => {
      if (!res?.ok) return;
      setCurrentRoom(res.room);
      setMessages(res.messages || []);
      setReplyTo(null);
      setSearchQuery('');
      setUnreadCount(0);
    });
  }

  function sendMessage(e) {
    e.preventDefault();
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    socket.emit('chat:message', { body: cleanMessage, replyToId: replyTo?.id || null }, (res) => {
      if (!res?.ok) setError(res?.error || 'No se pudo enviar el mensaje.');
    });
    setMessage(''); setReplyTo(null);
    socket.emit('typing:update', false);
    clearTimeout(typingTimerRef.current);
  }

  function handleTyping(value) {
    setMessage(value);
    socket.emit('typing:update', value.trim().length > 0);
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => socket.emit('typing:update', false), 1500);
  }

  function handleReact(messageId, emoji) {
    socket.emit('reaction:toggle', { messageId, emoji });
  }

  function scrollToBottom() {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setUnreadCount(0);
  }

  function buildTypingText() {
    if (!typingUsers.length) return '';
    if (typingUsers.length === 1) return `${typingUsers[0]} está escribiendo...`;
    if (typingUsers.length === 2) return `${typingUsers[0]} y ${typingUsers[1]} están escribiendo...`;
    return 'Varios usuarios están escribiendo...';
  }

  const filteredMessages = searchQuery.trim()
    ? messages.filter(m => m.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.user_name.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const grouped = groupMessagesByDate(filteredMessages);

  // ── Entry screen ─────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <main className="entry-shell">
        <div className="entry-glow" aria-hidden="true" />
        <section className="entry-panel">
          <div className="brand-mark">
            <MessageCircle size={28} strokeWidth={2.5} />
          </div>
          <p className="eyebrow">Chat en tiempo real</p>
          <h1>Entra y empieza a<br />conversar.</h1>
          <form onSubmit={joinChat} className="entry-form" noValidate>
            <label htmlFor="name">Tu nombre visible</label>
            <input
              id="name" type="text" minLength={2} maxLength={28}
              autoFocus autoComplete="nickname" placeholder="Ej. Johan"
              value={draftName} onChange={(e) => setDraftName(e.target.value)} disabled={joining}
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" disabled={joining || draftName.trim().length < 2} className="btn-primary">
              <LogIn size={17} strokeWidth={2.5} />
              {joining ? 'Entrando…' : 'Entrar al chat'}
            </button>
          </form>
          <p className="entry-hint">Sin registro · Solo escribe tu nombre</p>
        </section>
      </main>
    );
  }

  // ── Chat screen ──────────────────────────────────────────────────────
  return (
    <main className="chat-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <MessageCircle size={20} strokeWidth={2.5} />
          <span>TreeNChat</span>
        </div>

        <div className="status-card">
          <span className={`status-dot ${connected ? 'online' : ''}`} />
          <div>
            <strong>{connected ? 'Conectado' : 'Reconectando…'}</strong>
            <p>{currentUser.name}</p>
          </div>
          {connected ? <Wifi size={16} className="conn-icon online" /> : <WifiOff size={16} className="conn-icon" />}
        </div>

        {/* Rooms */}
        <section className="rooms-panel" aria-label="Canales">
          <div className="panel-title">
            <Hash size={14} />
            <span>Canales</span>
          </div>
          <div className="room-list">
            {rooms.map(room => (
              <button
                key={room.id}
                className={`room-item ${currentRoom?.slug === room.slug ? 'active' : ''}`}
                onClick={() => switchRoom(room)}
                title={room.description || room.name}
              >
                <Hash size={14} className="room-hash" />
                <span>{room.name}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Online users */}
        <section className="users-panel" aria-label="Usuarios en línea">
          <div className="panel-title">
            <UsersRound size={14} />
            <span>En línea</span>
            <b className="count-badge">{onlineUsers.length}</b>
          </div>
          <div className="user-list">
            {onlineUsers.map((user) => (
              <div className="user-pill" key={user.id}>
                <Avatar name={user.name} color={user.color} size={26} />
                <span className={user.id === currentUser.id ? 'you' : ''}>{user.name}</span>
                {user.id === currentUser.id && <span className="you-tag">Tú</span>}
              </div>
            ))}
            {onlineUsers.length === 0 && <p className="empty-users">Nadie conectado</p>}
          </div>
        </section>

        <div className="sidebar-footer">
          <Signal size={13} />
          <span>Socket.IO · SQLite</span>
        </div>
      </aside>

      {/* Chat panel */}
      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">#{currentRoom?.name || 'general'}</p>
            <h2>{currentRoom?.description || 'Canal principal'}</h2>
          </div>
          <div className="header-actions">
            <button
              className={`icon-btn ${showSearch ? 'active' : ''}`}
              onClick={() => { setShowSearch(v => !v); setSearchQuery(''); }}
              title="Buscar mensajes"
              aria-label="Buscar mensajes"
            >
              <Search size={17} />
            </button>
            <button
              className={`icon-btn ${soundEnabled ? '' : 'muted'}`}
              onClick={() => setSoundEnabled(v => !v)}
              title={soundEnabled ? 'Silenciar' : 'Activar sonido'}
              aria-label={soundEnabled ? 'Silenciar notificaciones' : 'Activar notificaciones'}
            >
              {soundEnabled ? <Bell size={17} /> : <BellOff size={17} />}
            </button>
            <div className={`conn-badge ${connected ? 'online' : ''}`}>
              <span className="conn-dot" />
              {connected ? 'En vivo' : 'Desconectado'}
            </div>
          </div>
        </header>

        {/* Search bar */}
        {showSearch && (
          <div className="search-bar">
            <Search size={15} className="search-icon" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar mensajes o usuarios…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
                <X size={14} />
              </button>
            )}
            <span className="search-count">
              {searchQuery ? `${filteredMessages.length} resultado${filteredMessages.length !== 1 ? 's' : ''}` : ''}
            </span>
          </div>
        )}

        {/* Messages */}
        <div className="messages" role="log" aria-live="polite" aria-label="Mensajes" ref={messagesRef}>
          {grouped.length === 0 && (
            <div className="empty-chat">
              <MessageCircle size={36} strokeWidth={1.5} />
              <p>{searchQuery ? 'Sin resultados para esa búsqueda.' : 'Sé el primero en escribir algo.'}</p>
            </div>
          )}

          {grouped.map((item) => {
            if (item.type === 'separator') {
              return (
                <div className="date-separator" key={item.key}>
                  <span className="date-label">{item.label}</span>
                </div>
              );
            }
            const { msg } = item;
            const mine = msg.user_id === currentUser.id;
            return (
              <MessageBubble
                key={msg.id}
                item={msg}
                mine={mine}
                currentUser={currentUser}
                onReply={setReplyTo}
                onReact={handleReact}
                onCopy={() => {}}
              />
            );
          })}
          <div ref={messageEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {!isAtBottom && (
          <button className="scroll-bottom-btn" onClick={scrollToBottom} aria-label="Ir al final">
            {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
            <ArrowDown size={16} />
          </button>
        )}

        {/* Notice */}
        {notice && (
          <div className="notice" role="status">
            <Sparkles size={13} />
            {notice}
          </div>
        )}

        {/* Typing bar */}
        <div className="typing-bar" aria-live="polite">
          {typingUsers.length > 0 && (
            <>
              <span className="typing-dots"><i /><i /><i /></span>
              {buildTypingText()}
            </>
          )}
        </div>

        {error && <p className="inline-error" role="alert">{error}</p>}

        {/* Reply preview */}
        {replyTo && (
          <div className="composer-reply">
            <CornerUpLeft size={14} className="reply-icon" />
            <ReplyPreview preview={{ user_name: replyTo.user_name || replyTo.user_name, body: replyTo.body }} onCancel={() => setReplyTo(null)} />
          </div>
        )}

        {/* Composer */}
        <form className="composer" onSubmit={sendMessage}>
          <input
            ref={inputRef}
            type="text"
            maxLength={600}
            placeholder={`Mensaje en #${currentRoom?.name || 'general'}…`}
            value={message}
            onChange={(e) => handleTyping(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" aria-label="Enviar mensaje" disabled={!message.trim()} className="send-btn">
            <Send size={18} strokeWidth={2.5} />
          </button>
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);