// SFCIVIC — Home screen

function RotatingPlaceholder({ examples, active }) {
  // Renders the rotating placeholder text inside the Ask input as an absolutely
  // positioned overlay so it can be styled independently of the input element.
  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState('in'); // in | out
  React.useEffect(() => {
    if (!active) return undefined;
    let outTimer, advanceTimer;
    const tick = () => {
      setPhase('out');
      outTimer = setTimeout(() => {
        setIdx((i) => (i + 1) % examples.length);
        setPhase('in');
      }, 280);
    };
    advanceTimer = setInterval(tick, 3200);
    return () => { clearInterval(advanceTimer); clearTimeout(outTimer); };
  }, [active, examples.length]);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center px-4 overflow-hidden">
      <span
        className="font-serif italic"
        style={{
          fontSize: 19,
          color: 'var(--ink-3)',
          transform: phase === 'in' ? 'translateY(0)' : 'translateY(-8px)',
          opacity: phase === 'in' ? 1 : 0,
          transition: 'transform 280ms cubic-bezier(.2,.6,.2,1), opacity 280ms ease',
        }}>
        "{examples[idx]}"
      </span>
    </div>
  );
}

function HeroAsk({ onSubmit, onAsk, value, setValue }) {
  const examples = [
    "what's happening with housing in the Mission?",
    'budget items this month',
    'transit projects in District 6',
    'parks updates in the Sunset',
    'who voted against tenant protections last week?',
  ];
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 max-w-4xl">
        <h2
          className="font-serif tracking-tight"
          style={{ fontSize: 96, lineHeight: 0.95, color: 'var(--ink)', fontWeight: 500, letterSpacing: '-0.02em' }}>
          SF<span style={{ color: 'var(--accent)' }}>·</span><em style={{ fontStyle: 'italic', fontWeight: 500 }}>Civic</em>
        </h2>
        <p className="text-[15px] leading-relaxed whitespace-nowrap" style={{ color: 'var(--ink-2)' }}>
          Explore and search across the San Francisco civic process for topics and neighborhoods you care about.
        </p>
      </div>

      {/* Ask input */}
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}
        className="flex items-stretch border-2" style={{ borderColor: 'var(--ink)', background: 'var(--paper)' }}>
        <span className="flex items-center px-4 font-mono text-[10px] uppercase tracking-[0.16em] border-r" style={{ borderColor: 'var(--rule)', color: 'var(--ink-3)' }}>Ask</span>
        <div className="relative flex-1">
          <RotatingPlaceholder examples={examples} active={value.length === 0} />
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)}
            className="w-full px-4 py-4 bg-transparent outline-none font-serif relative"
            style={{ fontSize: 19, color: 'var(--ink)' }} />
        </div>
        <button type="submit" className="px-6 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--paper)' }}>
          Ask  →
        </button>
      </form>

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--ink-3)' }}>Try asking</span>
        {examples.slice(0, 3).map((s) => (
          <button key={s} type="button" onClick={() => onAsk(s)}
            className="font-serif italic text-left hover:underline underline-offset-3" style={{ fontSize: 14.5, color: 'var(--ink-2)' }}>
            "{s}"
          </button>
        ))}
      </div>
    </section>
  );
}

