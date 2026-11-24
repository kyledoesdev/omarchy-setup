// costream-chat: one local service for co-streaming Spacelamp6 to Twitch and YouTube.
//
//   - Reads Twitch chat (anonymous, read-only) and YouTube live chat (no login,
//     via youtubei.js) and merges them.
//   - Serves pages on http://127.0.0.1:<port>:
//       /overlay            OBS browser source: merged chat with platform icons
//       /youtube-chat       desktop panel: YouTube chat only
//       /youtube-activity   desktop panel: Super Chats, stickers, members, gifts
//       /chat               desktop panel: both chats merged
//       /open/youtube-chat  jumps to YouTube's own popout chat (mod tools)
//   - Talks to OBS over obs-websocket: when the main (Twitch) stream starts or
//     stops, it starts or stops the Aitum Multistream outputs (YouTube) too.
//
// Settings live in config.json next to this file.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Innertube, YTNodes, Log } from 'youtubei.js';

Log.setLevel(Log.Level.ERROR);

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const expand = (p) => p.replace(/^~(?=\/|$)/, HOME);
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
// For testing against other channels without touching config.json.
if (process.env.COSTREAM_PORT) config.port = Number(process.env.COSTREAM_PORT);
if (process.env.COSTREAM_TWITCH) config.twitch.channel = process.env.COSTREAM_TWITCH;
if (process.env.COSTREAM_YOUTUBE) config.youtube.channelId = process.env.COSTREAM_YOUTUBE;
if (process.env.COSTREAM_NO_OBS) config.obs.disabled = true;
const STATE_DIR = path.join(process.env.XDG_STATE_HOME || path.join(HOME, '.local/state'), 'costream-chat');
fs.mkdirSync(STATE_DIR, { recursive: true });

const log = (tag, ...a) => console.log(`[${tag}]`, ...a);

function notify(title, body) {
  execFile('notify-send', ['-a', 'Co-stream', title, body], () => {});
}

// ---------------------------------------------------------------------------
// Hub: recent history, live status, and Server-Sent Events to every page.

const HISTORY_MAX = 150;
const ACTIVITY_MAX = 100;
const ACTIVITY_FILE = path.join(STATE_DIR, 'youtube-activity.json');
const history = [];
let activity = [];
try {
  activity = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
} catch {}
const clients = new Set();

const status = {
  twitch: { connected: false, channel: config.twitch.channel },
  youtube: { state: 'offline', videoId: null, title: null, viewers: null, likes: null, chat: false },
  obs: { connected: false, note: null, streaming: false, outputs: {} },
};

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(type, data) {
  for (const res of clients) send(res, type, data);
}
function setStatus(section, patch) {
  Object.assign(status[section], patch);
  broadcast('status', status);
}
function pushMessage(m) {
  history.push(m);
  if (history.length > HISTORY_MAX) history.shift();
  broadcast('msg', m);
}
function deleteMessage(platform, id) {
  const i = history.findIndex((m) => m.platform === platform && m.id === id);
  if (i >= 0) history.splice(i, 1);
  broadcast('delete', { platform, id });
}
function clearUser(platform, userId) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].platform === platform && history[i].userId === userId) history.splice(i, 1);
  }
  broadcast('clear-user', { platform, userId });
}
function clearPlatform(platform) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].platform === platform) history.splice(i, 1);
  broadcast('clear-all', { platform });
}
let activitySaveTimer = null;
function pushActivity(ev) {
  activity.push(ev);
  if (activity.length > ACTIVITY_MAX) activity = activity.slice(-ACTIVITY_MAX);
  broadcast('activity', ev);
  clearTimeout(activitySaveTimer);
  activitySaveTimer = setTimeout(() => {
    fs.writeFile(ACTIVITY_FILE, JSON.stringify(activity), () => {});
  }, 1000);
}

// Turn plain text into parts, swapping in third-party emotes (7TV/BTTV/FFZ).
function textParts(text, emoteMap) {
  const parts = [];
  let buf = '';
  for (const tok of text.split(/(\s+)/)) {
    const url = emoteMap && tok && emoteMap.get(tok);
    if (url) {
      if (buf) parts.push({ t: 'text', v: buf });
      buf = '';
      parts.push({ t: 'emote', url, alt: tok });
    } else {
      buf += tok;
    }
  }
  if (buf) parts.push({ t: 'text', v: buf });
  return parts;
}

// ---------------------------------------------------------------------------
// Twitch: anonymous IRC over WebSocket. Read-only, so no login or token needed.

