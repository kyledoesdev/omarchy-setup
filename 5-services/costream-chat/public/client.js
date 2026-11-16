// Shared by the OBS overlay and the desktop panels: the live event stream and
// message rendering. User text is only ever set with textContent.

export const ICONS = {
  twitch:
    '<svg viewBox="0 0 24 24" aria-label="Twitch"><rect width="24" height="24" rx="5" fill="#9146FF"/><g transform="translate(4.4 3.6) scale(0.64)"><path fill="#fff" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></g></svg>',
  youtube:
    '<svg viewBox="0 0 24 24" aria-label="YouTube"><rect x="0.5" y="3.5" width="23" height="17" rx="5" fill="#FF0000"/><path d="M9.6 8v8l6.6-4z" fill="#fff"/></svg>',
  owner:
    '<svg viewBox="0 0 16 16" aria-label="Owner"><path fill="#FFD600" d="M2 12h12l1-7-4 3-3-5-3 5-4-3z"/></svg>',
  mod: '<svg viewBox="0 0 16 16" aria-label="Moderator"><path fill="#5E84F1" d="M9.8 1.5a4 4 0 0 0-4 5.1L1.5 10.9a1.5 1.5 0 0 0 2.1 2.1l4.3-4.3a4 4 0 0 0 5.1-4.9l-2.3 2.3-2-.5-.5-2 2.3-2.3a4 4 0 0 0-.7-.1z"/></svg>',
  verified:
    '<svg viewBox="0 0 16 16" aria-label="Verified"><circle cx="8" cy="8" r="7" fill="#aaa"/><path d="M4.5 8.2l2.3 2.3 4.7-4.8" stroke="#111" stroke-width="1.8" fill="none"/></svg>',
};

// Opens the event stream. EventSource reconnects on its own; every reconnect
// starts with a fresh "hello" carrying recent history, so pages just rebuild.
export function connect(handlers) {
  const es = new EventSource('/events');
  for (const [type, fn] of Object.entries(handlers)) {
    es.addEventListener(type, (ev) => fn(JSON.parse(ev.data)));
  }
  es.onerror = () => handlers.down?.();
  return es;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name, cls) {
  const s = el('span', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}

export function renderParts(parts, into) {
  for (const p of parts || []) {
    if (p.t === 'emote') {
      const img = el('img', p.big ? 'emote sticker' : 'emote');
      img.src = p.url;
      img.alt = p.alt || '';
      img.title = p.alt || '';
      img.referrerPolicy = 'no-referrer';
      into.append(img);
    } else {
      into.append(document.createTextNode(p.v));
    }
  }
}

export function renderMessage(m) {
  const row = el('div', `msg pf-${m.platform} kind-${m.kind || 'chat'}${m.action ? ' action' : ''}`);
  row.dataset.platform = m.platform;
  row.dataset.id = m.id || '';
  row.dataset.user = m.userId || '';

  if (m.kind === 'superchat' || m.kind === 'member' || (m.kind === 'highlight' && m.note)) {
    const head = el('div', 'msg-head');
    if (m.amount) head.append(el('span', 'amount', m.amount));
    if (m.note) head.append(el('span', 'note', m.note));
    if (m.headerBg) head.style.background = m.headerBg;
    row.append(head);
  }
  if (m.bg) row.style.setProperty('--card', m.bg);

  const line = el('div', 'line');
  const meta = el('span', 'meta');
  meta.append(icon(m.platform, 'pf'));
  for (const b of m.badges || []) {
    if (b.icon) {
      const s = icon(b.icon, 'badge');
      s.title = b.title || '';
      meta.append(s);
    } else if (b.url) {
      const img = el('img', 'badge');
      img.src = b.url;
      img.alt = b.title || '';
      img.title = b.title || '';
      img.referrerPolicy = 'no-referrer';
      meta.append(img);
    }
  }
  const name = el('span', 'name', m.name);
  if (m.color) name.style.color = m.color;
  meta.append(name);
  line.append(meta);
  if (m.parts?.length) {
    line.append(el('span', 'colon', m.action ? ' ' : ': '));
    const body = el('span', 'body');
    if (m.action && m.color) body.style.color = m.color;
    renderParts(m.parts, body);
    line.append(body);
  }
  row.append(line);
  return row;
}

// Removes rendered messages that a moderator deleted or that belong to a
// timed-out/banned user.
export function applyRemoval(container, type, d) {
  let sel;
  if (type === 'delete') sel = `.msg[data-platform="${d.platform}"][data-id="${CSS.escape(d.id || '')}"]`;
  else if (type === 'clear-user') sel = `.msg[data-platform="${d.platform}"][data-user="${CSS.escape(d.userId || '')}"]`;
  else if (type === 'clear-all') sel = `.msg[data-platform="${d.platform}"]`;
  if (sel) container.querySelectorAll(sel).forEach((n) => n.remove());
}

export function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
