// Date formatting helpers shared by MeetingCard, ItemSubCard, ActionCallout,
// Ask page citations, etc. All accept ISO yyyy-mm-dd strings and parse at noon
// UTC so timezone offsets don't slip the rendered weekday by a day.

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function fmtDate(iso: string): string {
  return at(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fmtDateLong(iso: string): string {
  return at(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function daysFromToday(iso: string): number {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const target = at(iso);
  const ms = target.getTime() - today.getTime();
  return Math.round(ms / 86_400_000);
}

export function relativeDay(iso: string): 'TODAY' | 'TOMORROW' | null {
  const d = daysFromToday(iso);
  if (d === 0) return 'TODAY';
  if (d === 1) return 'TOMORROW';
  return null;
}
