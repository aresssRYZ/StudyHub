# StudyHub AI

StudyHub AI adalah bot Discord privat untuk kelas dan komunitas kecil. Versi **0.5.0** menyediakan Foundation, AI text conversation, Focus Room, Core Music Player berbasis Sonata, dan playlist pribadi yang tersimpan di SQLite. Panggil bot dengan mention, lalu gunakan fitur Reply pada jawaban bot untuk pertanyaan lanjutan. Voice AI belum tersedia.

## Kebutuhan

- Node.js 24 LTS dan npm.
- Server Discord untuk pengujian serta hak untuk memasang aplikasi ke server itu.
- Koneksi internet untuk memasang package dan menghubungkan bot ke Discord.

Project memakai TypeScript strict dengan ESM/`NodeNext`. Ini cocok dengan sistem module Node.js modern dan import `.js` pada hasil build. SQLite dipakai langsung lewat `better-sqlite3`, tanpa server database. Migration adalah modul TypeScript berurutan; migration pertama membuat tabel `schema_migrations` dan mencatat penerapannya dalam satu transaksi. Migration dijalankan saat startup, sehingga restart aman dan migration yang sudah tercatat dilewati.

## Setup Discord Developer Portal

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), buat **New Application**, lalu beri nama StudyHub AI.
2. Buka halaman **Bot**. Bot user tersedia untuk aplikasi; jika portal meminta membuatnya, pilih **Add Bot**. Aktifkan **Message Content Intent** pada bagian **Privileged Gateway Intents** agar bot dapat membaca isi pesan. **Server Members** dan **Presence Intent** tidak diperlukan.
3. Pada **General Information**, salin **Application ID** ke `DISCORD_CLIENT_ID`.
4. Pada **Bot**, gunakan **Reset Token** bila token belum dapat disalin, lalu salin token baru ke `DISCORD_TOKEN` di `.env`. Simpan token hanya di komputer pribadi; jangan kirim melalui chat atau commit ke Git.
5. Pada **Installation**, aktifkan **Guild Install**. Pilih scope `bot` dan `applications.commands`. Berikan akses **View Channel**, **Send Messages**, dan **Read Message History** pada channel belajar, serta **View Channel**, **Connect**, dan **Speak** pada voice channel musik. Jangan pilih Administrator.
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

Isi `.env` dengan token, Application ID, Guild ID, Channel ID belajar, serta API key Groq dan Gemini. Pada instalasi yang sudah berjalan, **tambahkan variabel baru dari `.env.example` ke `.env` yang ada**; jangan menimpa token lama dengan file contoh. `GROQ_MODEL` dan `GEMINI_MODEL` dapat diganti tanpa mengubah source. Nilai `DATABASE_PATH=./data/studyhub.db`, `AI_SESSION_TIMEOUT_MINUTES=20`, `AI_MAX_CONTEXT_MESSAGES=20`, `FOCUS_MIN_DURATION_MINUTES=5`, `FOCUS_MAX_DURATION_MINUTES=180`, dan `APP_TIMEZONE=Asia/Jakarta` dapat dibiarkan. Tiga variabel Focus mempunyai default sehingga `.env` lama tetap valid. Kedua API key wajib agar konfigurasi valid saat startup. Pada PowerShell dengan execution policy yang menghalangi `npm.ps1`, gunakan `npm.cmd` untuk semua perintah npm.

```powershell
npm run register
npm run dev
```

