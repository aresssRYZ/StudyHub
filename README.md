# StudyHub AI

StudyHub AI adalah bot Discord privat untuk kelas dan komunitas kecil. Versi **0.2.0** mempertahankan Foundation (`/bot status`, SQLite, migration, logging, dan shutdown) serta menambahkan AI text conversation di satu channel belajar. Panggil bot dengan mention, lanjutkan percakapan tanpa mention selama sesi aktif, atau reply pesan bot. Voice, Focus, Music, dan RVC belum tersedia.

## Kebutuhan

- Node.js 24 LTS dan npm.
- Server Discord untuk pengujian serta hak untuk memasang aplikasi ke server itu.
- Koneksi internet untuk memasang package dan menghubungkan bot ke Discord.

Project memakai TypeScript strict dengan ESM/`NodeNext`. Ini cocok dengan sistem module Node.js modern dan import `.js` pada hasil build. SQLite dipakai langsung lewat `better-sqlite3`, tanpa server database. Migration adalah modul TypeScript berurutan; migration pertama membuat tabel `schema_migrations` dan mencatat penerapannya dalam satu transaksi. Migration dijalankan saat startup, sehingga restart aman dan migration yang sudah tercatat dilewati.

## Setup Discord Developer Portal

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), buat **New Application**, lalu beri nama StudyHub AI.
2. Buka halaman **Bot**. Bot user tersedia untuk aplikasi; jika portal meminta membuatnya, pilih **Add Bot**. Aktifkan **Message Content Intent** pada bagian **Privileged Gateway Intents** agar bot dapat membaca pesan lanjutan tanpa mention. **Server Members** dan **Presence Intent** tidak diperlukan.
3. Pada **General Information**, salin **Application ID** ke `DISCORD_CLIENT_ID`.
4. Pada **Bot**, gunakan **Reset Token** bila token belum dapat disalin, lalu salin token baru ke `DISCORD_TOKEN` di `.env`. Simpan token hanya di komputer pribadi; jangan kirim melalui chat atau commit ke Git.
5. Pada **Installation**, aktifkan **Guild Install**. Pilih scope `bot` dan `applications.commands`. Berikan akses **View Channel**, **Send Messages**, dan **Read Message History** pada channel belajar. Jangan pilih Administrator.
6. Salin install link dari portal dan pasang aplikasi ke server testing. Akun yang memasang aplikasi harus punya izin mengelola server.
7. Di aplikasi Discord, aktifkan **Developer Mode** melalui pengaturan Advanced. Klik kanan server testing dan pilih **Copy Server ID** untuk `DISCORD_GUILD_ID`; klik kanan channel belajar dan pilih **Copy Channel ID** untuk `STUDY_CHANNEL_ID`.
8. Jalankan `npm run register` jika `/bot status` belum terdaftar, lalu `npm run dev`. Ketika log **Discord connected** muncul, coba `/bot status` dan mention bot di channel belajar.

