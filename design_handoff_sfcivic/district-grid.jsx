// SFCIVIC — District grid (stylized 11-cell map of supervisor districts)
// Not a real geographic map — a typographic grid that echoes the city shape.

// Approximate relative placement of D1-D11 on a 5×4 grid (col, row, span)
// (col, row are 1-indexed; this is a stylized layout, not geographic truth)
const GRID_LAYOUT = {
  1:  { col: 1, row: 1, w: 1, h: 1 },  // Richmond — NW
  2:  { col: 2, row: 1, w: 1, h: 1 },  // Marina/Pac Heights
  3:  { col: 3, row: 1, w: 1, h: 1 },  // North Beach/Chinatown
  6:  { col: 4, row: 1, w: 1, h: 1 },  // SoMa/Tenderloin
  4:  { col: 1, row: 2, w: 1, h: 1 },  // Sunset
  5:  { col: 2, row: 2, w: 2, h: 1 },  // Haight/Western Addition
  9:  { col: 4, row: 2, w: 1, h: 1 },  // Mission/Bernal
  7:  { col: 1, row: 3, w: 2, h: 1 },  // West Portal/Lake Merced
  8:  { col: 3, row: 3, w: 1, h: 1 },  // Castro/Noe
  10: { col: 4, row: 3, w: 1, h: 1 },  // Bayview/Potrero
  11: { col: 2, row: 4, w: 2, h: 1 },  // Excelsior
};

function DistrictCell({ d, active, onClick }) {
  const { col, row, w, h } = GRID_LAYOUT[d.n];
  // Heat scale based on item count
  const intensity = Math.min(d.count / 18, 1);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col justify-between p-2.5 text-left transition-colors"
      style={{
        gridColumn: `${col} / span ${w}`,
        gridRow: `${row} / span ${h}`,
        background: active ? 'var(--ink)' : `color-mix(in oklch, var(--accent-soft) ${intensity * 100}%, var(--paper))`,
        color: active ? 'var(--paper)' : 'var(--ink)',
        border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
        minHeight: 64,
      }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-serif font-medium tabular-nums leading-none" style={{ fontSize: 22 }}>
          {d.n}
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ opacity: 0.7 }}>
          {d.count}
        </span>
      </div>
      <span className="text-[10px] leading-tight mt-1" style={{ opacity: 0.75 }}>
        {d.name}
      </span>
    </button>
  );
}

function DistrictGrid({ activeDistrict, onSelect }) {
  const { DISTRICTS } = window.SFCIVIC_DATA;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Supervisor districts · items in next 30 days</Eyebrow>
        <a href="#" onClick={(e) => e.preventDefault()} className="text-[11px] underline underline-offset-2" style={{ color: 'var(--ink-3)' }}>
          Find by address →
        </a>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(4, 1fr)' }}>
        {DISTRICTS.map((d) => (
          <DistrictCell key={d.n} d={d}
            active={activeDistrict === d.n}
            onClick={() => onSelect && onSelect(d.n)} />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DistrictGrid });
