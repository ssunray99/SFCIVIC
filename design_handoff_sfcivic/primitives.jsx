// SFCIVIC primitives — formatters + small UI atoms

const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDateLong = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const dayOfMonth = (iso) => new Date(`${iso}T12:00:00Z`).getDate();
const monthAbbr  = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
const weekdayAbbr = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

const daysFromToday = (iso) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(`${iso}T12:00:00Z`);
  return Math.round((d - today) / 86400000);
};

const relativeDay = (iso) => {
  const n = daysFromToday(iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return `In ${n} days`;
  if (n < -1 && n > -7) return `${-n} days ago`;
  return null;
};

// Stripe placeholder for any imagery
function Placeholder({ label, h = 120 }) {
  const stripes = `repeating-linear-gradient(135deg, var(--paper-2) 0 8px, transparent 8px 16px)`;
  return (
    <div className="flex items-center justify-center border text-[10px] font-mono uppercase tracking-[0.14em]"
      style={{ background: stripes, height: h, borderColor: 'var(--rule)', color: 'var(--ink-3)' }}>
      {label}
    </div>
  );
}

// Tiny UI atoms — eyebrow / rule / kicker / smallcaps
function Eyebrow({ children, className = '' }) {
  return <div className={`text-[10px] font-mono uppercase tracking-[0.18em] ${className}`} style={{ color: 'var(--ink-3)' }}>{children}</div>;
}

function SectionRule({ label, count, action }) {
  return (
    <div className="flex items-end justify-between gap-4 pb-2 mb-4 border-b" style={{ borderColor: 'var(--ink)' }}>
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif font-medium tracking-tight" style={{ fontSize: 28, lineHeight: 1, color: 'var(--ink)' }}>{label}</h2>
        {count != null && <span className="font-mono text-[11px]" style={{ color: 'var(--ink-3)' }}>№ {count}</span>}
      </div>
      {action}
    </div>
  );
}

// Topic tag — green-tinted pill
function TopicTag({ children, accent }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11.5px]"
      style={{
        background: 'oklch(0.92 0.07 150)',
        color: 'oklch(0.38 0.10 150)',
      }}>
      {children}
    </span>
  );
}

// District chip — yellow/amber-tinted pill
function DistrictChip({ n }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11.5px]"
      style={{
        background: 'oklch(0.94 0.07 85)',
        color: 'oklch(0.42 0.11 70)',
      }}>
      District {n}
    </span>
  );
}

// Neighborhood chip — blue-tinted pill
function NeighborhoodChip({ children }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11.5px]"
      style={{
        background: 'oklch(0.93 0.05 240)',
        color: 'oklch(0.40 0.10 240)',
      }}>
      {children}
    </span>
  );
}

// Outline pill (clickable chip)
function Pill({ children, active, onClick, accent }) {
  const styles = active
    ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' }
    : accent
      ? { color: 'var(--accent)', borderColor: 'var(--accent)', background: 'transparent' }
      : { color: 'var(--ink-2)', borderColor: 'var(--rule)', background: 'transparent' };
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center rounded-full border px-3 py-1 text-[12px] transition-colors hover:bg-[var(--paper-2)]"
      style={styles}>
      {children}
    </button>
  );
}

function SourceCode({ source }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--ink-3)' }}>
      <span className="px-1.5 py-0.5 border" style={{ borderColor: 'var(--rule)', color: 'var(--ink)' }}>{source.code}</span>
      <span>{source.name}</span>
    </span>
  );
}

// Date stamp — big serif day, mono mo + weekday
function DateStamp({ date, urgent }) {
  return (
    <div className="flex items-baseline gap-2 leading-none">
      <span className="font-serif font-medium tabular-nums" style={{ fontSize: 36, lineHeight: 1, color: urgent ? 'var(--accent)' : 'var(--ink)' }}>
        {dayOfMonth(date)}
      </span>
      <div className="flex flex-col gap-0.5 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: 'var(--ink-3)' }}>
        <span>{monthAbbr(date)}</span>
        <span>{weekdayAbbr(date)}</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  fmtDate, fmtDateLong, dayOfMonth, monthAbbr, weekdayAbbr, daysFromToday, relativeDay,
  Placeholder, Eyebrow, SectionRule, TopicTag, DistrictChip, NeighborhoodChip, Pill, SourceCode, DateStamp,
});