Rujukan: [Discord Application Commands](https://docs.discord.com/developers/docs/interactions/slash-commands), [cara menemukan ID](https://support-dev.discord.com/hc/en-us/articles/360028717192-Where-can-I-find-my-Application-Team-Server-ID), dan [cara memperoleh bot token](https://support-dev.discord.com/hc/en-us/articles/6470840524311-Why-can-t-I-copy-my-bot-s-token).

## Instalasi dan menjalankan

Jalankan dari root project:

```powershell
npm install
Copy-Item .env.example .env
```

Isi `.env` dengan token, Application ID, Guild ID, Channel ID belajar, serta API key Groq dan Gemini. Pada instalasi Foundation yang sudah berjalan, **tambahkan variabel baru dari `.env.example` ke `.env` yang ada**; jangan menimpa token lama dengan file contoh. `GROQ_MODEL` dan `GEMINI_MODEL` dapat diganti tanpa mengubah source. Nilai `DATABASE_PATH=./data/studyhub.db`, `AI_SESSION_TIMEOUT_MINUTES=20`, dan `AI_MAX_CONTEXT_MESSAGES=20` dapat dibiarkan. Kedua API key wajib agar konfigurasi valid saat startup. Pada PowerShell dengan execution policy yang menghalangi `npm.ps1`, gunakan `npm.cmd` untuk semua perintah npm.

```powershell
npm run register
npm run dev
```

`register` mengganti daftar guild command milik aplikasi **di guild yang dipilih** dengan command yang ada di project ini. Pada server testing khusus StudyHub, ini membuat `/bot status` cepat muncul. Registrasi tidak otomatis dilakukan setiap startup bot.

Build dan jalankan hasil build:

```powershell
npm run typecheck
npm run build
npm test
npm start
```

Di Linux Mint, jalankan perintah yang sama dari direktori project. Jika nanti memakai systemd, set `WorkingDirectory` ke root project agar `.env`, `package.json`, dan path database relatif ditemukan. Tekan Ctrl+C atau kirim SIGTERM untuk shutdown: client Discord dihentikan lalu koneksi SQLite ditutup.

Jika muncul `NODE_MODULE_VERSION` saat membuka SQLite, versi Node yang menjalankan bot berbeda dari versi yang dipakai saat memasang `better-sqlite3`. Jalankan `node --version` dan `where.exe node` di Windows. Pilih Node.js 24 LTS, buka terminal baru, pastikan `node --version` menunjukkan `v24`, lalu jalankan `npm rebuild better-sqlite3` dan `npm run dev`. Jangan berganti antara Node 22 dan 24 tanpa membangun ulang modul SQLite.

## Struktur singkat

```text
src/index.ts                  entry point
src/app/                     bootstrap, router, registrasi command
src/commands/bot/status.ts   /bot status dan embed
src/events/                  event ready dan interaction
src/conversation/            sesi, penyimpanan, dan alur pesan
src/ai/                      prompt, service, provider Groq/Gemini
src/config/env.ts            pembacaan dan validasi environment
src/database/                koneksi SQLite dan migration
src/shared/                  logger, error, utilitas kecil
scripts/deploy-commands.ts   registrasi guild command
data/                        database runtime (diabaikan Git)
```

`.env`, `node_modules`, hasil build, log, database SQLite, serta file WAL/SHM diabaikan Git. `.env.example`, source, migration, dan `package-lock.json` disimpan di repository.

## Cara kerja AI text

AI hanya memproses pesan di `STUDY_CHANNEL_ID`. Mention membuka sesi untuk kombinasi server, channel, dan user; pesan biasa dari user itu menjadi kelanjutan hingga ditutup dengan mention seperti `@StudyHub sudah selesai` atau tidak aktif selama 20 menit. Reply ke pesan bot dapat membuka sesi baru setelah sesi sebelumnya habis, tanpa membawa konteks lama. User lain tetap memiliki sesi sendiri. Pesan di channel lain diabaikan tanpa request API.

Groq adalah provider utama. Gemini digunakan jika Groq mengalami rate limit, timeout, gangguan jaringan, atau error server. Error kredensial atau request yang tidak valid tidak dialihkan ke Gemini. Bot mengirim maksimal 20 pesan terbaru sebagai konteks dan menyimpan hanya 20 pesan terbaru per sesi di SQLite. Jawaban panjang dipecah agar sesuai batas Discord. Log mencatat metadata request, bukan isi chat atau API key.

API Groq memakai [Chat Completions](https://console.groq.com/docs/api-reference); Gemini memakai [generateContent](https://ai.google.dev/api/generate-content). Model contoh di `.env.example` dapat berubah ketersediaannya menurut akun/provider; periksa model yang tersedia di [Groq](https://console.groq.com/docs/models) dan [Gemini](https://ai.google.dev/gemini-api/docs/models).

Roadmap voice nanti memakai `/ai` untuk kontrol mode Assistant, Casual, dan Curhat. Mode Curhat direncanakan lebih tenang dan empatik, lebih banyak mendengar, tanpa langsung memberi solusi kecuali diminta. Fitur voice belum diimplementasikan.

## Checklist uji AI text

- [ ] Mention bot di channel belajar mendapat balasan; mention di channel lain diabaikan.
- [ ] Pesan lanjutan tanpa mention dibalas saat sesi aktif; pesan user lain yang belum membuka sesi diabaikan.
- [ ] Reply ke pesan bot melanjutkan sesi. Pertanyaan lanjutan seperti `dia lahir di mana?` memakai konteks sebelumnya.
- [ ] Mention `@StudyHub sudah selesai` atau `@StudyHub makasih, cukup` menutup sesi tanpa request AI. Pesan biasa berikutnya diabaikan; mention baru membuka sesi baru.
- [ ] Setelah timeout, pesan biasa diabaikan. Reply ke bot atau mention baru membuka sesi baru tanpa konteks lama.
- [ ] Saat Groq terkena rate limit/timeout/5xx, Gemini menjawab; jika keduanya gagal, user mendapat pesan ramah dan bot tetap berjalan.
- [ ] Pesan cepat dari user yang sama mendapat balasan berurutan; satu pesan Discord tidak dibalas dua kali.
- [ ] Jawaban panjang dikirim dalam beberapa pesan tanpa error limit Discord.
- [ ] Restart bot dan jalankan `/bot status`; database normal dan `002_conversations` tidak dijalankan ulang.

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
