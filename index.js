const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');
const config = require('./config');
const { extra, extraMenu } = require('./features');

const logger = pino({ level: 'silent' });
const P = config.prefix;
const startedAt = Date.now();

/* ---------- Database sederhana (db.json) ---------- */
const DB_FILE = path.join(__dirname, 'db.json');
let db = { groups: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const gset = (jid) => (db.groups[jid] ||= { antilink: false, welcome: false });

/* ---------- Helper ---------- */
const ask = (q) => new Promise((r) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); r(a.trim()); });
});

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

const unwrap = (m) =>
  m?.ephemeralMessage?.message || m?.viewOnceMessage?.message ||
  m?.viewOnceMessageV2?.message || m?.documentWithCaptionMessage?.message || m;

const getText = (m) =>
  m.conversation || m.extendedTextMessage?.text ||
  m.imageMessage?.caption || m.videoMessage?.caption || '';

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m ${s % 60}d`;
};

const metaCache = new Map();
async function getMeta(sock, jid) {
  const c = metaCache.get(jid);
  if (c && Date.now() - c.t < 60000) return c.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { t: Date.now(), meta });
  return meta;
}

/* ---------- Konversi media dengan ffmpeg ---------- */
async function toSticker(buf, isVideo) {
  const id = Date.now() + Math.random().toString(36).slice(2, 6);
  const inp = path.join(os.tmpdir(), `in_${id}`);
  const out = path.join(os.tmpdir(), `out_${id}.webp`);
  fs.writeFileSync(inp, buf);
  const vf = 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0';
  const args = ['-y', '-i', inp, ...(isVideo ? ['-t', '6', '-an'] : []),
    '-vf', vf, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '55', '-loop', '0', out];
  try {
    await run('ffmpeg', args);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(inp, { force: true });
    fs.rmSync(out, { force: true });
  }
}

async function stickerToPng(buf) {
  const id = Date.now();
  const inp = path.join(os.tmpdir(), `st_${id}.webp`);
  const out = path.join(os.tmpdir(), `st_${id}.png`);
  fs.writeFileSync(inp, buf);
  try {
    await run('ffmpeg', ['-y', '-i', inp, out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(inp, { force: true });
    fs.rmSync(out, { force: true });
  }
}

/* ---------- Fitur AI (opsional, Claude API) ---------- */
async function askAI(question) {
  if (!config.anthropicKey) return 'Fitur AI belum aktif. Isi ANTHROPIC_API_KEY dulu.';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.aiModel,
      max_tokens: 800,
      system: 'Kamu asisten WhatsApp yang ramah. Jawab singkat dan jelas dalam bahasa pengguna.',
      messages: [{ role: 'user', content: question }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return `Error AI: ${data?.error?.message || res.status}`;
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/* ---------- Menu ---------- */
const menu = () => `*${config.botName}*
Prefix: ${P}

*Umum*
${P}menu - tampilkan menu
${P}ping - cek respon bot
${P}runtime - lama bot aktif
${P}owner - kontak owner
${P}calc <ekspresi> - kalkulator
${P}ai <pertanyaan> - tanya AI

*Media*
${P}sticker - ubah gambar/video jadi stiker (kirim/reply media)
${P}toimg - ubah stiker jadi gambar (reply stiker)

*Grup*
${P}info - info grup
${P}tagall <pesan> - mention semua (admin)
${P}hidetag <pesan> - mention tersembunyi (admin)
${P}kick @user - keluarkan member (admin)
${P}promote @user - jadikan admin (admin)
${P}demote @user - cabut admin (admin)
${P}open / ${P}close - buka/tutup chat grup (admin)
${P}antilink on|off - hapus pesan berisi link (admin)
${P}welcome on|off - sambutan member baru (admin)

