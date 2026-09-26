import type { MusicTrack } from './types.js';

type Entry = Record<string, unknown>;
const object = (value: unknown): Entry | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Entry : null;
const nested = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((part, key) => object(part)?.[key], value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function itemsFrom(data: unknown): unknown[] {
  const tabs = list(nested(data, 'contents', 'twoColumnBrowseResultsRenderer', 'tabs'));
  for (const tab of tabs) {
    const sections = list(nested(tab, 'tabRenderer', 'content', 'sectionListRenderer', 'contents'));
    for (const section of sections) {
      const items = list(nested(section, 'itemSectionRenderer', 'contents'));
      if (items.some((item) => nested(item, 'lockupViewModel') || nested(item, 'playlistVideoRenderer'))) return items;
      const direct = list(nested(section, 'playlistVideoListRenderer', 'contents'));
      if (direct.length) return direct;
    }
  }
  for (const action of list(nested(data, 'onResponseReceivedActions'))) {
    const items = list(nested(action, 'appendContinuationItemsAction', 'continuationItems'));
    if (items.length) return items;
  }
  return [];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  const plain = nested(value, 'simpleText');
  if (typeof plain === 'string') return plain;
  const content = nested(value, 'content');
  if (typeof content === 'string') return content;
  return list(nested(value, 'runs')).map((run) => object(run)?.text).filter((part): part is string => typeof part === 'string').join('');
}

function durationMs(value: string): number {
  const match = value.match(/\b(?:(\d+):)?(\d+):(\d{2})\b/);
  return match ? ((Number(match[1] ?? 0) * 3600) + Number(match[2]) * 60 + Number(match[3])) * 1000 : 0;
}

export function readYoutubePlaylistPage(data: unknown, requesterId: string): { tracks: MusicTrack[]; continuation?: string } {
  const items = itemsFrom(data);
  const tracks: MusicTrack[] = [];
  let continuation: string | undefined;
  for (const item of items) {
    const token = nested(item, 'continuationItemViewModel', 'continuationCommand', 'innertubeCommand', 'continuationCommand', 'token')
      ?? nested(item, 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token');
    if (typeof token === 'string') { continuation = token; continue; }
    const lockup = nested(item, 'lockupViewModel');
    const video = nested(item, 'playlistVideoRenderer') ?? nested(item, 'videoRenderer');
    const id = object(lockup)?.contentId ?? object(video)?.videoId;
    if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) continue;
    const metadata = nested(lockup, 'metadata', 'lockupMetadataViewModel');
    const rows = list(nested(metadata, 'metadata', 'contentMetadataViewModel', 'metadataRows'));
    const details = rows.map((row) => list(nested(row, 'metadataParts')).map((part) => text(nested(part, 'text'))).join(' ')).join(' ');
    const title = (text(nested(metadata, 'title')) || text(nested(video, 'title')) || 'Judul tidak tersedia').slice(0, 180);
    const firstPart = list(nested(rows[0], 'metadataParts'))[0];
    const author = text(nested(firstPart, 'text')) ||
      text(nested(video, 'ownerText')) || text(nested(video, 'shortBylineText'));
    tracks.push({ encoded: id, title, uri: `https://www.youtube.com/watch?v=${id}`,
      durationMs: durationMs(details || text(nested(video, 'lengthText'))), requesterId,
      source: 'youtube', author: author.slice(0, 100) || undefined });
  }
  return { tracks, continuation };
}

async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`YouTube playlist request failed (${response.status}).`);
  return response.json();
}

export async function fetchYoutubePlaylist(url: string, requesterId: string, limit: number): Promise<MusicTrack[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`YouTube playlist request failed (${response.status}).`);
  const html = await response.text();
  if (html.length > 10_000_000) throw new Error('Halaman playlist YouTube terlalu besar.');
  const marker = html.match(/(?:var\s+)?ytInitialData\s*=\s*/);
  if (!marker || marker.index === undefined) return [];
  const start = marker.index + marker[0].length;
  const end = html.indexOf(';</script>', start);
  if (end < 0) return [];
  const initial: unknown = JSON.parse(html.slice(start, end));
  const first = readYoutubePlaylistPage(initial, requesterId);
  const tracks = first.tracks.slice(0, limit);
  let continuation = first.continuation;
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  const seen = new Set<string>();
  while (continuation && apiKey && clientVersion && tracks.length < limit && seen.size < 10 && !seen.has(continuation)) {
    seen.add(continuation);
    try {
      const page = await jsonResponse(await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion } }, continuation }),
        signal: AbortSignal.timeout(15000)
      }));
      const parsed = readYoutubePlaylistPage(page, requesterId);
      tracks.push(...parsed.tracks.slice(0, limit - tracks.length));
      continuation = parsed.continuation;
    } catch { break; }
  }
  return tracks;
}
