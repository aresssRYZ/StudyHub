const password = process.env.SONATA_PASSWORD;
if (!password) throw new Error('SONATA_PASSWORD is required. Set it in the StudyHub .env file.');

export default {
  server: {
    host: process.env.SONATA_HOST || '127.0.0.1',
    port: Number(process.env.SONATA_PORT || '2333'),
    password,
    cors: false
  },
  logging: { level: 'normal' },
  player: { autoPlay: false },
  queue: { radioMode: { enabled: false } },
  voice: { encryptionFallback: ['aead_aes256_gcm_rtpsize', 'aead_xchacha20_poly1305_rtpsize'], silenceFrames: 0 },
  sources: {
    soundcloud: { enabled: false },
    spotify: { enabled: false },
    bandcamp: { enabled: false },
    twitch: { enabled: false },
    vimeo: { enabled: false },
    deezer: { enabled: false },
    apple: { enabled: false },
    nico: { enabled: false },
    mixcloud: { enabled: false },
    podcast: { enabled: false },
    jiosaavn: { enabled: false },
    http: false,
    local: false,
    priority: ['youtube']
  }
};
