export interface MusicTrack {
  encoded: string;
  title: string;
  uri: string;
  durationMs: number;
  requesterId: string;
  source: string;
}

export interface MusicProvider {
  available(): boolean;
  resolve(query: string, requesterId: string): Promise<MusicTrack | null>;
  join(guildId: string, voiceChannelId: string): Promise<void>;
  play(guildId: string, track: MusicTrack, volume: number): Promise<void>;
  pause(guildId: string, paused: boolean): Promise<void>;
  stopTrack(guildId: string): Promise<void>;
  volume(guildId: string, level: number): Promise<void>;
  leave(guildId: string): Promise<void>;
  dispose?(): Promise<void>;
  onEnd?: (guildId: string, encoded: string, reason: string) => void;
  onFailure?: (guildId: string, encoded?: string) => void;
  onOffline?: () => void;
}
