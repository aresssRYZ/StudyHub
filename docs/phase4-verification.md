# Phase 4 verification (2026-09-25, Windows 11)

## Automated checks

- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed.
- `npm.cmd test`: 19 passed, 0 failed. Music cases cover parallel `/play` mutations, per-guild isolation, queue advance, skip event deduplication, pause/resume, volume, stop, missing tracks, offline node, voice-channel mismatch in the service and command, track failure, skipping an unplayable queued track, idle timer cancellation, and idle disconnect. Existing AI and Focus tests also passed.
- `npm.cmd run register`: registered `/bot status`, `/focus`, `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/volume` in the configured guild.

## Live service checks

- Sonata 4.1.0 started separately on `127.0.0.1:2333`; StudyHub connected to Discord and Sonata. `/bot status` can report Sonata availability without querying the service.
- Sonata resolver returned a YouTube track for `ytsearch:NIKI High School in Jakarta` and for a YouTube watch URL. The `SonataProvider` adapter parsed both results into title, source, duration, and encoded track.
- StudyHub started while Sonata was offline: Discord and database remained active. After Sonata started, it reconnected and logged `Sonata connected` without restarting StudyHub. Stopping Sonata during a connection also left the bot process active, and a subsequent Sonata restart recovered.
- A smoke test joined an empty Discord voice channel, sent a YouTube track to Sonata, and kept the connection up for 20 seconds. Sonata connected to Discord voice, fetched the audio stream (HTTP 200; 589,824 bytes observed), accepted pause/resume/volume/stop, and disconnected cleanly. A second smoke test queued another track and `/skip` started it once. A third smoke test used the 19-second "Me at the zoo" track; Sonata emitted a finished event and StudyHub automatically started the queued track. Hearing the sound still requires a person in the channel and has not been confirmed.

## Resource sample

The two processes were idle with no track playing. `Get-Process` samples five seconds apart:

| Process | PID | Working set | CPU delta over 5 s |
| --- | ---: | ---: | ---: |
| StudyHub | 75640 | 16.7 MB | 0.000 s |
| Sonata | 78132 | 43.1 MB | 0.016 s |
| Combined | | 59.8 MB | 0.016 s |

These are Windows working-set snapshots, which can be trimmed by the OS. They are not a benchmark of the planned Lenovo A9 Linux host.

During the 20-second single-track smoke test, a five-second sample showed StudyHub at 77.4 MB working set and Sonata at 32.4 MB (combined 109.8 MB). CPU time increased 0.031 s for each process over five seconds. With one track playing and one queued, a later sample showed StudyHub at 52.6 MB and Sonata at 41.4 MB (combined 94.0 MB); CPU time increased 0 s and 0.047 s respectively over five seconds. Working sets varied because Windows trimmed memory between samples. No conclusion about Lenovo A9 suitability follows from this Windows sample.

## Compatibility and environment notes

- Sonata's published 4.1.0 npm package lacks its source import map and only accepts WebSocket connections at `/`. `sonata/fix-package-imports.mjs` applies an idempotent local compatibility patch for Shoukaku's `/v4/websocket` path. The resolver also returns a v3-shaped result, which the adapter normalizes.
- Sonata 4.1.0 uses native WebSocket messages to start streaming; `SonataProvider` sends those messages while Shoukaku handles the Discord voice connection and Lavalink session. Upgrading Sonata requires checking these protocol differences again.
- Sonata's default legacy voice encryption was rejected by Discord with code 4016. The local config selects current AEAD modes. Its default silence frame is raw PCM sent as Opus and exceeded the packet buffer, so silence frames are disabled. The patch script also guards a reconnect attempt with a cleared voice endpoint to prevent a process crash after a failed voice handshake.
- In this Windows environment, `tsx` failed during initialization because `os.userInfo()` returned `ENOMEM`. Tests and command registration therefore run compiled JavaScript. `npm.cmd run build` followed by `npm.cmd start` is the verified bot startup path.
