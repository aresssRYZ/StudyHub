import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifestPath = resolve('node_modules/@sonata-sdk/server/package.json');
const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));

if (manifest.version !== '4.1.0') {
  throw new Error(`Expected Sonata 4.1.0, found ${manifest.version}`);
}

if (!manifest.imports?.['#*']) {
  // The published package omits the import map present in Sonata's source manifest.
  manifest.imports = { ...manifest.imports, '#*': './dist/*.js' };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const entryPath = resolve('node_modules/@sonata-sdk/server/dist/index.js');
const entry = await readFile(entryPath, 'utf8');
if (!entry.includes("srv.ws('/v4/websocket');")) {
  const marker = "srv.ws('/');";
  if (!entry.includes(marker)) throw new Error('Sonata WebSocket entrypoint changed; review the compatibility patch.');
  // Shoukaku connects to the standard Lavalink v4 path; Sonata 4.1.0 only exposes '/'.
  await writeFile(entryPath, entry.replace(marker, `${marker}\nsrv.ws('/v4/websocket');`));
}

const voicePath = resolve('node_modules/@sonata-sdk/server/dist/discord/voice.js');
const voice = await readFile(voicePath, 'utf8');
const unguardedReconnect = 'if (this.#opts && this.#connection) {';
if (voice.includes(unguardedReconnect)) {
  // A failed voice handshake clears voiceServer; reconnecting without an endpoint crashes Sonata.
  await writeFile(voicePath, voice.replace(unguardedReconnect, 'if (this.#opts && this.#connection?.voiceServer?.endpoint) {'));
}

const streamerPath = resolve('node_modules/@sonata-sdk/server/dist/player/audio-streamer.js');
const streamer = await readFile(streamerPath, 'utf8');
if (!streamer.includes('HTTP 403; retrying fresh YouTube stream URL')) {
  const method = '#startHttpsStream(uri, isNext) {';
  const failedResponse = `if (res.statusCode !== 200) {
                this.#logger?.error('streamer', \`HTTP \${res.statusCode} for \${uri}\`);`;
  if (!streamer.includes(method) || !streamer.includes(failedResponse)) {
    throw new Error('Sonata audio streamer changed; review the YouTube retry patch.');
  }
  const retry = `if (res.statusCode === 403 && !isNext && attempt < 2 && this.#currentTrack?.source === 'youtube') {
                const failedTrack = this.#currentTrack;
                res.resume();
                void import('../resolving/youtube/innerTube.js').then(async ({ InnerTubeClient }) => {
                    const video = await new InnerTubeClient(['ANDROID']).getVideo(failedTrack.info.identifier);
                    if (this.#currentTrack !== failedTrack) return;
                    if (video?.streamUrl && video.streamUrl !== uri) {
                        this.#logger?.warn('streamer', 'HTTP 403; retrying fresh YouTube stream URL');
                        this.#startHttpsStream(video.streamUrl, false, attempt + 1);
                    } else this.#onEnd('loadFailed');
                }).catch(() => { if (this.#currentTrack === failedTrack) this.#onEnd('loadFailed'); });
                return;
            }
            `;
  const patched = streamer.replace(method, '#startHttpsStream(uri, isNext, attempt = 0) {')
    .replace(failedResponse, `${retry}${failedResponse}`);
  await writeFile(streamerPath, patched);
}
const streamerAfterRetry = await readFile(streamerPath, 'utf8');
const signedUrlLog = "this.#logger?.error('streamer', `HTTP ${res.statusCode} for ${uri}`);";
if (streamerAfterRetry.includes(signedUrlLog)) {
  await writeFile(streamerPath, streamerAfterRetry.replace(signedUrlLog,
    "this.#logger?.error('streamer', `HTTP ${res.statusCode} for audio stream`);"));
}
