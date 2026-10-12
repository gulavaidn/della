const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

/* ---------- Helper ---------- */
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const num = (n) => Number(n).toLocaleString('id-ID');
const tag = (jid) => `@${jid.split('@')[0]}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRUTH = [
  'Apa hal paling memalukan yang pernah kamu alami?',
  'Siapa orang terakhir yang kamu stalking di media sosial?',
  'Apa kebohongan terbesar yang pernah kamu ucapkan?',
  'Apa kebiasaan anehmu yang jarang orang tahu?',
  'Kalau bisa tukar hidup dengan satu orang di grup ini, siapa?',
  'Apa hal yang paling kamu sesali tahun ini?',
  'Pernah suka sama teman sendiri? Siapa?',
  'Apa rahasia kecil yang belum pernah kamu ceritakan ke siapa pun?',
];
const DARE = [
  'Kirim voice note menyanyikan satu lagu sekarang.',
  'Ganti foto profil dengan foto lucu selama 1 jam.',
  'Kirim pesan "aku kangen" ke kontak ke-5 di daftar chatmu.',
  'Tulis status berisi pantun buatanmu sendiri.',
  'Kirim selfie dengan ekspresi paling jelek.',
  'Ceritakan lelucon dan buat satu orang di grup ketawa.',
  'Ucapkan tongue twister "kuku kaki kakakku kuku kaki kakekku" 3 kali tanpa salah.',
];
const QUOTES = [
  'Mulai dari yang kecil, asal konsisten.',
  'Kesalahan adalah bukti bahwa kamu sedang mencoba.',
  'Tidak ada jalan pintas untuk tempat yang layak dituju.',
  'Hari ini sulit, besok lebih baik. Terus jalan.',
  'Disiplin adalah jembatan antara tujuan dan hasil.',
  'Jangan bandingkan bab 1 hidupmu dengan bab 20 orang lain.',
  'Istirahat itu bagian dari proses, bukan kemalasan.',
];
const BALL = [
  'Ya, pasti.', 'Kemungkinan besar ya.', 'Sepertinya begitu.', 'Belum jelas, coba tanya lagi.',
  'Jangan terlalu berharap.', 'Jawabannya tidak.', 'Meragukan.', 'Tanyakan lagi nanti.',
];

/* ---------- Downloader (yt-dlp) ---------- */
function ytdlp(args) {
  return new Promise((res, rej) =>
    execFile('yt-dlp', args, { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }, (e, so, se) =>
      e ? rej(new Error((se || e.message).trim().split('\n').slice(-2).join(' '))) : res(so)));
}

async function download(input, audio) {
  const dir = path.join(os.tmpdir(), 'dl_' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const src = /^https?:\/\//i.test(input) ? input : `ytsearch1:${input}`;
    const base = ['--no-playlist', '--no-warnings', '--max-filesize', '50M',
      '-o', path.join(dir, '%(title).60s.%(ext)s')];
    const args = audio
      ? [...base, '-x', '--audio-format', 'mp3', '--', src]
      : [...base, '-f', 'bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'mp4', '--', src];
    await ytdlp(args);
    const f = fs.readdirSync(dir)[0];
    if (!f) throw new Error('File tidak ditemukan atau terlalu besar (maks 50MB).');
    return { buffer: fs.readFileSync(path.join(dir, f)), name: f };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------- Menu tambahan ---------- */
const extraMenu = (P) => `*Downloader* (butuh yt-dlp)
${P}mp3 <link/judul> - unduh audio
${P}mp4 <link> - unduh video (YouTube, TikTok, IG, dll.)

*Game*
${P}dadu, ${P}koin, ${P}8ball <tanya>, ${P}pilih a|b|c
${P}suit batu|gunting|kertas
${P}tebakangka lalu ${P}tebak <angka>
${P}truth, ${P}dare, ${P}quote
${P}rate <sesuatu>, ${P}cocok @user

*Ekonomi*
${P}daily - bonus harian
${P}saldo - cek saldo
${P}top - peringkat terkaya
${P}transfer @user <jumlah>
${P}taruhan <jumlah>, ${P}slot <jumlah>

