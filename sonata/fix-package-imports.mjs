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
                        this.#startHttpsStream(video.streamUrl, false, attempt + 1, offset);
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

const streamerBeforeRanges = await readFile(streamerPath, 'utf8');
if (streamerBeforeRanges.includes('this.#startHttpsStream(video.streamUrl, false, attempt + 1);')) {
  await writeFile(streamerPath, streamerBeforeRanges.replace(
    'this.#startHttpsStream(video.streamUrl, false, attempt + 1);',
    'this.#startHttpsStream(video.streamUrl, false, attempt + 1, offset);'));
}
const streamerForRanges = await readFile(streamerPath, 'utf8');
if (!streamerForRanges.includes('const chunkedYoutube = !isNext')) {
  const methodStart = `#startHttpsStream(uri, isNext, attempt = 0) {
        const opts = {`;
  const requestStart = `if (this.#proxyAgent)
            opts.agent = this.#proxyAgent;
        const req = https.get(uri, opts, (res) => {`;
  const redirect = `this.#startHttpsStream(res.headers.location, isNext);`;
  const ok = `if (res.statusCode !== 200) {
                this.#logger?.error('streamer', \`HTTP \${res.statusCode} for audio stream\`);`;
  const pipe = `res.on('end', () => this.#logger?.debug('streamer', \`HTTP response ended, total=\${httpBytes} bytes\`));
                res.pipe(targetDemuxer);`;
  if (![methodStart, requestStart, redirect, ok, pipe].every((part) => streamerForRanges.includes(part))) {
    throw new Error('Sonata audio streamer changed; review the YouTube range patch.');
  }
  const ranged = streamerForRanges
    .replace(methodStart, `#startHttpsStream(uri, isNext, attempt = 0, offset = 0) {
        const track = this.#currentTrack;
        const streamUrl = new URL(uri);
        const totalBytes = Number(streamUrl.searchParams.get('clen'));
        const chunkedYoutube = !isNext && track?.source === 'youtube' &&
            streamUrl.hostname.endsWith('.googlevideo.com') &&
            Number.isSafeInteger(totalBytes) && totalBytes > 0;
        const chunkEnd = chunkedYoutube ? Math.min(offset + 1048575, totalBytes - 1) : 0;
        const opts = {`)
    .replace(requestStart, `if (this.#proxyAgent)
            opts.agent = this.#proxyAgent;
        if (chunkedYoutube) opts.headers.Range = \`bytes=\${offset}-\${chunkEnd}\`;
        const req = https.get(uri, opts, (res) => {`)
    .replace(redirect, 'this.#startHttpsStream(res.headers.location, isNext, attempt, offset);')
    .replace(ok, `if (res.statusCode !== (chunkedYoutube ? 206 : 200)) {
                this.#logger?.error('streamer', \`HTTP \${res.statusCode} for audio stream\`);`)
    .replace(pipe, `res.on('end', () => {
                    this.#logger?.debug('streamer', \`HTTP response ended, total=\${httpBytes} bytes\`);
                    if (chunkedYoutube && this.#currentTrack === track) {
                        if (offset + httpBytes < totalBytes && httpBytes === chunkEnd - offset + 1)
                            this.#startHttpsStream(uri, false, 0, offset + httpBytes);
                        else if (offset + httpBytes === totalBytes)
                            targetDemuxer.end();
                        else this.#onEnd('loadFailed');
                    }
                });
                res.pipe(targetDemuxer, { end: !chunkedYoutube });`);
  await writeFile(streamerPath, ranged);
}

