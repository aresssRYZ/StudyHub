# Phase 6 Voice Conversation PoC — verifikasi

## Arsitektur dan dependensi

`/ai join` membuat satu sesi per guild. `@discordjs/voice` bergabung dengan `selfDeaf:false` dalam group terpisah, lalu `VoiceReceiver` hanya subscribe ke Discord ID pemilik. `opusscript` 0.0.8 mendecode Opus menjadi PCM stereo 48 kHz. Akhir ucapan dideteksi oleh `AfterSilence` 1000 ms; batas 30 detik dan minimum 350 ms mencegah rekaman tanpa batas serta noise singkat. Audio menjadi WAV mono 16 kHz di memori dan dikirim ke Groq `audio/transcriptions`, default `whisper-large-v3-turbo`, hint `id`. `VoiceConversationService` menggunakan `AiService` Groq/Gemini lama dengan history voice sementara dan prompt mode terpisah. `@andresaya/edge-tts` 1.8.1 menghasilkan MP3 memakai `id-ID-GadisNeural`; `ffmpeg-static` 5.3.0 dan `@discordjs/voice` membuat paket Opus untuk playback. Voice AI dan Sonata saling menolak saat yang lain sedang aktif. Tidak ada RVC, database audio, atau file audio sementara.

Node yang diuji: 24.21.0. `@discordjs/voice` 0.19.2 mendukung Node >=22.12. Decoder `@discordjs/opus` native dicoba tetapi tidak tersedia prebuilt untuk Node 24 Windows ini dan C++ toolset lokal tidak lengkap; digunakan satu decoder Opus yaitu `opusscript`. Paket `@andresaya/edge-tts` dipilih setelah paket Edge pertama berhasil mengambil katalog suara tetapi gagal menghasilkan audio. Paket akhir berhasil membuat MP3 Indonesia. Lisensi paket TTS adalah GPL-3.0-only dan `ffmpeg-static` GPL-3.0-or-later; periksa kewajiban jika project didistribusikan.

Rujukan: [Discord voice receive](https://discord.js.org/docs/packages/voice/stable), [VoiceReceiver](https://discord.js.org/docs/packages/voice/main/VoiceReceiver:Class), [EndBehaviorType](https://discord.js.org/docs/packages/voice/main/EndBehaviorType:Enum), [Groq Speech to Text](https://console.groq.com/docs/speech-to-text), [katalog suara Microsoft](https://learn.microsoft.com/id-id/azure/ai-services/speech-service/language-support), [paket TTS](https://github.com/andresayac/edge-tts).

## Hasil lokal

- `npm.cmd run typecheck`: lulus.
- `npm.cmd run build`: lulus.
- `npm.cmd test`: 40 tes lulus, 0 gagal. Ini mencakup regresi AI teks, Focus, musik, playlist serta uji baru voice: prompt/memori, PCM/WAV, encode/decode Opus, hanya subscribe pemilik, half-duplex, noise pendek, payload STT, HTTP STT gagal, musik eksklusif, dan `/ai join` tanpa voice.
- `npm.cmd run register`: berhasil mendaftarkan `/ai` pada guild target.
- `node scripts/voice-smoke.mjs`: ucapan sintetis Indonesia ditranskripsikan tepat: “Halo, ini uji suara bahasa Indonesia.” Contoh pengukuran terakhir: TTS 901 ms; STT 498 ms; encoding 143 ms untuk 219 paket Opus; CPU proses selama smoke 172 ms; kenaikan RSS 10 MB. Angka ini bergantung jaringan dan perangkat serta **bukan** latency Discord voice langsung. Uji sebelumnya: TTS 2817 ms dan STT 727 ms.

## Uji Discord voice yang masih memerlukan pengguna di voice

| # | Skenario | Bukti sekarang / sisa uji |
| --- | --- | --- |
| 1 | `/ai join` tanpa voice | Lulus tes command lokal |
| 2 | Owner join dan bot masuk voice | Command terdaftar; perlu uji Discord live |
| 3 | Audio owner diterima | Pipeline decoder lokal lulus; perlu uji Discord live |
| 4 | STT Indonesia | Transkrip audio sintetis tepat; perlu audio owner live |
| 5 | Transkrip ke AIService | Tes konteks dengan AIService lulus; perlu live |
| 6 | TTS terdengar | MP3 dan paket Opus terbentuk; perlu dengar di Discord |
| 7 | Ucapan kedua memakai konteks | Tes memori lulus; perlu live |
| 8 | User lain diabaikan | Tes receiver sintetis lulus; perlu live |
| 9 | Assistant | Prompt diuji; perlu evaluasi suara live |
| 10 | Casual | Prompt diuji; perlu evaluasi suara live |
| 11 | Curhat | Prompt diuji; perlu evaluasi suara live |
| 12 | Mode switch tanpa reconnect | Handler ada; perlu live |
| 13 | Speech saat bot bicara diabaikan | Tes guard state lulus; perlu live |
| 14 | Empty/noise | Noise pendek diabaikan dalam tes; transkrip kosong dicek di kode |
| 15 | STT gagal | Tes HTTP 503 lulus; fallback suara/teks perlu live |
| 16 | LLM gagal | Timeout dan fallback ada; perlu live |
| 17 | TTS gagal | Fallback teks ada; perlu live |
| 18 | Owner keluar voice | Listener cleanup ada; perlu live |
| 19 | `/ai leave` | Cleanup ada; perlu live |
| 20 | Idle timeout | Timer ada; perlu live |
| 21 | Music aktif lalu `/ai join` | Pengunci memakai music session dan pending; perlu live |
| 22 | Voice AI aktif lalu `/play` | Tes musik lulus; perlu live |
| 23 | Voice AI leave lalu Music | Tes musik lulus; perlu live |
| 24 | Restart bot saat Voice AI | Sesi in-memory; perlu live |
| 25 | Graceful shutdown | `voice.dispose()` terhubung; perlu live |

Log `Voice utterance completed` mencatat `audioMs`, `sttMs`, `llmMs`, `ttsMs`, `responseStartMs`, dan `totalMs` tanpa transkrip. Untuk mengukur CPU dan RAM target Lenovo A9/Linux Mint, jalankan uji voice langsung di mesin tersebut dan catat idle, saat pengguna bicara, serta playback. Belum ada angka untuk mesin target atau audio Discord nyata; jangan menganggap hasil sintetis sebagai bukti target latensi produksi.
