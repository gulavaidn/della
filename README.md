# Bot WhatsApp (Baileys)

## Instalasi di Termux

```
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git ffmpeg python
pip install yt-dlp        # untuk fitur downloader (.mp3 / .mp4)
cd wa-bot
npm install
```

## Konfigurasi

Edit `config.js`:
- `owner`: nomor kamu (format 628xxx, tanpa +)
- `phoneNumber`: nomor yang dipakai sebagai bot (boleh kosong, nanti ditanya)
- `prefix`, `botName`: sesuai selera

Untuk fitur `.ai` (opsional):
```
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

## Menjalankan

```
node index.js
```

Saat pertama kali, masukkan nomor bot, lalu akan muncul **kode pairing**.
Di WhatsApp: *Perangkat tertaut > Tautkan dengan nomor telepon* > masukkan kode.
Sesi tersimpan di folder `session/`, jadi login hanya sekali.

Agar tetap jalan di latar belakang:
```
pkg install tmux
tmux new -s bot
node index.js
```
(lepas dengan Ctrl+B lalu D, kembali dengan `tmux attach -t bot`)

## Fitur

Ketik `.menu` untuk daftar lengkap.

- Umum: menu, ping, runtime, owner, calc, ai
- Media: sticker (gambar/video), toimg
- Downloader: mp3, mp4 (YouTube, TikTok, IG, dll. via yt-dlp, maks 50MB)
- Game: dadu, koin, 8ball, pilih, suit, tebakangka, truth, dare, quote, rate, cocok
- Ekonomi (koin virtual): daily, saldo, top, transfer, taruhan, slot
- Tools: cuaca, qr, tr (terjemah), pass, waktu, base64, getpp
- Grup: info, tagall, hidetag, kick, promote, demote, open, close, antilink, welcome,
  linkgroup, resetlink, setname, setdesc, listadmin, warn, resetwarn, del
- Owner: bc (broadcast ke semua grup)

## Catatan

- Baileys adalah library tidak resmi. Ada risiko nomor dibatasi/diblokir WhatsApp, jadi pakai nomor cadangan, bukan nomor utama.
- Bot harus jadi admin grup agar kick/promote/demote/open/close/antilink berfungsi.
- Stiker animasi dibatasi 6 detik. Jika hasil terlalu besar, WhatsApp bisa menolaknya.
- Jangan bagikan folder `session/` ke siapa pun (itu sama dengan akses ke akun WhatsApp).
