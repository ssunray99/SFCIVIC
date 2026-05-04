// SFCIVIC — Topics & Neighborhoods index pages (grid of tiles)

function GridTile({ label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="px-5 py-4 text-left transition-colors hover:bg-[var(--paper-2)] border"
      style={{
        borderColor: 'var(--rule)',
        background: 'var(--paper)',
        borderRadius: 8,
      }}>
      <span className="text-[15.5px]" style={{ color: 'var(--ink)' }}>{label}</span>
    </button>
  );
}

function TileGrid({ items, onSelect }) {
  const cols = 3;
  const fullRows = Math.floor(items.length / cols) * cols;
  const head = items.slice(0, fullRows);
  const tail = items.slice(fullRows);
  return (
    <div className="flex flex-col gap-3">
      {head.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {head.map((label) => (
            <GridTile key={label} label={label} onClick={() => onSelect(label)} />
          ))}
        </div>
      )}
      {tail.length > 0 && (
        <div className="grid gap-3 mx-auto" style={{
          gridTemplateColumns: `repeat(${tail.length}, minmax(0, 1fr))`,
          width: `calc(${(tail.length / cols) * 100}% - ${((cols - tail.length) * 12) / cols}px)`,
        }}>
          {tail.map((label) => (
            <GridTile key={label} label={label} onClick={() => onSelect(label)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TopicsScreen({ onBack, onNav }) {
  const { TOPICS } = window.SFCIVIC_DATA;
  const list = [...TOPICS].sort((a, b) => a.localeCompare(b));

  return (
    <main data-screen-label="04 Topics" className="px-10 py-12 flex flex-col gap-8 max-w-4xl">
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.16em] w-fit" style={{ color: 'var(--ink-3)' }}>← Home</button>
        <h2 className="font-serif tracking-tight leading-none" style={{ fontSize: 44, color: 'var(--ink)', fontWeight: 600 }}>
          Browse by Topic
        </h2>
        <p className="text-[15px] max-w-xl" style={{ color: 'var(--ink-2)' }}>
          Find SF civic meetings with agenda items on the issues you care about.
        </p>
      </div>

      <TileGrid items={list} onSelect={(t) => onNav('meetings', { topic: t, view: 'upcoming' })} />
    </main>
  );
}

function NeighborhoodsScreen({ onBack, onNav }) {
  // Curated list — kept order close to how SF locals talk about them, not strictly alphabetical
  const list = [
    'Mission', 'Castro', 'SoMa',
    'Financial District', 'Western Addition', 'Haight Ashbury',
    'Noe Valley', 'North Beach', 'Chinatown',
    'Pacific Heights', 'Bayview', 'Marina',
    'Nob Hill', 'Tenderloin', 'Twin Peaks',
    'Inner Sunset', 'Outer Sunset', 'Glen Park',
    'Potrero Hill', 'Visitacion Valley', 'Portola',
    'Excelsior', 'Inner Richmond', 'Mission Bay',
    'Treasure Island', 'Outer Richmond', 'Presidio',
    'West Portal', 'Hayes Valley', 'Bernal Heights',
  ];

  return (
    <main data-screen-label="05 Neighborhoods" className="px-10 py-12 flex flex-col gap-8 max-w-4xl">
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.16em] w-fit" style={{ color: 'var(--ink-3)' }}>← Home</button>
        <h2 className="font-serif tracking-tight leading-none" style={{ fontSize: 44, color: 'var(--ink)', fontWeight: 600 }}>
          Browse by Neighborhood
        </h2>
        <p className="text-[15px] max-w-xl" style={{ color: 'var(--ink-2)' }}>
          Find SF civic meetings with agenda items affecting your neighborhood.
        </p>
      </div>

      <TileGrid items={list} onSelect={(n) => onNav('meetings', { neighborhood: n, view: 'upcoming' })} />
    </main>
  );
}

Object.assign(window, { TopicsScreen, NeighborhoodsScreen });
