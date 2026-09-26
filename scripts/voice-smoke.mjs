// Cloud smoke test with synthetic Indonesian speech. Never records users.
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { EdgeTTS } from '@andresaya/edge-tts';
import ffmpeg from 'ffmpeg-static';
import { createAudioResource } from '@discordjs/voice';
import { Readable } from 'node:stream';
import { GroqWhisperProvider } from '../dist/src/voice/stt.js';

loadEnvFile('.env');
const rssBefore = process.memoryUsage().rss;
const cpuBefore = process.cpuUsage();
const tts = new EdgeTTS();
const ttsStart = performance.now();
await tts.synthesize('Halo, ini uji suara bahasa Indonesia.', process.env.VOICE_TTS_VOICE || 'id-ID-GadisNeural');
const ttsMs = Math.round(performance.now() - ttsStart);
const conversion = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'], {
  input: tts.toBuffer(), maxBuffer: 16 * 1024 * 1024
});
if (conversion.status !== 0 || !conversion.stdout.length) throw new Error('TTS audio could not be converted to WAV.');
const sttStart = performance.now();
const transcript = await new GroqWhisperProvider(process.env.GROQ_API_KEY,
  process.env.VOICE_STT_MODEL || 'whisper-large-v3-turbo', process.env.VOICE_STT_LANGUAGE ?? 'id')
  .transcribe(conversion.stdout, AbortSignal.timeout(20_000));
const sttMs = Math.round(performance.now() - sttStart);
const encodeStart = performance.now();
const resource = createAudioResource(Readable.from([tts.toBuffer()]));
let opusPackets = 0;
for await (const packet of resource.playStream) {
  if (packet.length > 3) opusPackets++;
}
const encodeMs = Math.round(performance.now() - encodeStart);
const cpuUsed = process.cpuUsage(cpuBefore);
console.log(JSON.stringify({ ttsMs, sttMs, encodeMs, opusPackets, transcript,
  cpuMs: Math.round((cpuUsed.user + cpuUsed.system) / 1000),
  rssDeltaMb: Math.round((process.memoryUsage().rss - rssBefore) / 1048576) }));
