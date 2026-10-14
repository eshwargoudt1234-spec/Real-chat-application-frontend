/* ==========================================================
   chat.js - the whole chat screen
   REST   : users, history, conversations, mark-as-read
   STOMP  : live messages, receipts, typing, online/offline
   ========================================================== */
(function () {
  // ---------- guard: must be logged in ----------
  const token = getToken();
  const me = getUser();
  if (!token || !me) { location.href = 'login.html'; return; }

  // ---------- state ----------
  const state = {
    tab: 'chats',
    conversations: [],      // [{ user, lastMessage, unreadCount }]
    people: [],             // users shown in the People tab
    known: new Map(),       // userId -> user (cache)
    activeId: null,         // id of the user I am chatting with
    activePeer: null,
    messages: [],           // messages of the open chat
    stomp: null,
    connected: false,
    reconnectTimer: null,
    iAmTyping: false,
    typingTimeout: null,    // stops "I am typing" after I pause
    peerTypingTimeout: null // hides the peer's indicator if the stop event is lost
  };
  const RANK = { SENT: 0, DELIVERED: 1, READ: 2 };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const layout = $('layout'), userList = $('userList'), messagesBox = $('messages');
  const input = $('messageInput'), typingLine = $('typingLine');

  // ---------- small helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;     // textContent => safe from HTML injection
    return e;
  }
  function avatar(user, withDot) {
    const a = el('div', 'avatar', initials(user.name));
    a.style.background = 'hsl(' + ((user.id * 47) % 360) + ' 38% 36%)';
    if (withDot) a.appendChild(el('span', 'dot ' + (user.status === 'ONLINE' ? 'online' : '')));
    return a;
  }
  function parseDate(ts) { return new Date(String(ts).replace(/(\.\d{3})\d+/, '$1')); }  // keep 3 fraction digits (Safari-safe)
  function fmtTime(ts) { return parseDate(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function fmtDay(ts) {
    const d = parseDate(ts), today = new Date(), y = new Date();
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function toast(message, type) {
    const t = el('div', 'toast ' + (type || ''), message);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  function remember(user) { state.known.set(user.id, user); }
  async function ensureUser(id) {
    if (state.known.has(id)) return state.known.get(id);
    const u = await apiFetch('/api/users/' + id);
    remember(u);
    return u;
  }

  // ---------- profile (header) ----------
  $('meAvatar').replaceWith(Object.assign(avatar(me, false), { id: 'meAvatar' }));
  $('meName').textContent = me.name;
  $('meUsername').textContent = '@' + me.username;

  function setConnected(on) {
    state.connected = on;
    $('connDot').className = 'conn' + (on ? ' on' : '');
    $('connDot').title = on ? 'Connected' : 'Disconnected';
    $('connBanner').hidden = on;
    if (!on) $('connBanner').textContent = 'Connection lost. Trying to reconnect…';
  }

  // ---------- sidebar ----------
  function renderList() {
    userList.innerHTML = '';
    const items = state.tab === 'chats'
      ? state.conversations.map(c => ({ user: c.user, last: c.lastMessage, unread: c.unreadCount }))
      : state.people.map(u => ({ user: u }));

    if (!items.length) {
      userList.appendChild(el('li', 'list-empty',
        state.tab === 'chats' ? 'No conversations yet. Open the People tab to start one.'
                              : 'No users found.'));
      return;
    }
    items.forEach(it => {
      const li = el('li');
      const btn = el('button', 'user-item' + (it.user.id === state.activeId ? ' active' : ''));
      btn.type = 'button';
      btn.appendChild(avatar(it.user, true));

      const info = el('div', 'user-info');
      const top = el('div', 'user-top');
      top.appendChild(el('strong', '', it.user.name));
      if (it.last) top.appendChild(el('span', 'user-time', fmtTime(it.last.timestamp)));
      const sub = el('div', 'user-sub');
      const preview = it.last ? (it.last.senderId === me.id ? 'You: ' : '') + it.last.content : '@' + it.user.username;
      sub.appendChild(el('span', '', preview));
      if (it.unread > 0) sub.appendChild(el('span', 'badge', it.unread > 99 ? '99+' : String(it.unread)));
      info.append(top, sub);
      btn.appendChild(info);

      btn.addEventListener('click', () => openChat(it.user.id));
      li.appendChild(btn);
      userList.appendChild(li);
    });
  }

  async function loadPeople(search) {
    try {
      const q = search ? '?search=' + encodeURIComponent(search) : '';
      state.people = await apiFetch('/api/users' + q);
      state.people.forEach(remember);
      renderList();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function loadConversations() {
    try {
      state.conversations = await apiFetch('/api/messages/conversations');
      state.conversations.forEach(c => remember(c.user));
      renderList();
    } catch (e) { toast(e.message, 'error'); }
  }

  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderList();
  }

  let searchTimer = null;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const term = e.target.value.trim();
    searchTimer = setTimeout(() => {
      if (term) switchTab('people');
      loadPeople(term);
    }, 300);
  });

  // ---------- opening a chat ----------
  async function openChat(userId) {
    if (state.iAmTyping) stopTyping();
    try {
      const peer = await ensureUser(userId);
      state.activeId = userId;
      state.activePeer = peer;
      $('emptyState').hidden = true;
      $('chatView').hidden = false;
      layout.classList.add('chat-open');
      typingLine.hidden = true;
      renderPeerHeader();

      state.messages = await apiFetch('/api/messages/' + userId);
      renderMessages(true);
      await markRead(userId);
      renderList();
      if (window.matchMedia('(min-width: 769px)').matches) input.focus();
    } catch (e) { toast(e.message, 'error'); }
  }

  function closeChat() {                       // mobile "back" button
    if (state.iAmTyping) stopTyping();
    state.activeId = null;
    state.activePeer = null;
    layout.classList.remove('chat-open');
    $('chatView').hidden = true;
    $('emptyState').hidden = false;
    renderList();
  }
  $('backBtn').addEventListener('click', closeChat);

  function renderPeerHeader() {
    const p = state.activePeer;
    $('peerAvatar').replaceWith(Object.assign(avatar(p, false), { id: 'peerAvatar' }));
    $('peerName').textContent = p.name;
    const s = $('peerStatus');
    s.textContent = p.status === 'ONLINE' ? 'Online' : 'Offline';
    s.className = 'peer-status' + (p.status === 'ONLINE' ? ' online' : '');
  }

  async function markRead(userId) {
    const conv = state.conversations.find(c => c.user.id === userId);
    if (conv) conv.unreadCount = 0;
    try { await apiFetch('/api/messages/' + userId + '/read', { method: 'PUT' }); } catch (e) { /* not critical */ }
  }

  // ---------- messages ----------
  function tickFor(status) {
    const t = el('span', 'tick ' + status.toLowerCase(), status === 'SENT' ? '✓' : '✓✓');
    t.title = status.charAt(0) + status.slice(1).toLowerCase();
    return t;
  }

  function renderMessages(forceScroll) {
    const box = messagesBox;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const oldTop = box.scrollTop;
    box.innerHTML = '';

    if (!state.messages.length) {
      box.appendChild(el('div', 'day-divider', 'No messages yet. Say hello!'));
    }
    let lastDay = null;
    state.messages.forEach(m => {
      const day = parseDate(m.timestamp).toDateString();
      if (day !== lastDay) { box.appendChild(el('div', 'day-divider', fmtDay(m.timestamp))); lastDay = day; }

      const mine = m.senderId === me.id;
      const bubble = el('div', 'bubble ' + (mine ? 'sent' : 'received'));
      bubble.appendChild(document.createTextNode(m.content));
      const meta = el('div', 'meta');
      meta.appendChild(el('span', '', fmtTime(m.timestamp)));
      if (mine) meta.appendChild(tickFor(m.status));
      bubble.appendChild(meta);
      box.appendChild(bubble);
    });

    if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;   // auto-scroll to newest
    else box.scrollTop = oldTop;
  }

  function upsertConversation(user, message, bumpUnread) {
    const old = state.conversations.find(c => c.user.id === user.id);
    state.conversations = state.conversations.filter(c => c.user.id !== user.id);
    state.conversations.unshift({
      user: old ? old.user : user,
      lastMessage: message,
      unreadCount: (old ? old.unreadCount : 0) + (bumpUnread ? 1 : 0)
    });
  }

  // ---------- sending ----------
  $('messageForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { toast('Type a message before sending.', 'error'); return; }
    if (!state.connected || !state.stomp) { toast('Not connected yet. Reconnecting…', 'error'); return; }
    if (state.activeId == null) return;

    state.stomp.send('/app/chat', { 'content-type': 'application/json' },
      JSON.stringify({ receiverId: state.activeId, content: text }));
    input.value = '';
    if (state.iAmTyping) stopTyping();
  });

  // ---------- typing indicator (sending side) ----------
  function sendTyping(flag) {
    if (state.connected && state.stomp && state.activeId != null) {
      state.stomp.send('/app/typing', { 'content-type': 'application/json' },
        JSON.stringify({ receiverId: state.activeId, typing: flag }));
    }
  }
  function stopTyping() {
    clearTimeout(state.typingTimeout);
    state.iAmTyping = false;
    sendTyping(false);
  }
  input.addEventListener('input', () => {
    if (!input.value) { if (state.iAmTyping) stopTyping(); return; }
    if (!state.iAmTyping) { state.iAmTyping = true; sendTyping(true); }
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(stopTyping, 1500);          // no key for 1.5s => stopped typing
  });

  // ---------- incoming WebSocket events ----------
  async function onMessage(frame) {
    const m = JSON.parse(frame.body);
    const incoming = m.senderId !== me.id;
    const otherId = incoming ? m.senderId : m.receiverId;
    const isOpen = otherId === state.activeId;

    if (isOpen) {
      if (!state.messages.some(x => x.id === m.id)) state.messages.push(m);
      renderMessages(!incoming);                  // always jump down for my own messages
      if (incoming) { typingLine.hidden = true; markRead(otherId); }
    }
    try {
      const user = await ensureUser(otherId);
      upsertConversation(user, m, incoming && !isOpen);
      renderList();
    } catch (e) { /* ignore */ }
  }

  function onReceipt(frame) {                     // {type: "DELIVERED"|"READ", userId}
    const r = JSON.parse(frame.body);
    const apply = (msg) => {
      if (msg.senderId === me.id && msg.receiverId === r.userId && RANK[msg.status] < RANK[r.type]) msg.status = r.type;
    };
    state.messages.forEach(apply);
    state.conversations.forEach(c => apply(c.lastMessage));
    if (r.userId === state.activeId) renderMessages(false);
  }

  function onStatus(frame) {                      // {userId, username, status}
    const s = JSON.parse(frame.body);
    if (s.userId === me.id) return;
    const patch = (u) => { if (u && u.id === s.userId) u.status = s.status; };
    state.known.forEach(patch);
    state.people.forEach(patch);
    state.conversations.forEach(c => patch(c.user));
    if (state.activePeer && state.activePeer.id === s.userId) {
      state.activePeer.status = s.status;
      renderPeerHeader();
    }
    renderList();
  }

  function onTyping(frame) {                      // {senderId, senderName, typing}
    const t = JSON.parse(frame.body);
    if (t.senderId !== state.activeId) return;
    clearTimeout(state.peerTypingTimeout);
    if (t.typing) {
      typingLine.textContent = t.senderName + ' is typing…';
      typingLine.hidden = false;
      state.peerTypingTimeout = setTimeout(() => typingLine.hidden = true, 4000);  // safety net
    } else {
      typingLine.hidden = true;
    }
  }

  // ---------- WebSocket connection ----------
  function connect() {
    clearTimeout(state.reconnectTimer);
    const socket = new SockJS(WS_URL);
    const client = Stomp.over(socket);
    client.debug = null;                          // set to console.log to see STOMP frames
    state.stomp = client;

    client.connect({ Authorization: 'Bearer ' + token },
      function onConnected() {
        setConnected(true);
        client.subscribe('/user/queue/messages', onMessage);   // private: my messages
        client.subscribe('/user/queue/receipts', onReceipt);   // private: delivered/read
        client.subscribe('/user/queue/typing', onTyping);      // private: typing
        client.subscribe('/user/queue/errors', (f) => toast(JSON.parse(f.body).message, 'error'));
        client.subscribe('/topic/status', onStatus);           // public: online/offline
        refreshData();
      },
      function onError(err) {
        setConnected(false);
        const text = String((err && err.headers && err.headers.message) || err || '');
        if (text.indexOf('Unauthorized') !== -1) {             // bad/expired token
          clearSession();
          location.href = 'login.html?expired=1';
          return;
        }
        state.reconnectTimer = setTimeout(connect, 3000);      // try again in 3 seconds
      });
  }

  async function refreshData() {
    await Promise.all([loadConversations(), loadPeople($('searchInput').value.trim())]);
    if (state.activeId != null) {
      try {
        state.messages = await apiFetch('/api/messages/' + state.activeId);
        renderMessages(false);
        await markRead(state.activeId);
      } catch (e) { /* ignore */ }
    }
  }

  // ---------- logout ----------
  $('logoutBtn').addEventListener('click', () => {
    clearTimeout(state.reconnectTimer);
    if (state.stomp && state.connected) { try { state.stomp.disconnect(); } catch (e) {} }
    clearSession();
    location.href = 'login.html';
  });

  // ---------- start ----------
  (async function init() {
    try {
      const fresh = await apiFetch('/api/users/me');           // also verifies the token is still valid
      localStorage.setItem('chat_user', JSON.stringify(fresh));
    } catch (e) { toast(e.message, 'error'); }
    await loadConversations();
    if (!state.conversations.length) switchTab('people');
    await loadPeople('');
    connect();
  })();
})();