const streamerBeforePrefill = await readFile(streamerPath, 'utf8');
if (!streamerBeforePrefill.includes('const initialOpusFrames = this.#pcmBuffer.length')) {
  const prebufferEnd = `else if (this.#streamEnded) {
                    this.#prebuffering = false;
                    this.#logger?.debug('streamer', \`pre-buffer done, \${this.#opusBuffer.length} opus frames (stream ended)\`);
                }`;
  if (!streamerBeforePrefill.includes(prebufferEnd)) {
    throw new Error('Sonata audio streamer changed; review the Opus prefill patch.');
  }
  await writeFile(streamerPath, streamerBeforePrefill.replace(prebufferEnd,
    `else if (this.#streamEnded) {
                    this.#prebuffering = false;
                    this.#logger?.debug('streamer', \`pre-buffer done, \${this.#opusBuffer.length} opus frames (stream ended)\`);
                    // Discord's sender has its own 20 ms clock. Queue two seconds before it starts.
                    const initialOpusFrames = this.#pcmBuffer.length === 0 && !this.#isCrossfading
                        ? Math.min(100, this.#opusBuffer.length) : 0;
                    for (let i = 0; i < initialOpusFrames; i++)
                        this.#voice.sendOpus(this.#opusBuffer.shift());
                }`));
}

const voiceBeforeDiagnostics = await readFile(voicePath, 'utf8');
if (!voiceBeforeDiagnostics.includes('audio diagnostics:')) {
  const pushFrame = 'this.#opusStream.pushFrame(opus);';
  if (!voiceBeforeDiagnostics.includes(pushFrame)) {
    throw new Error('Sonata voice sender changed; review the audio diagnostics patch.');
  }
  await writeFile(voicePath, voiceBeforeDiagnostics.replace(pushFrame, `${pushFrame}
        this._audioDiagnosticFrames = (this._audioDiagnosticFrames ?? 0) + 1;
        if (this._audioDiagnosticFrames % 250 === 0) {
            const stats = this.#connection.statistics;
            this.#logger?.info('voice', \`audio diagnostics: queued=\${this.#opusStream.readableLength} sent=\${stats.packetsSent} lost=\${stats.packetsLost} expected=\${stats.packetsExpected}\`);
        }`));
}

const voiceBeforeBufferGetter = await readFile(voicePath, 'utf8');
if (!voiceBeforeBufferGetter.includes('get bufferedOpusFrames()')) {
  const ssrcGetter = 'get ssrc() { return this.#connection?.udpInfo?.ssrc ?? 0; }';
  if (!voiceBeforeBufferGetter.includes(ssrcGetter)) {
    throw new Error('Sonata voice sender changed; review the buffer getter patch.');
  }
  await writeFile(voicePath, voiceBeforeBufferGetter.replace(ssrcGetter,
    `${ssrcGetter}
    get bufferedOpusFrames() { return this.#opusStream?.readableLength ?? 0; }`));
}

const streamerBeforeRefill = await readFile(streamerPath, 'utf8');
if (!streamerBeforeRefill.includes('const targetOpusFrames = 100;')) {
  const emptyBuffer = `if (this.#pcmBuffer.length === 0 && this.#streamEnded && this.#opusBuffer.length === 0) {`;
  const sendOne = `const opus = this.#opusBuffer.shift();
                this.#voice.sendOpus(opus);`;
  if (![emptyBuffer, sendOne].every((part) => streamerBeforeRefill.includes(part))) {
    throw new Error('Sonata audio streamer changed; review the Opus refill patch.');
  }
  await writeFile(streamerPath, streamerBeforeRefill
    .replace(emptyBuffer, `${emptyBuffer}
                if (!this.#pcmSource && this.#voice.bufferedOpusFrames > 0) return;`)
    .replace(sendOne, `const targetOpusFrames = 100;
                while (this.#opusBuffer.length > 0 && (this.#voice.bufferedOpusFrames ?? 0) < targetOpusFrames)
                    this.#voice.sendOpus(this.#opusBuffer.shift());`));
}