`register` mengganti daftar guild command milik aplikasi **di guild yang dipilih** dengan `/bot status`, `/focus`, `/playlist`, dan tujuh command musik. Jalankan lagi setelah memperbarui command. Registrasi tidak otomatis dilakukan setiap startup bot.

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
src/playlist/                repository dan service playlist pribadi
src/ai/                      prompt, service, provider Groq/Gemini
src/config/env.ts            pembacaan dan validasi environment
src/database/                koneksi SQLite dan migration
src/shared/                  logger, error, utilitas kecil
scripts/deploy-commands.ts   registrasi guild command
data/                        database runtime (diabaikan Git)
```

`.env`, `node_modules`, hasil build, log, database SQLite, serta file WAL/SHM diabaikan Git. `.env.example`, source, migration, dan `package-lock.json` disimpan di repository.

## Cara kerja AI text

AI hanya memproses pesan di `STUDY_CHANNEL_ID`. Mention memulai topik baru untuk pengguna itu. Pertanyaan lanjutan harus memakai fitur Reply pada jawaban bot dari sesi yang sama; pesan biasa tanpa mention atau Reply diabaikan. Bot hanya menerima Reply dari penanya asal, sehingga pengguna lain tidak dapat mengambil konteksnya. Mention seperti `@StudyHub sudah selesai` menutup sesi. Setelah 20 menit tidak aktif, Reply pada jawaban lama membuka sesi baru tanpa membawa konteks sebelumnya. Jawaban bot ditautkan ke sesi dalam SQLite, termasuk jika jawaban dipecah menjadi beberapa pesan. Pesan di channel lain diabaikan tanpa request API.

Groq adalah provider utama. Gemini digunakan jika Groq mengalami rate limit, timeout, gangguan jaringan, atau error server. Error kredensial atau request yang tidak valid tidak dialihkan ke Gemini. Bot mengirim maksimal 20 pesan terbaru sebagai konteks dan menyimpan hanya 20 pesan terbaru per sesi di SQLite. Jawaban panjang dipecah agar sesuai batas Discord. Log mencatat metadata request, bukan isi chat atau API key.

API Groq memakai [Chat Completions](https://console.groq.com/docs/api-reference); Gemini memakai [generateContent](https://ai.google.dev/api/generate-content). Model contoh di `.env.example` dapat berubah ketersediaannya menurut akun/provider; periksa model yang tersedia di [Groq](https://console.groq.com/docs/models) dan [Gemini](https://ai.google.dev/gemini-api/docs/models).

## Focus Room

- `/focus start duration:25` memulai satu sesi fokus per pengguna dalam server. Durasi default yang diizinkan 5–180 menit.
- `/focus status` menampilkan waktu mulai, perkiraan selesai, sisa waktu, dan streak.
- `/focus stop` menghentikan sesi; waktu dari sesi yang dihentikan tidak masuk statistik.
- `/focus stats` menampilkan jumlah sesi selesai, total menit fokus, streak saat ini, dan streak terbaik.

Sesi disimpan di SQLite. Ketika waktu habis, bot menandai sesi selesai dan mengirim pemberitahuan teks di kanal tempat sesi dimulai. Jika bot restart, sesi aktif dipulihkan menurut waktu selesai yang tersimpan; sesi yang sudah lewat saat offline ditandai selesai. Kegagalan mengirim pemberitahuan tidak membatalkan penyelesaian sesi. Streak dihitung dari hari dengan minimal satu sesi selesai memakai `APP_TIMEZONE` (default `Asia/Jakarta`). Tidak ada pemanggilan Groq/Gemini untuk Focus Room.

Untuk menguji: jalankan `/focus start duration:5`, periksa `/focus status`, lalu `/focus stop` dan `/focus stats`. Uji pemulihan dengan memulai sesi, restart bot, lalu periksa `/focus status`; waktu selesai harus tetap sama. Untuk uji selesai alami, biarkan timer mencapai waktu selesai dan pastikan pemberitahuan muncul serta `/focus stats` bertambah.

Voice AI memakai `/ai` untuk kontrol mode Assistant, Casual, dan Curhat. Detail Phase 6 ada di bagian bawah.

## Phase 4: Core Music Player

StudyHub memakai **Sonata 4.1.0** sebagai proses audio terpisah dan **Shoukaku 4.3.0** sebagai klien Lavalink/Discord voice. Shoukaku dipilih karena masih tersedia sebagai klien TypeScript untuk Lavalink v4 dan discord.js; hanya satu klien Lavalink dipasang. Paket Sonata 4.1.0 memiliki beberapa perbedaan protokol terhadap Lavalink v4. Skrip `sonata/fix-package-imports.mjs` memperbaiki import map paket terbitan, menambah alias WebSocket `/v4/websocket`, dan menjaga reconnect voice saat endpoint hilang. Adapter `SonataProvider` menormalkan respons pencarian dan memakai pesan WebSocket Sonata untuk playback. Konfigurasi Sonata memilih enkripsi AEAD yang diterima Discord dan menonaktifkan silence frame bawaan yang dikirim dengan format keliru. Patch ini khusus versi 4.1.0 dan harus ditinjau ulang sebelum upgrade Sonata.

Command tersedia:

- `/play query:<judul atau URL YouTube>`: putar lagu atau tambahkan ke antrean.
- `/pause`, `/resume`, `/skip`, `/stop`: kontrol pemutar.
- `/queue`: tampilkan lagu aktif dan sepuluh lagu berikutnya.
- `/volume value:<0-100>`: atur volume, default 50%.

Respons pemutar menampilkan cover lagu besar (jika tersedia), judul, artis, progres, peminta lagu, volume, antrean, dan tiga baris tombol bergaya pemutar musik. Simbol tombol dibuat dengan label teks, bukan emoji keyboard. Kontrol aktif: ▶ lanjut, ❚❚ jeda, ▷| lewati, ■ berhenti, ☰ antrean, dan —/＋ volume. Tombol previous, loop, rewind, like, forward, lyrics, shuffle, dan filter ditampilkan nonaktif sampai fiturnya tersedia. Progres pada pesan diperbarui saat panel dibuat atau tombol ditekan. Tombol antrean menampilkan status terbaru secara privat; tombol lain hanya dapat dipakai anggota di voice channel bot. Panel yang lebih lama tetap mengontrol lagu yang sedang aktif saat tombol ditekan.

Font teks dan bentuk tombol mengikuti Discord. Berkas PNG di `assets/music-icons/` tetap tersedia sebagai aset desain bila nanti ingin membuat varian dengan application emoji.

Pengguna harus berada di voice channel untuk `/play` dan seluruh kontrol; setelah bot bergabung, kontrol hanya berlaku dari voice channel yang sama. `/queue` dapat dibaca tanpa masuk voice. Antrean per server disimpan di memori dan hilang saat restart. Saat antrean kosong, bot menunggu 180 detik sebelum keluar dari voice. YouTube adalah sumber musik yang didukung.

### Menjalankan Sonata di Windows 11

1. Gunakan Node.js 24. Dari root project, jalankan `npm.cmd install` lalu `npm.cmd --prefix sonata install`.
2. Tambahkan variabel `SONATA_HOST`, `SONATA_PORT`, `SONATA_PASSWORD`, `SONATA_SECURE`, `MUSIC_DEFAULT_VOLUME`, dan `MUSIC_IDLE_TIMEOUT_SECONDS` dari `.env.example` ke `.env` yang sudah ada. Buat password acak panjang dan gunakan **nilai yang sama** untuk bot dan Sonata. Jangan commit `.env`.
3. Untuk development, jalankan `npm.cmd run dev` dari root project. Skrip ini menyalakan Sonata bila portnya belum aktif, menunggu sampai siap, lalu menjalankan bot dalam mode watch. Hentikan keduanya dengan Ctrl+C. Jika Sonata sudah dijalankan terpisah, skrip memakai proses yang ada dan tidak membuat proses Sonata kedua.
4. Untuk menjalankan hasil build, terminal pertama: `npm.cmd --prefix sonata start`. Tunggu log `Server listening on 127.0.0.1:2333`. Terminal kedua: `npm.cmd run register`, lalu `npm.cmd run build` dan `npm.cmd start`. Tunggu log `Discord connected` dan `Sonata connected`, lalu coba `/bot status` (Sonata Online).
5. Pada cara hasil build, hentikan masing-masing proses dengan Ctrl+C di terminalnya. Sonata tidak akan dimatikan otomatis ketika bot berhenti.

Sonata default mendengar pada `127.0.0.1:2333`; host loopback membatasi koneksi ke komputer lokal. Uji listener Windows dengan `Test-NetConnection 127.0.0.1 -Port 2333`. Jika Sonata belum berjalan, bot tetap dapat menjalankan Foundation, AI, dan Focus; command musik memberi pesan offline. Setelah Sonata hidup, adapter mencoba menyambung ulang dengan jeda yang meningkat sampai 60 detik. Untuk Linux Mint nanti, jalankan Sonata dan StudyHub sebagai dua service terpisah dengan working directory project yang benar; panduan service produksi belum menjadi bagian Phase 4.

Jika `npm.cmd run dev` gagal di Windows dengan `uv_os_get_passwd` dari `tsx`, gunakan `npm.cmd run build` dan `npm.cmd start`. Skrip `npm.cmd test` memakai JavaScript hasil kompilasi untuk menghindari kegagalan lingkungan tersebut.

## Phase 5: Playlist pribadi dan musik Focus

Jalankan `npm.cmd run register` sekali setelah pembaruan agar grup `/playlist` muncul di server. Playlist lama dan data Focus/AI tidak dihapus; migration `005_playlists` otomatis dijalankan saat startup. Dua batas opsional di `.env` adalah `PLAYLIST_MAX_PER_USER=50` dan `PLAYLIST_MAX_TRACKS=200`.

- `/playlist create name:belajar` membuat playlist pribadi. Nama 1–40 karakter, unik tanpa membedakan huruf besar/kecil per guild dan user.
- `/playlist add name:belajar` menyimpan lagu yang sedang diputar. Tambahkan `query:<judul atau URL YouTube>` untuk mencari dan menyimpan lagu lain.
- `/playlist import name:belajar url:<URL playlist YouTube>` menambahkan banyak lagu dari playlist YouTube sekaligus. Tautan `youtube.com/playlist?list=...` atau video dengan parameter `list=...` diterima. Bot menampilkan jumlah yang berhasil masuk dan berhenti saat batas 200 lagu tercapai.
- `/playlist list` dan `/playlist show name:belajar` menampilkan daftar dan isi playlist. Daftar track dibatasi 15 per respons.
- `/playlist remove name:belajar position:3` menghapus lagu ketiga; `/playlist delete name:belajar` menghapus playlist beserta seluruh track.
- `/playlist load name:belajar` memuat lagu ke antrean dari voice channel yang sama dengan bot. Setiap video di-resolve ulang dari ID YouTube; track yang tidak tersedia hanya dilewati pada pemuatan itu dan tetap tersimpan.
- `/playlist set-focus name:belajar` memilih satu playlist Focus; `/playlist unset-focus` melepasnya.

`/focus start` tetap memulai timer meskipun voice, Sonata, izin bot, atau lagu tidak tersedia. Jika playlist Focus dipilih dan pemutar guild sedang idle, bot mencoba memutarnya otomatis. Jika pemutar sudah dipakai, musik yang ada tetap berjalan. `/focus stop` dan timer selesai hanya menghentikan musik yang masih dimiliki sesi Focus tersebut; interaksi musik manual melepas kepemilikan otomatis. Saat restart, playlist dan timer Focus dipulihkan, sedangkan antrean musik dan pemutaran Focus tidak dipulihkan. Playlist tidak mengunduh audio dan tidak menyimpan URL stream sementara.

Impor playlist membaca halaman playlist YouTube publik dan halaman lanjutan yang tersedia, dengan Sonata sebagai cadangan. Playlist privat, video yang tidak tersedia, atau perubahan format halaman YouTube bisa membuat sebagian lagu tidak terbaca. Impor berhenti pada kapasitas playlist StudyHub; balasan command menunjukkan jumlah yang benar-benar tersimpan. Tidak ada API key YouTube tambahan atau unduhan audio.

## Phase 6: Voice Conversation PoC

Jalankan `npm.cmd run register` setelah update agar command `/ai` muncul. `/ai join` mengajak bot masuk ke voice channel pengguna; pengguna itu menjadi satu-satunya speaker yang diproses. `/ai mode mode:assistant|casual|curhat` mengganti gaya tanpa reconnect, `/ai status` menampilkan owner, channel, mode, state, dan durasi, dan `/ai leave` mengakhiri sesi. Hanya owner yang boleh mengganti mode atau keluar. Jika owner keluar atau bot dipindah/disconnect, sesi ditutup otomatis. Saat idle 10 menit, bot juga keluar.

Mode **Assistant** membantu belajar, **Casual** mengobrol santai, dan **Curhat** mendengarkan dengan hangat tanpa buru-buru memberi saran. Voice memakai konteks sementara maksimal 12 pesan yang terpisah dari AI mention; konteks hilang saat sesi berakhir. Respons biasanya 1–4 kalimat. Bot mendengar tanpa wake word selama state Listening. Saat Processing atau Speaking, audio baru diabaikan; belum ada interruption, percakapan multi speaker, atau RVC. Headphone disarankan karena belum ada acoustic echo cancellation.

Pipeline: receive Opus Discord dengan `selfDeaf: false` dan subscription hanya untuk owner, decode melalui `opusscript`, jeda 1000 ms mengakhiri ucapan, lalu PCM diturunkan menjadi WAV mono 16 kHz di memori. Ucapan di bawah 350 ms diabaikan dan ucapan dipotong setelah 30 detik. Groq Whisper mentranskripsikan audio; AIService Groq/Gemini lama memberi jawaban; Edge TTS `id-ID-GadisNeural` membuat MP3; `@discordjs/voice` memakai FFmpeg dan Opus untuk playback. Audio dan transkrip tidak disimpan ke SQLite atau log. Audio sementara hanya berada di memori. Receive audio Discord masih bersifat eksperimental menurut dokumentasi `@discordjs/voice`.

Sonata tetap khusus musik. `/ai join` ditolak jika music session sedang aktif; gunakan `/stop` dahulu. `/play` dan pemuatan playlist ditolak selama Voice AI aktif; gunakan `/ai leave` dahulu. Timer Focus tetap berjalan. Bot memerlukan izin View Channel, Connect, dan Speak. Konfigurasi opsional tersedia di `.env.example`: `VOICE_STT_MODEL`, `VOICE_STT_LANGUAGE` (kosong untuk autodetect), `VOICE_END_SILENCE_MS`, `VOICE_MAX_UTTERANCE_SECONDS`, `VOICE_MAX_CONTEXT_MESSAGES`, `VOICE_SESSION_IDLE_MINUTES`, dan `VOICE_TTS_VOICE`. `GROQ_API_KEY` yang sama dipakai untuk STT; tidak perlu key baru. Jika instalasi baru memblokir install script `ffmpeg-static`, jalankan `npm.cmd install-scripts approve ffmpeg-static` dan pastikan binernya tersedia sebelum uji playback. Edge TTS adalah layanan online pihak ketiga dan dapat berubah sewaktu-waktu. Paket `@andresaya/edge-tts` berlisensi GPL-3.0-only; `ffmpeg-static` berlisensi GPL-3.0-or-later. Periksa kewajiban lisensi jika project didistribusikan.

Untuk uji cloud tanpa merekam pengguna, jalankan `npm.cmd run build` lalu `node scripts/voice-smoke.mjs`; skrip menghasilkan ucapan sintetis dan mentranskripsikannya lewat Groq. Setelah itu jalankan satu bot, lalu uji `/ai join`, bicara satu kalimat, bicara kalimat kedua yang merujuk jawaban pertama, ganti tiga mode, periksa `/ai status`, lalu `/ai leave`. Coba user lain bicara dan pastikan bot diam. Uji `/play` saat Voice AI aktif serta `/ai join` saat musik aktif. Log `Voice utterance completed` mencatat `sttMs`, `llmMs`, `ttsMs`, `responseStartMs`, dan `totalMs` tanpa isi transkrip. `responseStartMs` adalah waktu sampai player mulai, bukan bukti audio terdengar di klien Discord. Untuk CPU/RAM, catat proses bot dengan Task Manager atau `Get-Process node | Select-Object Id,CPU,WorkingSet64` sebelum join, saat idle, bicara, dan playback. Uji Lenovo IdeaPad 330 Linux Mint belum dilakukan.

## Checklist uji AI text

- [ ] Mention bot di channel belajar mendapat balasan; mention di channel lain diabaikan.
- [ ] Pesan biasa tanpa mention atau Reply diabaikan, termasuk dari pengguna yang punya sesi aktif.
- [ ] Reply penanya asal pada jawaban bot melanjutkan sesi dan memakai konteks sebelumnya; Reply pengguna lain diabaikan.
- [ ] Mention baru memulai topik baru tanpa konteks lama; Reply ke jawaban topik yang sudah ditutup diabaikan.
- [ ] Mention `@StudyHub sudah selesai` atau `@StudyHub makasih, cukup` menutup sesi tanpa request AI.
- [ ] Setelah timeout, pesan biasa diabaikan. Reply ke jawaban lama membuka sesi baru tanpa konteks lama.
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
