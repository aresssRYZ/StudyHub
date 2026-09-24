# StudyHub AI

StudyHub AI adalah bot Discord privat untuk kelas dan komunitas kecil. Versi **0.1.0 Foundation** saat ini menyediakan koneksi Discord, command `/bot status`, validasi konfigurasi, SQLite, migration, logging, dan shutdown bersih. AI, Focus, Music, Voice, dan RVC adalah rencana tahap berikutnya dan belum tersedia.

## Kebutuhan

- Node.js 24 LTS dan npm.
- Server Discord untuk pengujian serta hak untuk memasang aplikasi ke server itu.
- Koneksi internet untuk memasang package dan menghubungkan bot ke Discord.

Project memakai TypeScript strict dengan ESM/`NodeNext`. Ini cocok dengan sistem module Node.js modern dan import `.js` pada hasil build. SQLite dipakai langsung lewat `better-sqlite3`, tanpa server database. Migration adalah modul TypeScript berurutan; migration pertama membuat tabel `schema_migrations` dan mencatat penerapannya dalam satu transaksi. Migration dijalankan saat startup, sehingga restart aman dan migration yang sudah tercatat dilewati.

## Setup Discord Developer Portal

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), buat **New Application**, lalu beri nama StudyHub AI.
2. Buka halaman **Bot**. Bot user tersedia untuk aplikasi; jika portal meminta membuatnya, pilih **Add Bot**. Jangan aktifkan *Message Content*, *Server Members*, atau *Presence Intent*.
3. Pada **General Information**, salin **Application ID** ke `DISCORD_CLIENT_ID`.
4. Pada **Bot**, gunakan **Reset Token** bila token belum dapat disalin, lalu salin token baru ke `DISCORD_TOKEN` di `.env`. Simpan token hanya di komputer pribadi; jangan kirim melalui chat atau commit ke Git.
5. Pada **Installation**, aktifkan **Guild Install**. Pilih scope `bot` dan `applications.commands`. Set **Bot Permissions** ke **0 / tanpa permission tambahan** untuk Foundation; bot hanya menerima dan membalas slash command. Jangan pilih Administrator.
6. Salin install link dari portal dan pasang aplikasi ke server testing. Akun yang memasang aplikasi harus punya izin mengelola server.
7. Di aplikasi Discord, aktifkan **Developer Mode** melalui pengaturan Advanced, klik kanan ikon server testing, lalu pilih **Copy Server ID**. Masukkan ID ke `DISCORD_GUILD_ID`.
8. Jalankan `npm run register`, lalu `npm run dev`. Ketika log **Discord connected** muncul, coba `/bot status` di server testing.

Rujukan: [Discord Application Commands](https://docs.discord.com/developers/docs/interactions/slash-commands), [cara menemukan ID](https://support-dev.discord.com/hc/en-us/articles/360028717192-Where-can-I-find-my-Application-Team-Server-ID), dan [cara memperoleh bot token](https://support-dev.discord.com/hc/en-us/articles/6470840524311-Why-can-t-I-copy-my-bot-s-token).

## Instalasi dan menjalankan

Jalankan dari root project:

```powershell
npm install
Copy-Item .env.example .env
```

Isi `.env` dengan token, Application ID, dan Guild ID asli. Nilai `DATABASE_PATH=./data/studyhub.db` dapat dibiarkan. `NODE_ENV` dapat bernilai `development`, `production`, atau `test`. Pada PowerShell dengan execution policy yang menghalangi `npm.ps1`, gunakan `npm.cmd` untuk semua perintah npm.

```powershell
npm run register
npm run dev
```

`register` mengganti daftar guild command milik aplikasi **di guild yang dipilih** dengan command yang ada di project ini. Pada server testing khusus StudyHub, ini membuat `/bot status` cepat muncul. Registrasi tidak otomatis dilakukan setiap startup bot.

Build dan jalankan hasil build:

```powershell
npm run typecheck
npm run build
npm start
```

Di Linux Mint, jalankan perintah yang sama dari direktori project. Jika nanti memakai systemd, set `WorkingDirectory` ke root project agar `.env`, `package.json`, dan path database relatif ditemukan. Tekan Ctrl+C atau kirim SIGTERM untuk shutdown: client Discord dihentikan lalu koneksi SQLite ditutup.

## Struktur singkat

```text
src/index.ts                  entry point
src/app/                     bootstrap, router, registrasi command
src/commands/bot/status.ts   /bot status dan embed
src/events/                  event ready dan interaction
src/config/env.ts            pembacaan dan validasi environment
src/database/                koneksi SQLite dan migration
src/shared/                  logger, error, utilitas kecil
scripts/deploy-commands.ts   registrasi guild command
data/                        database runtime (diabaikan Git)
```

`.env`, `node_modules`, hasil build, log, database SQLite, serta file WAL/SHM diabaikan Git. `.env.example`, source, migration, dan `package-lock.json` disimpan di repository.

## Checklist uji manual

- [ ] **Startup normal:** jalankan `npm run dev`; periksa log environment, database, dan Discord connected.
- [ ] **Token salah:** ubah token sementara; startup gagal dengan pesan Discord login. Pulihkan token asli.
- [ ] **Env hilang:** hapus satu variabel wajib sementara; startup berhenti sebelum database/login, dengan nama variabel yang bermasalah.
- [ ] **Database belum ada:** hapus hanya database pengujian yang tidak berisi data penting, lalu jalankan bot; file dibuat otomatis.
- [ ] **Restart:** hentikan dan jalankan bot lagi; database tetap dapat dibuka.
- [ ] **Migration dua kali:** setelah startup pertama, restart; log `Migration executed` tidak muncul lagi untuk `001_initial`.
- [ ] **`/bot status`:** embed berisi Online, Connected, ping, uptime, versi, dan environment yang sesuai.
- [ ] **Interaction error:** saat database sengaja dibuat tidak tersedia dalam sesi pengujian, command memberikan pesan ramah dan detail hanya masuk log; pulihkan lalu restart.
- [ ] **Ctrl+C:** periksa log `Shutting down StudyHub` dan `Database closed`.
- [ ] **Restart berulang:** ulangi beberapa kali; tidak ada migration ganda atau database rusak.

## Memantau penggunaan resource

Setelah bot tersambung, catat waktu dari log `StudyHub starting` hingga `Discord connected` untuk perkiraan waktu startup. Diamkan beberapa menit dan lihat penggunaan idle. Di Windows, buka Task Manager atau jalankan `Get-Process node | Select-Object Id,CPU,WorkingSet64` di PowerShell; `CPU` adalah total detik CPU, `WorkingSet64` adalah RAM dalam byte. Di Linux, jalankan `ps -o pid,%cpu,rss,etime -C node`; `rss` adalah RAM dalam KiB. Amati nilai saat idle dan saat `/bot status` dijalankan.

## Saran commit bertahap

Jika ingin membuat riwayat commit terpisah, urutannya dapat berupa `chore: initialize project`, `chore: add environment configuration`, `feat: add discord client foundation`, `feat: add sqlite database and migrations`, `feat: add bot status command`, `chore: add graceful shutdown`, dan `docs: add foundation setup guide`.
