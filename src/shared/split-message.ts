export function splitMessage(text: string, limit = 1900): string[] {
  const parts: string[] = [];
  let remaining = text.trim();

  while (remaining.length > limit) {
    const segment = remaining.slice(0, limit + 1);
    const candidates = [segment.lastIndexOf('\n\n'), segment.lastIndexOf('\n'), segment.lastIndexOf('. '), segment.lastIndexOf(' ')];
    let cut = candidates.find((position) => position >= Math.floor(limit / 2)) ?? limit;
    if (remaining.charCodeAt(cut - 1) >= 0xd800 && remaining.charCodeAt(cut - 1) <= 0xdbff) cut--;
    parts.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) parts.push(remaining);
  return parts;
}