const twitch = {
  ws: null,
  roomId: null,
  badges: new Map(), // "set/version" -> { url, title }
  emotes: new Map(), // third-party emote name -> url
  backoff: 1000,
  badgeTimer: null,
  badgeRetry: 15000,
};

const TWITCH_DEFAULT_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
function hashColor(name, palette) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return palette[h % palette.length];
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'costream-chat/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Badge images and titles, global first so the channel's own sub badges win.
// At boot the network is often not up yet, so a failed load retries soon
// (15s, doubling up to 10 min) instead of waiting for the 6-hour refresh.
// Whatever did load is kept, so one failed request never empties the list.
async function loadTwitchBadges() {
  clearTimeout(twitch.badgeTimer);
  const map = new Map(twitch.badges);
  const add = (sets) => {
    for (const set of sets || []) {
      for (const v of set.versions || []) {
        map.set(`${set.set_id}/${v.id}`, { url: v.image_url_2x || v.image_url_1x, title: v.title || set.set_id });
      }
    }
  };
  const results = await Promise.allSettled([
    getJson('https://api.ivr.fi/v2/twitch/badges/global'),
    getJson(`https://api.ivr.fi/v2/twitch/badges/channel?login=${encodeURIComponent(config.twitch.channel)}`),
  ]);
  const failed = results.filter((r) => r.status === 'rejected');
  for (const r of results) if (r.status === 'fulfilled') add(r.value);
  twitch.badges = map;
  if (failed.length) {
    log('twitch', `badge load failed (${failed.map((r) => r.reason?.message).join(', ')}), ${map.size} badges so far, retrying in ${twitch.badgeRetry / 1000}s`);
    twitch.badgeTimer = setTimeout(loadTwitchBadges, twitch.badgeRetry);
    twitch.badgeRetry = Math.min(twitch.badgeRetry * 2, 10 * 60 * 1000);
    return;
  }
  log('twitch', `loaded ${map.size} badges`);
  twitch.badgeRetry = 15000;
  twitch.badgeTimer = setTimeout(loadTwitchBadges, 6 * 3600 * 1000);
}

// A badge version that isn't in the list (a sub tier the channel added since
// the last load, say) gets the closest lower version from the same set. Sub
// badges stay within their tier: 3018 means tier 3 at 18 months, so it
// falls back to 3012, never 2024.
function findTwitchBadge(key) {
  const exact = twitch.badges.get(key);
  if (exact) return exact;
  const [set, version] = key.split('/');
  const wanted = Number(version);
  if (!set || !Number.isFinite(wanted)) return null;
  const tier = (n) => (set === 'subscriber' ? Math.floor(n / 1000) : 0);
  let best = null;
  let bestVersion = -Infinity;
  for (const [k, badge] of twitch.badges) {
    const [s, v] = k.split('/');
    const n = Number(v);
    if (s === set && Number.isFinite(n) && n <= wanted && n > bestVersion && tier(n) === tier(wanted)) {
      best = badge;
      bestVersion = n;
    }
  }
  return best;
}

