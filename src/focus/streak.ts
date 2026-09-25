const dayMs = 86_400_000;

function localDayIndex(timestamp: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(timestamp);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / dayMs);
}

export function calculateStreak(completedAt: number[], now: number, timezone: string): { current: number; best: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const days = [...new Set(completedAt.map((timestamp) => localDayIndex(timestamp, formatter)))].sort((a, b) => b - a);
  if (days.length === 0) return { current: 0, best: 0 };

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i - 1]! - days[i]! === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const today = localDayIndex(now, formatter);
  if (days[0] !== today && days[0] !== today - 1) return { current: 0, best };
  let current = 1;
  while (current < days.length && days[current - 1]! - days[current]! === 1) current++;
  return { current, best };
}
