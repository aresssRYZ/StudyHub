// Discord Opus decodes to signed 16-bit stereo PCM at 48 kHz.
export function wavFromDiscordPcm(chunks: Buffer[]): Buffer {
  const pcm = Buffer.concat(chunks);
  const samples = Math.floor(pcm.length / 12);
  const wav = Buffer.allocUnsafe(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const offset = index * 12;
    const mono = (pcm.readInt16LE(offset) + pcm.readInt16LE(offset + 2)) / 2;
    wav.writeInt16LE(Math.round(mono), 44 + index * 2);
  }
  return wav;
}

export function pcmDurationMs(chunks: Buffer[]): number {
  return chunks.reduce((total, chunk) => total + chunk.length, 0) / 192;
}