async function loadThirdPartyEmotes() {
  if (!twitch.roomId) return;
  const id = twitch.roomId;
  const map = new Map();
  const add = (name, url) => {
    if (name && url && !map.has(name)) map.set(name, url);
  };
  const sevenTv = (emotes) => {
    for (const e of emotes || []) {
      const host = e.data?.host?.url;
      if (host) add(e.name, `https:${host}/2x.webp`);
    }
  };
  const tasks = [
    // Channel emotes first so they win over globals with the same name.
    getJson(`https://7tv.io/v3/users/twitch/${id}`).then((j) => sevenTv(j.emote_set?.emotes)),
    getJson(`https://api.betterttv.net/3/cached/users/twitch/${id}`).then((j) => {
      for (const e of [...(j.channelEmotes || []), ...(j.sharedEmotes || [])]) add(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`);
    }),
    getJson(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${id}`).then((j) => {
      for (const e of j || []) add(e.code, e.images?.['2x'] || e.images?.['1x']);
    }),
  ];
  for (const r of await Promise.allSettled(tasks)) if (r.status === 'rejected') log('twitch', 'emotes:', r.reason?.message);
  const globals = [
    getJson('https://7tv.io/v3/emote-sets/global').then((j) => sevenTv(j.emotes)),
    getJson('https://api.betterttv.net/3/cached/emotes/global').then((j) => {
      for (const e of j || []) add(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`);
    }),
    getJson('https://api.betterttv.net/3/cached/frankerfacez/emotes/global').then((j) => {
      for (const e of j || []) add(e.code, e.images?.['2x'] || e.images?.['1x']);
    }),
  ];
  for (const r of await Promise.allSettled(globals)) if (r.status === 'rejected') log('twitch', 'emotes:', r.reason?.message);
  if (map.size) twitch.emotes = map;
  log('twitch', `loaded ${map.size} 7TV/BTTV/FFZ emotes`);
}

function unescapeTag(v) {
  return v.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' })[c] ?? c);
}

function parseIrc(line) {
  const tags = {};
  let rest = line;
  let prefix = null;
  if (rest[0] === '@') {
    const sp = rest.indexOf(' ');
    for (const kv of rest.slice(1, sp).split(';')) {
      const eq = kv.indexOf('=');
      if (eq < 0) tags[kv] = '';
      else tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
    }
    rest = rest.slice(sp + 1);
  }
  if (rest[0] === ':') {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  let trailing = null;
  const ti = rest.indexOf(' :');
  if (ti >= 0) {
    trailing = rest.slice(ti + 2);
    rest = rest.slice(0, ti);
  }
  const params = rest.split(' ').filter(Boolean);
  const command = params.shift();
  return { tags, prefix, command, params, trailing };
}

// Twitch emote positions count Unicode code points, not UTF-16 units.
function twitchParts(text, emotesTag) {
  const chars = [...text];
  const ranges = [];
  if (emotesTag) {
    for (const group of emotesTag.split('/')) {
      const [id, positions] = group.split(':');
      if (!positions) continue;
      for (const p of positions.split(',')) {
        const [s, e] = p.split('-').map(Number);
        ranges.push({ s, e, id });
      }
    }
  }
  ranges.sort((a, b) => a.s - b.s);
  const parts = [];
  let i = 0;
  for (const r of ranges) {
    if (r.s < i) continue;
    if (r.s > i) parts.push(...textParts(chars.slice(i, r.s).join(''), twitch.emotes));
    parts.push({ t: 'emote', url: `https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/2.0`, alt: chars.slice(r.s, r.e + 1).join('') });
    i = r.e + 1;
  }
  if (i < chars.length) parts.push(...textParts(chars.slice(i).join(''), twitch.emotes));
  return parts;
}

function twitchBadges(tag) {
  if (!tag) return [];
  return tag
    .split(',')
    .map(findTwitchBadge)
    .filter(Boolean);
}

function twitchMessage(tags, text, extra = {}) {
  let action = false;
  if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) {
    action = true;
    text = text.slice(8, -1);
  }
  const name = tags['display-name'] || tags.login || 'someone';
  return {
    platform: 'twitch',
    id: tags.id,
    userId: tags['user-id'],
    name,
    color: tags.color || hashColor(name, TWITCH_DEFAULT_COLORS),
    badges: twitchBadges(tags.badges),
    parts: twitchParts(text, tags.emotes),
    action,
    ts: Number(tags['tmi-sent-ts']) || Date.now(),
    kind: tags['msg-id'] === 'highlighted-message' ? 'highlight' : tags.bits ? 'bits' : 'chat',
    bits: tags.bits ? Number(tags.bits) : undefined,
    ...extra,
  };
}

function handleTwitchLine(line) {
  const m = parseIrc(line);
  switch (m.command) {
    case 'PING':
      twitch.ws?.send(`PONG :${m.trailing || 'tmi.twitch.tv'}`);
      break;
    case 'RECONNECT':
      twitch.ws?.close();
      break;
    case 'ROOMSTATE':
      if (m.tags['room-id'] && m.tags['room-id'] !== twitch.roomId) {
        twitch.roomId = m.tags['room-id'];
        loadThirdPartyEmotes();
      }
      break;
    case 'JOIN':
      if (!status.twitch.connected) log('twitch', `joined #${config.twitch.channel}`);
      setStatus('twitch', { connected: true });
      twitch.backoff = 1000;
      break;
    case 'PRIVMSG':
      pushMessage(twitchMessage(m.tags, m.trailing || ''));
      break;
    case 'USERNOTICE': {
      // Subs, resubs, gifts, raids... Twitch's own activity feed covers these,
      // so only resubs that carry a viewer's message are shown in chat.
      if (m.trailing) pushMessage(twitchMessage(m.tags, m.trailing, { kind: 'highlight', note: m.tags['system-msg'] }));
      break;
    }
    case 'CLEARMSG':
      if (m.tags['target-msg-id']) deleteMessage('twitch', m.tags['target-msg-id']);
      break;
    case 'CLEARCHAT':
      if (m.tags['target-user-id']) clearUser('twitch', m.tags['target-user-id']);
      else clearPlatform('twitch');
      break;
  }
}

function connectTwitch() {
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  twitch.ws = ws;
  let buffer = '';
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS SCHMOOPIIE');
    ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
    ws.send(`JOIN #${config.twitch.channel.toLowerCase()}`);
  };
  ws.onmessage = (ev) => {
    buffer += ev.data;
    const lines = buffer.split('\r\n');
    buffer = lines.pop();
    for (const line of lines) if (line) handleTwitchLine(line);
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (twitch.ws !== ws) return;
    twitch.ws = null;
    if (status.twitch.connected) log('twitch', 'disconnected, reconnecting');
    setStatus('twitch', { connected: false });
    setTimeout(connectTwitch, twitch.backoff);
    twitch.backoff = Math.min(twitch.backoff * 2, 30000);
  };
}

// ---------------------------------------------------------------------------
// YouTube: find the channel's live (or upcoming) video, then follow its chat.

const yt = {
  client: null,
  chat: null,
  timer: null,
  seen: new Set(),
};
const YT_COLORS = ['#FF6B6B', '#4FC3F7', '#81C784', '#FFB74D', '#BA68C8', '#4DB6AC', '#F06292', '#AED581', '#FFD54F', '#7986CB', '#E57373', '#64B5F6'];
const YT_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'SOCS=CAI',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36',
};

async function ytClient() {
  if (!yt.client) yt.client = await Innertube.create({ retrieve_player: false, lang: 'en', location: 'US' });
  return yt.client;
}

async function findYouTubeVideo() {
  const res = await fetch(`https://www.youtube.com/channel/${config.youtube.channelId}/live`, { headers: YT_HEADERS, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || '';
  return canonical.match(/[?&]v=([\w-]{11})/)?.[1] || null;
}

function scheduleYouTubeCheck(ms) {
  clearTimeout(yt.timer);
  yt.timer = setTimeout(checkYouTube, ms);
}

async function checkYouTube() {
  if (yt.chat) return;
  try {
    const videoId = await findYouTubeVideo();
    if (videoId) {
      const info = await (await ytClient()).getInfo(videoId);
      if (info.basic_info.is_live || info.basic_info.is_upcoming) {
        connectYouTubeChat(info);
        return;
      }
    }
    if (status.youtube.state !== 'offline') setStatus('youtube', { state: 'offline', videoId: null, title: null, viewers: null, likes: null, chat: false });
  } catch (e) {
    log('youtube', 'live check failed:', e.message);
    yt.client = null;
  }
  // While OBS is streaming, check often so chat shows up seconds after
  // YouTube goes live. Otherwise a slow check is enough (catches streams
  // started some other way).
  scheduleYouTubeCheck(status.obs.streaming ? 8000 : 60000);
}

function runsToParts(text) {
  const parts = [];
  for (const run of text?.runs || []) {
    if (run.emoji) {
      const img = run.emoji.image?.at(-1)?.url || run.emoji.image?.[0]?.url;
      if (run.emoji.is_custom && img) parts.push({ t: 'emote', url: img, alt: run.emoji.shortcuts?.[0] || run.text });
      else parts.push({ t: 'text', v: run.emoji.emoji_id || run.text });
    } else if (run.text) {
      parts.push({ t: 'text', v: run.text });
    }
  }
  if (!parts.length && text?.text) parts.push({ t: 'text', v: text.text });
  return parts;
}

function ytName(author) {
  return (author?.name || 'someone').replace(/^@/, '');
}

function ytAuthorInfo(author) {
  const badges = [];
  let role = null;
  for (const b of author?.badges || []) {
    const thumb = b.custom_thumbnail?.at(-1)?.url || b.custom_thumbnail?.[0]?.url;
    const label = b.tooltip || b.label || '';
    if (thumb) {
      badges.push({ url: thumb, title: label });
      role ??= 'member';
    } else if (b.icon_type === 'OWNER' || author?.is_creator) {
      badges.push({ icon: 'owner', title: 'Owner' });
      role = 'owner';
    } else if (b.icon_type === 'MODERATOR' || author?.is_moderator) {
      badges.push({ icon: 'mod', title: 'Moderator' });
      if (role !== 'owner') role = 'mod';
    } else if (b.icon_type === 'VERIFIED' || author?.is_verified) {
      badges.push({ icon: 'verified', title: 'Verified' });
    }
  }
  const name = ytName(author);
  const color = { owner: '#FFD600', mod: '#5E84F1', member: '#2BA640' }[role] || hashColor(name, YT_COLORS);
  return { name, badges, color, avatar: author?.thumbnails?.[0]?.url };
}

const argb = (n) => (typeof n === 'number' ? `#${(n & 0xffffff).toString(16).padStart(6, '0')}` : undefined);

function handleYouTubeAction(action) {
  if (action.is(YTNodes.AddChatItemAction)) {
    const item = action.item;
    if (!item?.id || yt.seen.has(item.id)) return;
    yt.seen.add(item.id);
    if (yt.seen.size > 5000) yt.seen = new Set([...yt.seen].slice(-2500));
    const ts = Math.floor(Number(item.timestamp_usec || 0) / 1000) || item.timestamp || Date.now();
    const author = item.author || null;
    const base = () => ({ platform: 'youtube', id: item.id, userId: author?.id, ts, ...ytAuthorInfo(author) });

    if (item.is(YTNodes.LiveChatTextMessage)) {
      pushMessage({ ...base(), parts: runsToParts(item.message), kind: 'chat' });
    } else if (item.is(YTNodes.LiveChatPaidMessage)) {
      const m = { ...base(), parts: runsToParts(item.message), kind: 'superchat', amount: item.purchase_amount, bg: argb(item.body_background_color), headerBg: argb(item.header_background_color) };
      pushMessage(m);
      pushActivity({ ...m, type: 'superchat', text: `Super Chat ${item.purchase_amount}` });
    } else if (item.is(YTNodes.LiveChatPaidSticker)) {
      const sticker = item.sticker?.at(-1)?.url || item.sticker?.[0]?.url;
      const m = { ...base(), parts: sticker ? [{ t: 'emote', url: sticker.startsWith('//') ? `https:${sticker}` : sticker, alt: item.sticker_accessibility_label || 'sticker', big: true }] : [], kind: 'superchat', amount: item.purchase_amount, bg: argb(item.background_color) };
      pushMessage(m);
      pushActivity({ ...m, type: 'sticker', text: `Super Sticker ${item.purchase_amount}` });
    } else if (item.is(YTNodes.LiveChatMembershipItem)) {
      const header = item.header_primary_text?.toString() || item.header_subtext?.toString() || 'New member';
      const m = { ...base(), parts: runsToParts(item.message), kind: 'member', note: header };
      if (m.parts.length) pushMessage(m);
      pushActivity({ ...m, type: 'member', text: header });
    } else if (item.is(YTNodes.LiveChatSponsorshipsGiftPurchaseAnnouncement)) {
      const h = item.header;
      const name = (h?.author_name?.toString() || 'someone').replace(/^@/, '');
      const text = h?.primary_text?.toString() || 'Gifted memberships';
      pushActivity({ platform: 'youtube', id: item.id, ts, name, color: '#2BA640', avatar: h?.author_photo?.[0]?.url, type: 'gift', text, parts: [] });
    } else if (item.is(YTNodes.LiveChatSponsorshipsGiftRedemptionAnnouncement)) {
      pushActivity({ ...base(), type: 'gift-received', text: item.message?.toString() || 'received a gift membership', parts: [] });
    }
  } else if (action.is(YTNodes.RemoveChatItemAction) || action.is(YTNodes.MarkChatItemAsDeletedAction)) {
    deleteMessage('youtube', action.target_item_id);
  } else if (action.is(YTNodes.RemoveChatItemByAuthorAction) || action.is(YTNodes.MarkChatItemsByAuthorAsDeletedAction)) {
    clearUser('youtube', action.external_channel_id);
  }
}

function youtubeInfoPatch(info) {
  const bi = info.basic_info;
  return {
    state: bi.is_live ? 'live' : 'upcoming',
    title: bi.title,
    viewers: info.primary_info?.view_count?.original_view_count ?? null,
    likes: bi.like_count != null ? Number(bi.like_count).toLocaleString('en-US') : null,
  };
}

// Viewer and like counts, and the upcoming-to-live switch, come from the
// watch page, so re-read it every minute while connected.
async function refreshYouTubeInfo(chat, videoId) {
  if (yt.chat !== chat) return;
  try {
    const info = await (await ytClient()).getInfo(videoId);
    if (yt.chat === chat) setStatus('youtube', youtubeInfoPatch(info));
  } catch (e) {
    log('youtube', 'info refresh failed:', e.message);
  }
  setTimeout(() => refreshYouTubeInfo(chat, videoId), 60000);
}

function connectYouTubeChat(info) {
  const bi = info.basic_info;
  const chat = info.getLiveChat();
  yt.chat = chat;
  log('youtube', `${bi.is_live ? 'live' : 'upcoming'}: ${bi.id} "${bi.title}"`);
  setStatus('youtube', { ...youtubeInfoPatch(info), videoId: bi.id, chat: false });
  setTimeout(() => refreshYouTubeInfo(chat, bi.id), 60000);
  chat.on('start', () => {
    // "Top chat" hides some messages; we want everything.
    try {
      chat.applyFilter('LIVE_CHAT');
    } catch {}
    setStatus('youtube', { chat: true });
  });
  chat.on('chat-update', (a) => {
    try {
      handleYouTubeAction(a);
    } catch (e) {
      log('youtube', 'bad chat item:', e.message);
    }
  });
  chat.on('metadata-update', (md) => {
    const views = md.views?.view_count_node?.original_view_count;
    if (views != null) setStatus('youtube', { viewers: views });
  });
  chat.on('error', (e) => log('youtube', 'chat error:', e?.message || e));
  chat.on('end', () => {
    if (yt.chat !== chat) return;
    log('youtube', 'chat ended');
    chat.stop();
    yt.chat = null;
    setStatus('youtube', { state: 'offline', videoId: null, title: null, viewers: null, likes: null, chat: false });
    scheduleYouTubeCheck(5000);
  });
  chat.start();
}

// ---------------------------------------------------------------------------
// OBS: when the main (Twitch) stream starts or stops, do the same to the
// Aitum Multistream outputs (YouTube), so one Start Streaming click does both.

const obs = { ws: null, nextId: 1, pending: new Map(), started: new Set(), watchdogs: new Map() };

function obsConfig() {
  try {
    return JSON.parse(fs.readFileSync(expand(config.obs.websocketConfig), 'utf8'));
  } catch {
    return null;
  }
}

function obsRequest(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    if (!obs.ws || obs.ws.readyState !== WebSocket.OPEN) return reject(new Error('OBS not connected'));
    const requestId = String(obs.nextId++);
    const timer = setTimeout(() => {
      obs.pending.delete(requestId);
      reject(new Error(`${requestType} timed out`));
    }, 10000);
    obs.pending.set(requestId, { resolve, reject, timer });
    obs.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

async function aitum(requestType, requestData = {}) {
  const r = await obsRequest('CallVendorRequest', { vendorName: 'aitum-multistream', requestType, requestData });
  return r?.responseData || {};
}

async function extraOutputs() {
  const { outputs = [] } = await aitum('get_outputs');
  const wanted = config.obs.autostartOutputs;
  return outputs.filter((o) => !o.vertical && (wanted === 'all' || (Array.isArray(wanted) && wanted.includes(o.name))));
}

// Aitum's get_outputs only gives names, so read its saved settings to find
// outputs that are switched off or still have no stream key. Aitum writes
// this file as soon as its settings dialog is closed with OK. The key itself
// is only checked for being there, never logged.
const AITUM_CONFIG = '~/.var/app/com.obsproject.Studio/config/obs-studio/plugin_config/aitum-multistream/config.json';

async function aitumNotReady(outputs) {
  let saved;
  try {
    const { currentProfileName } = await obsRequest('GetProfileList');
    const cfg = JSON.parse(fs.readFileSync(expand(config.obs.aitumConfig || AITUM_CONFIG), 'utf8'));
    const prof = (cfg.profiles || []).find((p) => p.name === currentProfileName);
    saved = new Map((prof?.outputs || []).map((o) => [o.name, o]));
  } catch {
    return new Map(); // can't tell, so try them all
  }
  const notReady = new Map();
  for (const o of outputs) {
    const s = saved.get(o.name);
    if (!s) continue;
    if (s.enabled === false) notReady.set(o.name, 'switched off');
    else if (!s.stream_key && !s.key) notReady.set(o.name, 'no stream key');
  }
  return notReady;
}

async function startExtraOutputs() {
  let outputs;
  try {
    outputs = await extraOutputs();
  } catch (e) {
    log('obs', 'Aitum Multistream not reachable:', e.message);
    notify('YouTube stream did not start', 'Aitum Multistream is not responding in OBS. Start YouTube from the Multistream dock.');
    return;
  }
  if (!outputs.length) {
    notify('Only streaming to Twitch', 'No YouTube output is set up in the Aitum Multistream dock yet.');
    return;
  }
  const notReady = await aitumNotReady(outputs);
  if (notReady.size) {
    const outs = { ...status.obs.outputs };
    for (const [name, why] of notReady) {
      log('obs', `not starting "${name}": ${why}`);
      outs[name] = why;
    }
    setStatus('obs', { outputs: outs });
    const names = [...notReady.keys()].join(' and ');
    const reasons = [...notReady].map(([n, why]) => (why === 'no stream key' ? `${n} has no stream key yet` : `${n} is switched off`)).join('. ');
    notify(
      notReady.size === outputs.length ? 'Streaming to Twitch only' : `Not starting ${names}`,
      `${reasons}. Set it up in the Aitum Multistream dock to go live there too.`,
    );
    outputs = outputs.filter((o) => !notReady.has(o.name));
  }
  for (const o of outputs) {
    try {
      const r = await aitum('start_output', { name: o.name });
      if (r.success === false) throw new Error(r.error || 'failed');
      log('obs', `asked Aitum to start "${o.name}"`);
      setStatus('obs', { outputs: { ...status.obs.outputs, [o.name]: 'starting' } });
      clearTimeout(obs.watchdogs.get(o.name));
      obs.watchdogs.set(
        o.name,
        setTimeout(() => {
          if (!obs.started.has(o.name) && status.obs.streaming) {
            setStatus('obs', { outputs: { ...status.obs.outputs, [o.name]: 'failed' } });
            notify(`${o.name} stream did not start`, 'Check the stream key in the Aitum Multistream dock in OBS.');
          }
        }, 20000),
      );
    } catch (e) {
      log('obs', `start "${o.name}" failed:`, e.message);
      notify(`${o.name} stream did not start`, e.message);
    }
  }
}

async function stopExtraOutputs() {
  let outputs;
  try {
    outputs = await extraOutputs();
  } catch {
    return;
  }
  for (const o of outputs) {
    clearTimeout(obs.watchdogs.get(o.name));
    try {
      await aitum('stop_output', { name: o.name });
      log('obs', `asked Aitum to stop "${o.name}"`);
    } catch (e) {
      log('obs', `stop "${o.name}" failed:`, e.message);
    }
  }
}

function onStreamState(state) {
  if (state === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
    if (status.obs.streaming) return;
    log('obs', 'main stream started');
    setStatus('obs', { streaming: true });
    startExtraOutputs();
    scheduleYouTubeCheck(12000);
  } else if (state === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
    if (!status.obs.streaming) return;
    log('obs', 'main stream stopped');
    setStatus('obs', { streaming: false });
    stopExtraOutputs();
  }
}

let obsRetry = null;
function connectObs() {
  clearTimeout(obsRetry);
  const cfg = obsConfig();
  if (!cfg || !cfg.server_enabled) {
    setStatus('obs', { connected: false, note: 'obs-websocket is turned off (OBS: Tools > WebSocket Server Settings)' });
    obsRetry = setTimeout(connectObs, 15000);
    return;
  }
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${cfg.server_port || 4455}`, 'obswebsocket.json');
  } catch {
    obsRetry = setTimeout(connectObs, 5000);
    return;
  }
  obs.ws = ws;
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    const d = msg.d || {};
    if (msg.op === 0) {
      const identify = { rpcVersion: 1, eventSubscriptions: 64 | 512 }; // Outputs | Vendors
      if (d.authentication) {
        const pw = obsConfig()?.server_password || '';
        const secret = crypto.createHash('sha256').update(pw + d.authentication.salt).digest('base64');
        identify.authentication = crypto.createHash('sha256').update(secret + d.authentication.challenge).digest('base64');
      }
      ws.send(JSON.stringify({ op: 1, d: identify }));
    } else if (msg.op === 2) {
      log('obs', 'connected to obs-websocket');
      setStatus('obs', { connected: true, note: null });
      try {
        const s = await obsRequest('GetStreamStatus');
        const active = !!s?.responseData?.outputActive;
        setStatus('obs', { streaming: active });
        if (active) scheduleYouTubeCheck(1000);
      } catch {}
    } else if (msg.op === 5) {
      if (d.eventType === 'StreamStateChanged') onStreamState(d.eventData?.outputState);
      else if (d.eventType === 'VendorEvent' && d.eventData?.vendorName === 'aitum-multistream') {
        // Aitum's events use the OBS output's internal name
        // ("aitum_multi_output_YouTube"); its requests use the dock name ("YouTube").
        const name = d.eventData?.eventData?.name?.replace(/^aitum_multi_output_/, '');
        const type = d.eventData?.eventType;
        if (!name) return;
        if (type === 'output_started') {
          obs.started.add(name);
          clearTimeout(obs.watchdogs.get(name));
          log('obs', `"${name}" is live`);
        } else if (type === 'output_stopped') {
          obs.started.delete(name);
          log('obs', `"${name}" stopped`);
        }
        setStatus('obs', { outputs: { ...status.obs.outputs, [name]: type === 'output_started' ? 'live' : 'stopped' } });
      }
    } else if (msg.op === 7) {
      const p = obs.pending.get(d.requestId);
      if (!p) return;
      obs.pending.delete(d.requestId);
      clearTimeout(p.timer);
      if (d.requestStatus?.result) p.resolve(d.responseData);
      else p.reject(new Error(d.requestStatus?.comment || `code ${d.requestStatus?.code}`));
    }
  };
  ws.onerror = () => {};
  ws.onclose = (ev) => {
    if (obs.ws !== ws) return;
    obs.ws = null;
    for (const p of obs.pending.values()) p.reject(new Error('OBS disconnected'));
    obs.pending.clear();
    if (status.obs.connected) log('obs', 'disconnected');
    const note = ev.code === 4009 ? 'OBS rejected the websocket password' : null;
    setStatus('obs', { connected: false, streaming: false, note });
    obsRetry = setTimeout(connectObs, 5000);
  };
}

// ---------------------------------------------------------------------------
// HTTP

const PUBLIC = path.join(ROOT, 'public');
const PAGES = {
  '/': 'index.html',
  '/overlay': 'overlay.html',
  '/chat': 'panel.html',
  '/youtube-chat': 'panel.html',
  '/youtube-activity': 'panel.html',
  '/youtube-studio-chat': 'youtube-studio-chat.html',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  if (PAGES[p]) return serveFile(res, path.join(PUBLIC, PAGES[p]));
  if (p === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    send(res, 'hello', { status, history, activity });
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  if (p === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(status, null, 2));
  }
  if (p === '/api/test' && req.method === 'POST') {
    // Sample messages so the overlay and panels can be previewed offline.
    // They aren't kept in history or the saved activity list.
    const now = Date.now();
    const kappa = { t: 'emote', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', alt: 'Kappa' };
    const samples = [
      { platform: 'twitch', id: `test-${now}-1`, userId: 'test-t1', name: 'TwitchViewer', color: '#9146FF', badges: [...twitch.badges.entries()].filter(([k]) => k === 'subscriber/0').map(([, v]) => v), parts: [{ t: 'text', v: 'Hello from Twitch! ' }, kappa], kind: 'chat', ts: now },
      { platform: 'youtube', id: `test-${now}-2`, userId: 'test-y1', name: 'YouTubeViewer', color: '#4FC3F7', badges: [], parts: [{ t: 'text', v: 'Hello from YouTube 👋' }], kind: 'chat', ts: now },
      { platform: 'youtube', id: `test-${now}-3`, userId: 'test-y2', name: 'YouTubeMod', color: '#5E84F1', badges: [{ icon: 'mod', title: 'Moderator' }], parts: [{ t: 'text', v: 'Mods have a wrench badge' }], kind: 'chat', ts: now },
      { platform: 'youtube', id: `test-${now}-4`, userId: 'test-y3', name: 'BigFan', color: '#FFCA28', badges: [], parts: [{ t: 'text', v: 'This is what a Super Chat looks like' }], kind: 'superchat', amount: '$5.00', bg: '#ffca28', headerBg: '#ffb300', ts: now },
      { platform: 'youtube', id: `test-${now}-5`, userId: 'test-y4', name: 'NewMember', color: '#2BA640', badges: [], parts: [{ t: 'text', v: 'Just joined!' }], kind: 'member', note: 'Welcome to Spacelamp6 members!', ts: now },
    ];
    for (const m of samples) broadcast('msg', m);
    broadcast('activity', { ...samples[3], type: 'superchat', text: 'Super Chat $5.00 (test)' });
    broadcast('activity', { ...samples[4], type: 'member', text: 'New member (test)' });
    res.writeHead(204);
    return res.end();
  }
  if (p === '/open/youtube-chat') {
    // YouTube's own popout chat for the current stream, with full mod tools.
    const target = status.youtube.videoId
      ? `https://www.youtube.com/live_chat?is_popout=1&v=${status.youtube.videoId}`
      : `https://studio.youtube.com/channel/${config.youtube.channelId}/livestreaming`;
    res.writeHead(302, { location: target });
    return res.end();
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return res.writeHead(403).end();
  serveFile(res, file);
});

server.listen(config.port, '127.0.0.1', () => {
  log('http', `listening on http://127.0.0.1:${config.port}`);
});

loadTwitchBadges();
setInterval(loadThirdPartyEmotes, 10 * 60 * 1000);
connectTwitch();
checkYouTube();
if (!config.obs.disabled) connectObs();
