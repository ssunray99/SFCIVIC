// SFCIVIC — Masthead + screen scaffolding

function Masthead({ route, onNav }) {
  const links = [
    { id: 'home',     label: 'Home' },
    { id: 'ask',      label: 'Ask' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'topics',   label: 'Topics' },
    { id: 'neighborhoods', label: 'Neighborhoods' },
  ];
  return (
    <header className="border-b" style={{ borderColor: 'var(--ink)' }}>
      {/* top thin rule */}
      <div className="h-1" style={{ background: 'var(--ink)' }}></div>
      <div className="px-10 pt-5 pb-4 flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => onNav('home')} className="text-left">
            <h1 className="font-serif tracking-tight leading-none" style={{ fontSize: 38, color: 'var(--ink)', fontWeight: 500 }}>
              SF<span style={{ color: 'var(--accent)' }}>·</span>Civic
            </h1>
          </button>
        </div>
        <nav className="flex items-end gap-5 pb-1">
          {links.map((l) => (
            <button key={l.id} type="button" onClick={() => onNav(l.id)}
              className="font-mono text-[11px] uppercase tracking-[0.16em] pb-0.5 border-b-2 transition-colors"
              style={{
                color: route === l.id ? 'var(--ink)' : 'var(--ink-3)',
                borderColor: route === l.id ? 'var(--accent)' : 'transparent',
              }}>
              {l.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="h-px" style={{ background: 'var(--rule)' }}></div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 px-10 pt-6 pb-10 border-t" style={{ borderColor: 'var(--rule)' }}>
      <div className="flex flex-col gap-2 max-w-3xl">
        <Eyebrow>Colophon</Eyebrow>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Unofficial. Summaries are AI-generated and may be incomplete or wrong. For canonical agendas
          consult <a href="#" onClick={(e) => e.preventDefault()} className="underline underline-offset-2">sfplanning.org</a> and{' '}
          <a href="#" onClick={(e) => e.preventDefault()} className="underline underline-offset-2">sfbos.org</a>.
        </p>
      </div>
    </footer>
  );
}

Object.assign(window, { Masthead, Footer });