${extraMenu(P)}`;

/* ---------- Penanganan pesan ---------- */
async function handle(sock, msg) {
  const from = msg.key.remoteJid;
  if (!from || from === 'status@broadcast') return;
  const m = unwrap(msg.message);
  if (!m) return;

  const isGroup = from.endsWith('@g.us');
  const sender = jidNormalizedUser(isGroup ? (msg.key.participant || '') : from);
  const body = getText(m).trim();
  const type = Object.keys(m)[0];
  const ctx = m[type]?.contextInfo;
  const reply = (text, extra = {}) => sock.sendMessage(from, { text, ...extra }, { quoted: msg });

  // Info grup & hak akses
  let isAdmin = false, isBotAdmin = false, meta = null;
  if (isGroup) {
    try {
      meta = await getMeta(sock, from);
      const adminIds = new Set();
      meta.participants.filter((p) => p.admin).forEach((p) =>
        [p.id, p.lid, p.phoneNumber].filter(Boolean).forEach((x) => adminIds.add(jidNormalizedUser(x))));
      isAdmin = adminIds.has(sender);
      isBotAdmin = [sock.user.id, sock.user.lid].filter(Boolean)
        .some((x) => adminIds.has(jidNormalizedUser(x)));
    } catch (e) { console.error('meta error:', e.message); }
  }
  const isOwner = sender.startsWith(config.owner);

  // Anti-link
  if (isGroup && gset(from).antilink && !isAdmin && !isOwner &&
      /(https?:\/\/|chat\.whatsapp\.com\/)\S+/i.test(body)) {
    if (isBotAdmin) {
      await sock.sendMessage(from, { delete: msg.key });
      await sock.sendMessage(from, {
        text: `@${sender.split('@')[0]} dilarang kirim link di grup ini.`,
        mentions: [sender],
      });
    }
    return;
  }

  if (!body.startsWith(P)) return;
  const [cmdRaw, ...args] = body.slice(P.length).split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const text = args.join(' ');

  const needGroup = () => { if (!isGroup) { reply('Perintah ini hanya untuk grup.'); return true; } };
  const needAdmin = () => {
    if (!isAdmin && !isOwner) { reply('Khusus admin grup.'); return true; }
  };
  const needBotAdmin = () => {
    if (!isBotAdmin) { reply('Jadikan bot sebagai admin dulu.'); return true; }
  };
  const target = () => ctx?.mentionedJid?.[0] || ctx?.participant;

  switch (cmd) {
    case 'menu':
    case 'help':
      return reply(menu());

    case 'ping': {
      const t = Date.now();
      await reply('Pong!');
      return reply(`Respon: ${Date.now() - t} ms`);
    }

    case 'runtime':
      return reply(`Aktif selama ${fmtTime(Date.now() - startedAt)}`);

    case 'owner':
      return sock.sendMessage(from, {
        contacts: {
          displayName: 'Owner',
          contacts: [{
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Owner\nTEL;type=CELL;waid=${config.owner}:+${config.owner}\nEND:VCARD`,
          }],
        },
      }, { quoted: msg });

    case 'calc': {
      if (!text) return reply(`Contoh: ${P}calc 12*(3+4)`);
      const expr = text.replace(/\^/g, '**').replace(/x/gi, '*');
      if (!/^[0-9+\-*/().%\s*]+$/.test(expr)) return reply('Ekspresi tidak valid.');
      try {
        const result = Function(`"use strict"; return (${expr})`)();
        return reply(`${text} = *${result}*`);
      } catch { return reply('Ekspresi tidak valid.'); }
    }

    case 'ai': {
      if (!text) return reply(`Contoh: ${P}ai jelaskan apa itu inflasi`);
      try { return reply(await askAI(text)); }
      catch (e) { return reply('Gagal menghubungi AI: ' + e.message); }
    }

    case 's':
    case 'sticker':
    case 'stiker': {
      const quoted = ctx?.quotedMessage ? unwrap(ctx.quotedMessage) : null;
      const src = (m.imageMessage || m.videoMessage) ? m : quoted;
      const mediaType = src?.imageMessage ? 'image' : src?.videoMessage ? 'video' : null;
      if (!mediaType) return reply(`Kirim/reply gambar atau video dengan ${P}sticker`);
      try {
        const target = src === m ? msg : {
          key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant },
          message: quoted,
        };
        const buf = await downloadMediaMessage(target, 'buffer', {},
          { logger, reuploadRequest: sock.updateMediaMessage });
        const webp = await toSticker(buf, mediaType === 'video');
        return sock.sendMessage(from, { sticker: webp }, { quoted: msg });
      } catch (e) {
        console.error(e);
        return reply('Gagal membuat stiker. Pastikan ffmpeg terpasang (pkg install ffmpeg).');
      }
    }

    case 'toimg': {
      const quoted = ctx?.quotedMessage ? unwrap(ctx.quotedMessage) : null;
      if (!quoted?.stickerMessage) return reply(`Reply stiker dengan ${P}toimg`);
      try {
        const buf = await downloadMediaMessage({
          key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant },
          message: quoted,
        }, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        const png = await stickerToPng(buf);
        return sock.sendMessage(from, { image: png }, { quoted: msg });
      } catch (e) {
        console.error(e);
        return reply('Gagal. Hanya stiker non-animasi yang didukung.');
      }
    }

    case 'info': {
      if (needGroup()) return;
      const admins = meta.participants.filter((p) => p.admin).length;
      return reply(`*${meta.subject}*\nMember: ${meta.participants.length}\nAdmin: ${admins}\n` +
        `Antilink: ${gset(from).antilink ? 'on' : 'off'}\nWelcome: ${gset(from).welcome ? 'on' : 'off'}`);
    }

    case 'tagall': {
      if (needGroup() || needAdmin()) return;
      const ids = meta.participants.map((p) => p.id);
      const list = ids.map((id) => `@${id.split('@')[0]}`).join('\n');
      return sock.sendMessage(from, { text: `${text || 'Perhatian semua!'}\n\n${list}`, mentions: ids }, { quoted: msg });
    }

    case 'hidetag': {
      if (needGroup() || needAdmin()) return;
      return sock.sendMessage(from, { text: text || '.', mentions: meta.participants.map((p) => p.id) });
    }

    case 'kick':
    case 'promote':
    case 'demote': {
      if (needGroup() || needAdmin() || needBotAdmin()) return;
      const t = target();
      if (!t) return reply(`Tag atau reply orangnya. Contoh: ${P}${cmd} @user`);
      const action = cmd === 'kick' ? 'remove' : cmd;
      await sock.groupParticipantsUpdate(from, [t], action);
      metaCache.delete(from);
      return reply('Berhasil.');
    }

    case 'open':
    case 'close': {
      if (needGroup() || needAdmin() || needBotAdmin()) return;
      await sock.groupSettingUpdate(from, cmd === 'close' ? 'announcement' : 'not_announcement');
      return reply(cmd === 'close' ? 'Grup ditutup (hanya admin yang bisa chat).' : 'Grup dibuka.');
    }

    case 'antilink':
    case 'welcome': {
      if (needGroup() || needAdmin()) return;
      const v = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) return reply(`Contoh: ${P}${cmd} on`);
      gset(from)[cmd] = v === 'on';
      saveDb();
      return reply(`${cmd} ${v === 'on' ? 'diaktifkan' : 'dimatikan'}.`);
    }

    default:
      await extra({
        sock, msg, from, sender, isGroup, isAdmin, isBotAdmin, isOwner, meta,
        cmd, args, text, ctx, db, saveDb, reply, target,
      });
      return;
  }
}