function ExploreSection({ onNavMeetings, onNav }) {
  const { TOPICS, FEATURED_NEIGHBORHOODS } = window.SFCIVIC_DATA;
  // Use the canonical TOPICS list — top 12 most-relevant for the home page
  const featuredTopics = TOPICS.slice(0, 12);
  return (
    <section className="grid gap-12" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="flex flex-col gap-3">
        <SectionRule label="By topic" />
        <div className="flex flex-wrap gap-1.5">
          {featuredTopics.map((t) => (
            <Pill key={t} onClick={() => onNavMeetings({ topic: t })}>{t}</Pill>
          ))}
          <Pill onClick={() => onNav('topics')} accent>+ all {TOPICS.length} →</Pill>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <SectionRule label="By neighborhood" />
        <div className="flex flex-wrap gap-1.5">
          {FEATURED_NEIGHBORHOODS.map((n) => (
            <Pill key={n} onClick={() => onNavMeetings({ neighborhood: n })}>{n}</Pill>
          ))}
          <Pill onClick={() => onNav('neighborhoods')} accent>+ all neighborhoods →</Pill>
        </div>
        <div className="flex flex-col gap-2 mt-3 p-4 border" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
          <Eyebrow>Find by address</Eyebrow>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Enter an SF address to see what's on the agenda for that neighborhood and district.
          </p>
          <form onSubmit={(e) => {
              e.preventDefault();
              const input = e.target.elements.addr;
              const v = (input.value || '').toLowerCase();
              // Stub geocoder: lookup a few common addresses, default to Potrero Hill / D10
              const lookup = [
                { match: 'mission', neighborhood: 'Mission', district: 9 },
                { match: 'soma', neighborhood: 'SoMa', district: 6 },
                { match: 'castro', neighborhood: 'Castro', district: 8 },
                { match: 'sunset', neighborhood: 'Inner Sunset', district: 5 },
                { match: 'bayview', neighborhood: 'Bayview', district: 10 },
                { match: 'tenderloin', neighborhood: 'Tenderloin', district: 6 },
                { match: 'chinatown', neighborhood: 'Chinatown', district: 3 },
              ];
              const hit = lookup.find((l) => v.includes(l.match)) || { neighborhood: 'Potrero Hill', district: 10 };
              onNavMeetings({ neighborhood: hit.neighborhood, district: hit.district, addressMode: true, view: 'upcoming' });
            }}
            className="flex items-stretch border" style={{ borderColor: 'var(--ink)', background: 'var(--paper)' }}>
            <input name="addr" type="text" placeholder="e.g. 1840 Mission Street"
              className="flex-1 px-3 py-2.5 bg-transparent outline-none text-[14px]" style={{ color: 'var(--ink)' }} />
            <button type="submit" className="px-4 font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ background: 'var(--ink)', color: 'var(--paper)' }}>Locate →</button>
          </form>
        </div>
      </div>
    </section>
  );
}

function BrowseTiles({ onNav }) {
  const { meetings } = window.SFCIVIC_DATA;
  const upcomingCount = meetings.filter((m) => !m.past).length;
  const pastCount = meetings.filter((m) => m.past).length;
  const tiles = [
    { n: upcomingCount, label: 'Upcoming meetings', sub: 'Hearings, ordinances, and votes coming up.', act: { view: 'upcoming' } },
    { n: pastCount, label: 'Past meetings', sub: 'Agendas and outcomes from prior sessions.', act: { view: 'past' } },
  ];
  return (
    <section className="flex flex-col gap-4">
      <SectionRule label="Browse meetings" />
      <div className="grid gap-px" style={{ gridTemplateColumns: '1fr 1fr', background: 'var(--rule)', border: '1px solid var(--rule)' }}>
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={() => onNav(t.act)}
            className="flex flex-col gap-2 p-6 text-left transition-colors hover:bg-[var(--paper-2)]"
            style={{ background: 'var(--paper)' }}>
            <span className="font-serif tabular-nums" style={{ fontSize: 56, lineHeight: 1, color: 'var(--ink)', fontWeight: 500 }}>
              {t.n}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--ink)' }}>{t.label}</span>
            <span className="text-[12px]" style={{ color: 'var(--ink-2)' }}>{t.sub}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] mt-2" style={{ color: 'var(--accent)' }}>View all →</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function HomeScreen({ onAsk, onNav }) {
  const [askValue, setAskValue] = React.useState('');
  return (
    <main data-screen-label="01 Home" className="px-10 py-12 flex flex-col gap-16">
      <HeroAsk value={askValue} setValue={setAskValue} onSubmit={(q) => onAsk(q)} onAsk={(q) => onAsk(q)} />
      <ExploreSection onNavMeetings={(filters) => onNav('meetings', filters)} onNav={(r) => onNav(r)} />
      <BrowseTiles onNav={(filters) => onNav('meetings', filters)} />
    </main>
  );
}

Object.assign(window, { HomeScreen });