const cipherPath = resolve('node_modules/@sonata-sdk/server/dist/resolving/youtube/cipher.js');
const cipher = await readFile(cipherPath, 'utf8');
if (!cipher.includes('const opusFormats = audioFormats.filter')) {
  const sortStart = `audioFormats.sort((a, b) => {
        const aOpus = a.mimeType.includes('opus') ? 100 : 0;
        const bOpus = b.mimeType.includes('opus') ? 100 : 0;
        return (bOpus + (b.bitrate ?? 0)) - (aOpus + (a.bitrate ?? 0));
    });
    return audioFormats[0];`;
  if (!cipher.includes(sortStart)) {
    throw new Error('Sonata YouTube format selector changed; review the Opus patch.');
  }
  await writeFile(cipherPath, cipher.replace(sortStart,
    `const opusFormats = audioFormats.filter(f => f.mimeType.includes('audio/webm') && f.mimeType.includes('opus'));
    if (opusFormats.length === 0) return null;
    opusFormats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return opusFormats[0];`));
}

const innerTubePath = resolve('node_modules/@sonata-sdk/server/dist/resolving/youtube/innerTube.js');
const innerTube = await readFile(innerTubePath, 'utf8');
if (!innerTube.includes('if (result?.streamUrl)')) {
  const getVideoLoop = `async getVideo(videoId) {
        for (const client of this.#profiles) {
            try {
                const result = await this.#getVideoWithClient(videoId, client);
                if (result)
                    return result;`;
  if (!innerTube.includes(getVideoLoop)) {
    throw new Error('Sonata InnerTube client changed; review the playable URL fallback patch.');
  }
  await writeFile(innerTubePath, innerTube.replace(getVideoLoop,
    getVideoLoop.replace('if (result)', 'if (result?.streamUrl)')));
}

const streamerBeforeAdaptiveRanges = await readFile(streamerPath, 'utf8');
if (!streamerBeforeAdaptiveRanges.includes('reducing YouTube range size')) {
  const signature = '#startHttpsStream(uri, isNext, attempt = 0, offset = 0) {';
  const chunkEnd = 'Math.min(offset + 1048575, totalBytes - 1)';
  const retry403 = `if (res.statusCode === 403 && !isNext && attempt < 2 && this.#currentTrack?.source === 'youtube') {`;
  const freshCall = 'this.#startHttpsStream(video.streamUrl, false, attempt + 1, offset);';
  const redirectCall = 'this.#startHttpsStream(res.headers.location, isNext, attempt, offset);';
  const nextChunkCall = 'this.#startHttpsStream(uri, false, 0, offset + httpBytes);';
  if (![signature, chunkEnd, retry403, freshCall, redirectCall, nextChunkCall]
    .every((part) => streamerBeforeAdaptiveRanges.includes(part))) {
    throw new Error('Sonata audio streamer changed; review the adaptive range patch.');
  }
  const adaptive = streamerBeforeAdaptiveRanges
    .replace(signature, '#startHttpsStream(uri, isNext, attempt = 0, offset = 0, chunkSize = 1048576) {')
    .replace(chunkEnd, 'Math.min(offset + chunkSize - 1, totalBytes - 1)')
    .replace(retry403, `if (res.statusCode === 403 && chunkedYoutube && chunkSize > 65536) {
                res.resume();
                this.#logger?.warn('streamer', 'HTTP 403; reducing YouTube range size');
                this.#startHttpsStream(uri, false, attempt, offset, Math.max(65536, Math.floor(chunkSize / 4)));
                return;
            }
            ${retry403}`)
    .replace(freshCall, `const oldUrl = new URL(uri);
                        const newUrl = new URL(video.streamUrl);
                        if (offset > 0 && ['itag', 'clen', 'lmt'].some(key =>
                            oldUrl.searchParams.get(key) !== newUrl.searchParams.get(key))) {
                            this.#onEnd('loadFailed');
                            return;
                        }
                        this.#startHttpsStream(video.streamUrl, false, attempt + 1, offset, chunkSize);`)
    .replace(redirectCall, 'this.#startHttpsStream(res.headers.location, isNext, attempt, offset, chunkSize);')
    .replace(nextChunkCall, 'this.#startHttpsStream(uri, false, 0, offset + httpBytes, chunkSize);');
  await writeFile(streamerPath, adaptive);
}