/* ---------- Koneksi ---------- */
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'session'));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false,
  });

  // Login dengan pairing code (tanpa scan QR, cocok untuk Termux)
  if (!sock.authState.creds.registered) {
    const number = (config.phoneNumber || await ask('Nomor WhatsApp bot (contoh 628123456789): ')).replace(/\D/g, '');
    await new Promise((r) => setTimeout(r, 3000));
    const code = await sock.requestPairingCode(number);
    console.log(`\nKode pairing: ${code}`);
    console.log('Buka WhatsApp > Perangkat tertaut > Tautkan dengan nomor telepon, lalu masukkan kode.\n');
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('Bot tersambung.');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('Sesi logout. Hapus folder "session" lalu jalankan ulang.');
        process.exit(1);
      }
      console.log('Koneksi terputus, mencoba lagi...');
      start();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      try { await handle(sock, msg); }
      catch (e) { console.error('Error handler:', e); }
    }
  });

  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    metaCache.delete(id);
    if (action !== 'add' || !gset(id).welcome) return;
    try {
      const meta = await getMeta(sock, id);
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.id;
        await sock.sendMessage(id, {
          text: `Selamat datang @${jid.split('@')[0]} di *${meta.subject}*!\nKetik ${P}menu untuk melihat fitur bot.`,
          mentions: [jid],
        });
      }
    } catch (e) { console.error('welcome error:', e.message); }
  });
}

start();