*Tools*
${P}cuaca <kota>
${P}qr <teks>
${P}tr <kode bahasa> <teks> - terjemahan (contoh: ${P}tr en selamat pagi)
${P}pass <panjang> - buat password acak
${P}waktu - jam WIB/WITA/WIT
${P}base64 enc|dec <teks>
${P}getpp @user - foto profil

*Grup (tambahan)*
${P}linkgroup, ${P}resetlink (admin)
${P}setname <nama>, ${P}setdesc <teks> (admin)
${P}listadmin
${P}warn @user, ${P}resetwarn @user (admin, 3x warn = kick)
${P}del - hapus pesan yang di-reply (admin)

*Owner*
${P}bc <teks> - broadcast ke semua grup`;

/* ---------- State game ---------- */
const guessGames = new Map();

/* ---------- Handler perintah tambahan ---------- */
async function extra(c) {
  const { sock, msg, from, sender, isGroup, isAdmin, isBotAdmin, isOwner, meta,
    cmd, args, text, ctx, db, saveDb, reply, target } = c;

  const U = (jid) => {
    db.users ||= {};
    return (db.users[jid] ||= { money: 100, lastDaily: 0 });
  };
  const G = (jid) => (db.groups[jid] ||= { antilink: false, welcome: false });
  const grpOnly = () => { if (!isGroup) { reply('Perintah ini hanya untuk grup.'); return true; } return false; };
  const adminOnly = () => { if (!isAdmin && !isOwner) { reply('Khusus admin grup.'); return true; } return false; };
  const botAdminOnly = () => { if (!isBotAdmin) { reply('Jadikan bot sebagai admin dulu.'); return true; } return false; };
  const parseBet = (s) => {
    const me = U(sender);
    const n = s === 'all' ? me.money : parseInt(s, 10);
    if (!Number.isInteger(n) || n < 10) { reply('Taruhan minimal 10. Contoh: 100 atau "all".'); return null; }
    if (n > me.money) { reply(`Saldo kamu tidak cukup (${num(me.money)}).`); return null; }
    return n;
  };

  switch (cmd) {
    /* ===== Game ===== */
    case 'dadu':
      await reply(`🎲 Kamu dapat *${rnd(1, 6)}*`); return true;

    case 'koin':
      await reply(`🪙 Hasilnya: *${pick(['Angka', 'Gambar'])}*`); return true;

    case '8ball':
      if (!text) { await reply('Tanyakan sesuatu. Contoh: .8ball apakah besok hujan?'); return true; }
      await reply(`🎱 ${pick(BALL)}`); return true;

    case 'pilih': {
      const opts = text.split('|').map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) { await reply('Contoh: .pilih nasi goreng | mie ayam | bakso'); return true; }
      await reply(`Aku pilih: *${pick(opts)}*`); return true;
    }

    case 'rate':
      if (!text) { await reply('Contoh: .rate ketampananku'); return true; }
      await reply(`Tingkat *${text}*: *${rnd(0, 100)}%*`); return true;

    case 'cocok': {
      const t = target();
      if (!t) { await reply('Tag orangnya. Contoh: .cocok @user'); return true; }
      const h = crypto.createHash('md5').update([sender, t].sort().join('|')).digest();
      await sock.sendMessage(from, {
        text: `💘 Kecocokan ${tag(sender)} dan ${tag(t)}: *${h[0] % 101}%*`,
        mentions: [sender, t],
      }, { quoted: msg });
      return true;
    }

    case 'truth': await reply(`*Truth:* ${pick(TRUTH)}`); return true;
    case 'dare': await reply(`*Dare:* ${pick(DARE)}`); return true;
    case 'quote': await reply(`"${pick(QUOTES)}"`); return true;

    case 'suit': {
      const opts = ['batu', 'gunting', 'kertas'];
      const me = (args[0] || '').toLowerCase();
      if (!opts.includes(me)) { await reply('Contoh: .suit batu'); return true; }
      const bot = pick(opts);
      const win = { batu: 'gunting', gunting: 'kertas', kertas: 'batu' };
      let res = 'Seri!';
      if (win[me] === bot) { res = 'Kamu menang! (+50 koin)'; U(sender).money += 50; saveDb(); }
      else if (win[bot] === me) res = 'Kamu kalah.';
      await reply(`Kamu: ${me}\nBot: ${bot}\n\n${res}`); return true;
    }

    case 'tebakangka':
      guessGames.set(from, { num: rnd(1, 100), tries: 0 });
      await reply('Aku memikirkan angka 1-100. Tebak dengan .tebak <angka> (maks 7 kali).'); return true;

    case 'tebak': {
      const game = guessGames.get(from);
      if (!game) { await reply('Mulai dulu dengan .tebakangka'); return true; }
      const n = parseInt(args[0], 10);
      if (!Number.isInteger(n)) { await reply('Contoh: .tebak 42'); return true; }
      game.tries++;
      if (n === game.num) {
        guessGames.delete(from);
        U(sender).money += 200; saveDb();
        await sock.sendMessage(from, {
          text: `🎉 ${tag(sender)} benar! Angkanya *${n}* (${game.tries} tebakan). +200 koin`,
          mentions: [sender],
        }, { quoted: msg });
      } else if (game.tries >= 7) {
        guessGames.delete(from);
        await reply(`Kesempatan habis. Angkanya *${game.num}*.`);
      } else {
        await reply(`${n < game.num ? 'Terlalu kecil' : 'Terlalu besar'}. Sisa ${7 - game.tries} kesempatan.`);
      }
      return true;
    }

    /* ===== Ekonomi ===== */
    case 'daily': {
      const me = U(sender);
      const left = me.lastDaily + 86400000 - Date.now();
      if (left > 0) {
        await reply(`Bonus harian sudah diambil. Coba lagi dalam ${Math.ceil(left / 3600000)} jam.`); return true;
      }
      me.money += 500; me.lastDaily = Date.now(); saveDb();
      await reply(`Kamu mendapat *500 koin*. Saldo: ${num(me.money)}`); return true;
    }

    case 'saldo':
      await reply(`Saldo kamu: *${num(U(sender).money)} koin*`); return true;

    case 'top': {
      const rows = Object.entries(db.users || {}).sort((a, b) => b[1].money - a[1].money).slice(0, 10);
      if (!rows.length) { await reply('Belum ada data.'); return true; }
      const list = rows.map(([id, u], i) => `${i + 1}. ${tag(id)} - ${num(u.money)}`).join('\n');
      await sock.sendMessage(from, { text: `*Top 10 Terkaya*\n\n${list}`, mentions: rows.map((r) => r[0]) }, { quoted: msg });
      return true;
    }

    case 'transfer': {
      const t = target();
      const amount = parseInt(args[args.length - 1], 10);
      if (!t || !Number.isInteger(amount) || amount < 1) { await reply('Contoh: .transfer @user 100'); return true; }
      if (t === sender) { await reply('Tidak bisa transfer ke diri sendiri.'); return true; }
      if (U(sender).money < amount) { await reply('Saldo tidak cukup.'); return true; }
      U(sender).money -= amount; U(t).money += amount; saveDb();
      await sock.sendMessage(from, {
        text: `${tag(sender)} mengirim *${num(amount)} koin* ke ${tag(t)}.`, mentions: [sender, t],
      }, { quoted: msg });
      return true;
    }

    case 'taruhan': {
      const bet = parseBet(args[0]);
      if (bet === null) return true;
      const me = U(sender);
      if (Math.random() < 0.45) { me.money += bet; await reply(`Menang! +${num(bet)} koin. Saldo: ${num(me.money)}`); }
      else { me.money -= bet; await reply(`Kalah. -${num(bet)} koin. Saldo: ${num(me.money)}`); }
      saveDb(); return true;
    }

    case 'slot': {
      const bet = parseBet(args[0]);
      if (bet === null) return true;
      const me = U(sender);
      const sym = ['🍒', '🍋', '🍇', '🔔', '7️⃣'];
      const r = [pick(sym), pick(sym), pick(sym)];
      const uniq = new Set(r).size;
      let note;
      if (uniq === 1) { me.money += bet * 4; note = `JACKPOT! +${num(bet * 4)} koin`; }
      else if (uniq === 2) { note = 'Dua sama, taruhan kembali.'; }
      else { me.money -= bet; note = `Kalah. -${num(bet)} koin`; }
      saveDb();
      await reply(`[ ${r.join(' | ')} ]\n\n${note}\nSaldo: ${num(me.money)}`); return true;
    }

    /* ===== Tools ===== */
    case 'cuaca': {
      if (!text) { await reply('Contoh: .cuaca Makassar'); return true; }
      try {
        const url = `https://wttr.in/${encodeURIComponent(text)}?format=%l:+%c+%t+(terasa+%f),+kelembapan+%h,+angin+%w&lang=id`;
        const r = await fetch(url);
        await reply(r.ok ? (await r.text()).trim() : 'Kota tidak ditemukan.');
      } catch { await reply('Gagal mengambil data cuaca.'); }
      return true;
    }

    case 'qr':
      if (!text) { await reply('Contoh: .qr https://contoh.com'); return true; }
      await sock.sendMessage(from, {
        image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}` },
        caption: 'QR Code',
      }, { quoted: msg });
      return true;

    case 'tr': {
      const lang = args[0];
      const q = args.slice(1).join(' ');
      if (!lang || !q) { await reply('Contoh: .tr en selamat pagi'); return true; }
      try {
        const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q.slice(0, 450))}&langpair=autodetect|${encodeURIComponent(lang)}`);
        const d = await r.json();
        await reply(d?.responseData?.translatedText || 'Gagal menerjemahkan.');
      } catch { await reply('Gagal menerjemahkan.'); }
      return true;
    }

    case 'pass': {
      const len = Math.min(64, Math.max(6, parseInt(args[0], 10) || 12));
      const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
      let out = '';
      for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
      await reply(`Password acak:\n\`${out}\``); return true;
    }

    case 'waktu': {
      const f = (tz) => new Date().toLocaleString('id-ID', { timeZone: tz, dateStyle: 'full', timeStyle: 'medium' });
      await reply(`WIB: ${f('Asia/Jakarta')}\nWITA: ${f('Asia/Makassar')}\nWIT: ${f('Asia/Jayapura')}`); return true;
    }

    case 'base64': {
      const mode = (args[0] || '').toLowerCase();
      const q = args.slice(1).join(' ');
      if (!['enc', 'dec'].includes(mode) || !q) { await reply('Contoh: .base64 enc halo'); return true; }
      try {
        await reply(mode === 'enc' ? Buffer.from(q).toString('base64') : Buffer.from(q, 'base64').toString('utf8'));
      } catch { await reply('Input tidak valid.'); }
      return true;
    }

    case 'getpp': {
      const t = target() || sender;
      try {
        const url = await sock.profilePictureUrl(t, 'image');
        await sock.sendMessage(from, { image: { url }, caption: `Foto profil ${tag(t)}`, mentions: [t] }, { quoted: msg });
      } catch { await reply('Foto profil tidak tersedia atau disembunyikan.'); }
      return true;
    }

    /* ===== Downloader ===== */
    case 'mp3':
    case 'ytmp3':
    case 'play':
    case 'mp4':
    case 'ytmp4':
    case 'tiktok':
    case 'ig': {
      if (!text) { await reply(`Contoh: .${cmd} https://link-video-atau-judul-lagu`); return true; }
      const audio = ['mp3', 'ytmp3', 'play'].includes(cmd);
      if (!audio && !/^https?:\/\//i.test(text)) { await reply('Untuk video, kirim link yang valid.'); return true; }
      await reply('⏳ Sedang mengunduh, mohon tunggu...');
      try {
        const { buffer, name } = await download(text, audio);
        if (audio) {
          await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mpeg', fileName: name }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { video: buffer, mimetype: 'video/mp4', caption: name }, { quoted: msg });
        }
      } catch (e) {
        console.error(e);
        await reply('Gagal mengunduh: ' + e.message + '\n(Pastikan yt-dlp dan ffmpeg terpasang. Maks 50MB.)');
      }
      return true;
    }

    /* ===== Grup tambahan ===== */
    case 'linkgroup':
      if (grpOnly() || adminOnly() || botAdminOnly()) return true;
      await reply('https://chat.whatsapp.com/' + await sock.groupInviteCode(from)); return true;

    case 'resetlink':
      if (grpOnly() || adminOnly() || botAdminOnly()) return true;
      await sock.groupRevokeInvite(from); await reply('Link grup berhasil direset.'); return true;

    case 'setname':
      if (grpOnly() || adminOnly() || botAdminOnly()) return true;
      if (!text) { await reply('Contoh: .setname Nama Baru'); return true; }
      await sock.groupUpdateSubject(from, text); await reply('Nama grup diubah.'); return true;

    case 'setdesc':
      if (grpOnly() || adminOnly() || botAdminOnly()) return true;
      if (!text) { await reply('Contoh: .setdesc Deskripsi baru'); return true; }
      await sock.groupUpdateDescription(from, text); await reply('Deskripsi grup diubah.'); return true;

    case 'listadmin': {
      if (grpOnly()) return true;
      const ids = meta.participants.filter((p) => p.admin).map((p) => p.id);
      await sock.sendMessage(from, {
        text: `*Admin ${meta.subject}*\n\n` + ids.map((id, i) => `${i + 1}. ${tag(id)}`).join('\n'),
        mentions: ids,
      }, { quoted: msg });
      return true;
    }

    case 'warn': {
      if (grpOnly() || adminOnly()) return true;
      const t = target();
      if (!t) { await reply('Tag atau reply orangnya. Contoh: .warn @user'); return true; }
      const g = G(from); g.warns ||= {};
      g.warns[t] = (g.warns[t] || 0) + 1;
      const n = g.warns[t];
      if (n >= 3 && isBotAdmin) {
        delete g.warns[t]; saveDb();
        await sock.groupParticipantsUpdate(from, [t], 'remove');
        await sock.sendMessage(from, { text: `${tag(t)} dikeluarkan (3x peringatan).`, mentions: [t] });
      } else {
        saveDb();
        await sock.sendMessage(from, { text: `${tag(t)} mendapat peringatan ${n}/3.`, mentions: [t] }, { quoted: msg });
      }
      return true;
    }

    case 'resetwarn': {
      if (grpOnly() || adminOnly()) return true;
      const t = target();
      if (!t) { await reply('Tag atau reply orangnya.'); return true; }
      const g = G(from); g.warns ||= {}; delete g.warns[t]; saveDb();
      await reply('Peringatan direset.'); return true;
    }

    case 'del':
    case 'delete': {
      if (grpOnly() || adminOnly() || botAdminOnly()) return true;
      if (!ctx?.stanzaId) { await reply('Reply pesan yang mau dihapus.'); return true; }
      const botNum = (sock.user.id || '').split(':')[0].split('@')[0];
      const fromMe = (ctx.participant || '').split(':')[0].split('@')[0] === botNum;
      await sock.sendMessage(from, { delete: { remoteJid: from, fromMe, id: ctx.stanzaId, participant: ctx.participant } });
      return true;
    }

    /* ===== Owner ===== */
    case 'bc': {
      if (!isOwner) { await reply('Khusus owner.'); return true; }
      if (!text) { await reply('Contoh: .bc Halo semuanya'); return true; }
      const groups = Object.keys(await sock.groupFetchAllParticipating());
      let ok = 0;
      for (const id of groups) {
        try { await sock.sendMessage(id, { text: `*Broadcast*\n\n${text}` }); ok++; } catch {}
        await sleep(1500);
      }
      await reply(`Terkirim ke ${ok}/${groups.length} grup.`); return true;
    }

    default:
      return false;
  }
}

module.exports = { extra, extraMenu };
