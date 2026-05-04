// SFCIVIC — Ask results screen + Meetings feed screen

function AskScreen({ query, onBack, onAsk }) {
  const [value, setValue] = React.useState(query || '');
  React.useEffect(() => { setValue(query || ''); }, [query]);
  const { meetings } = window.SFCIVIC_DATA;
  const items = meetings.flatMap((m) => m.items.map((it) => ({ ...it, meeting: m }))).slice(0, 5);
  const hasQuery = (query || '').trim().length > 0;

  const examples = [
    "what's happening with housing in the Mission?",
    'budget items this month',
    'transit projects in District 6',
    'parks updates in the Sunset',
  ];

  return (
    <main data-screen-label="02 Ask" className="px-10 py-10 flex flex-col gap-8 max-w-4xl">
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.16em] w-fit" style={{ color: 'var(--ink-3)' }}>← Home</button>
        <Eyebrow>Conversational search</Eyebrow>
        <h2 className="font-serif tracking-tight" style={{ fontSize: 38, color: 'var(--ink)', fontWeight: 500, lineHeight: 1.1 }}>
          {hasQuery ? query : 'Ask'}
        </h2>
        {!hasQuery && (
          <p className="text-[15px] leading-relaxed max-w-2xl" style={{ color: 'var(--ink-2)' }}>
            Ask about anything happening across the SF civic process — by topic, neighborhood, district, or source.
          </p>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onAsk(value); }}
        className="flex items-stretch border-2" style={{ borderColor: 'var(--ink)', background: 'var(--paper)' }}>
        <span className="flex items-center px-4 font-mono text-[10px] uppercase tracking-[0.16em] border-r" style={{ borderColor: 'var(--rule)', color: 'var(--ink-3)' }}>Ask</span>
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="What is the city working on near me?"
          className="flex-1 px-4 py-3 bg-transparent outline-none font-serif" style={{ fontSize: 17, color: 'var(--ink)' }} />
        <button type="submit" className="px-5 font-mono text-[11px] uppercase tracking-[0.16em]"
          style={{ background: 'var(--accent)', color: 'var(--paper)' }}>Ask →</button>
      </form>

      {!hasQuery && (
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-3)' }}>Try asking</span>
          <ul className="flex flex-col gap-2">
            {examples.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => onAsk(s)}
                  className="font-serif italic text-left hover:underline underline-offset-3"
                  style={{ fontSize: 17, color: 'var(--ink-2)' }}>
                  "{s}"
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasQuery && (
        <React.Fragment>
          {/* Answer card with citations */}
          <section className="border-l-2 pl-6 py-2" style={{ borderColor: 'var(--accent)' }}>
            <Eyebrow className="mb-2">Answer</Eyebrow>
            <p className="font-serif leading-relaxed" style={{ fontSize: 19, color: 'var(--ink)', textWrap: 'pretty' }}>
              The Land Use & Transportation Committee is reviewing an inclusionary housing fee
              adjustment for projects above 25 units <Cite n={1} />, while the Planning Commission
              will hear a 89-unit development at 1840 Mission Street with 12 below-market-rate
              units <Cite n={2} />. The Full Board takes a second reading on tenant protection
              amendments next week <Cite n={3} />, and the SFMTA Board considers a Geary transit
              lane extension to 28th Avenue <Cite n={4} />.
            </p>
          </section>

          <section className="flex flex-col gap-1">
            <SectionRule label="Matching items" count={items.length} />
            <ol className="flex flex-col gap-3 mt-2">
              {items.map((it, idx) => (
                <li key={it.id} id={`item-${idx + 1}`} className="grid gap-x-4 p-4 border" style={{ gridTemplateColumns: '32px 1fr', borderColor: 'var(--rule)', background: 'var(--paper)', borderRadius: 8 }}>
                  <div className="font-mono tabular-nums text-[12px] pt-0.5" style={{ color: 'var(--ink-3)' }}>[{idx + 1}]</div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3">
                      <SourcePill source={sourceById(it.meeting.source_id)} />
                      <span className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>{fmtDate(it.meeting.meeting_date)}</span>
                    </div>
                    <h3 className="font-serif font-medium leading-snug" style={{ fontSize: 17, color: 'var(--ink)' }}>{it.title}</h3>
                    {it.summary && <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-2)', textWrap: 'pretty' }}>{it.summary}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {it.district != null && <DistrictChip n={it.district} />}
                      {it.neighborhoods.map((n) => <NeighborhoodChip key={n}>{n}</NeighborhoodChip>)}
                      {it.topics.map((t) => <TopicTag key={t}>{t}</TopicTag>)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </React.Fragment>
      )}
    </main>
  );
}

function Cite({ n }) {
  return <a href={`#item-${n}`} className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>[{n}]</a>;
}

function ViewToggle({ view, onChange }) {
  const tabs = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']];
  return (
    <div className="flex gap-2">
      {tabs.map(([k, label]) => {
        const active = view === k;
        return (
          <button key={k} type="button" onClick={() => onChange(k)}
            className="px-4 py-1.5 text-[13.5px] font-medium border transition-colors"
            style={{
              background: active ? 'var(--ink)' : 'var(--paper)',
              color: active ? 'var(--paper)' : 'var(--ink-2)',
              borderColor: active ? 'var(--ink)' : 'var(--rule)',
              borderRadius: 6,
            }}>{label}</button>
        );
      })}
    </div>
  );
}

function FilterBar({ filters, onChange }) {
  const { TOPICS, SOURCES } = window.SFCIVIC_DATA;
  const set = (k, v) => onChange({ ...filters, [k]: v || undefined });
  const ALL_NEIGHBORHOODS = [
    'Bayview','Bernal Heights','Castro','Chinatown','Cole Valley','Dogpatch','Excelsior',
    'Financial District','Fillmore','Glen Park','Haight Ashbury','Hayes Valley','Inner Sunset',
    'Japantown','Marina','Mission','Mission Bay','Nob Hill','Noe Valley','North Beach',
    'Outer Sunset','Pacific Heights','Portola','Potrero Hill','Presidio','Richmond',
    'Russian Hill','SoMa','Tenderloin','Treasure Island','Twin Peaks','Visitacion Valley',
    'West Portal','Western Addition',
  ];

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <input type="text" value={filters.q || ''} onChange={(e) => set('q', e.target.value)}
        placeholder="Search agenda items…"
        className="px-3.5 py-2 border outline-none text-[13.5px] flex-1 min-w-[220px] max-w-[320px]"
        style={{ borderColor: 'var(--rule)', background: 'var(--paper)', color: 'var(--ink)', borderRadius: 6 }} />
      <select value={filters.neighborhood || ''} onChange={(e) => set('neighborhood', e.target.value)} className="filter-sel">
        <option value="">All neighborhoods</option>
        {ALL_NEIGHBORHOODS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={filters.district || ''} onChange={(e) => set('district', e.target.value ? Number(e.target.value) : undefined)} className="filter-sel">
        <option value="">All districts</option>
        {[1,2,3,4,5,6,7,8,9,10,11].map((d) => <option key={d} value={d}>District {d}</option>)}
      </select>
      <select value={filters.topic || ''} onChange={(e) => set('topic', e.target.value)} className="filter-sel">
        <option value="">All topics</option>
        {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={filters.source || ''} onChange={(e) => set('source', e.target.value)} className="filter-sel">
        <option value="">All sources</option>
        {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

function MeetingsScreen({ initialFilters, density, cardStyle, onBack }) {
  const [filters, setFilters] = React.useState({ view: 'upcoming', includeCitywide: false, ...initialFilters });
  const { meetings } = window.SFCIVIC_DATA;
  const isAddressMode = !!(filters.addressMode && (filters.neighborhood || filters.district != null));

  const matchesGeo = (item) => {
    const nMatch = filters.neighborhood ? item.neighborhoods.includes(filters.neighborhood) : true;
    const dMatch = filters.district != null ? item.district === filters.district : true;
    if (filters.neighborhood && filters.district != null) return nMatch || dMatch;
    return nMatch && dMatch;
  };
  const isCitywide = (item) => item.neighborhoods.length === 0 && item.district == null;

  const filtered = meetings.filter((m) => {
    if (filters.view === 'upcoming' && m.past) return false;
    if (filters.view === 'past' && !m.past) return false;
    if (filters.source && m.source_id !== filters.source) return false;
    const hasGeoFilter = filters.neighborhood || filters.district != null;
    if (hasGeoFilter) {
      const ok = m.items.some((i) => matchesGeo(i) || (filters.includeCitywide && isCitywide(i)));
      if (!ok) return false;
    }
    if (filters.topic && !m.items.some((i) => i.topics.includes(filters.topic))) return false;
    if (filters.q) {
      const needle = filters.q.toLowerCase();
      const hay = (m.title + ' ' + m.items.map((i) => (i.title || '') + ' ' + (i.summary || '')).join(' ')).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const activeChips = [];
  if (filters.neighborhood) activeChips.push({ label: filters.neighborhood, key: 'neighborhood' });
  if (filters.district != null) activeChips.push({ label: `District ${filters.district}`, key: 'district' });
  if (filters.topic) activeChips.push({ label: filters.topic, key: 'topic' });
  if (filters.source) activeChips.push({ label: filters.source, key: 'source' });
  if (filters.q) activeChips.push({ label: `"${filters.q}"`, key: 'q' });

  return (
    <main data-screen-label="03 Meetings" className="px-10 py-10 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <button type="button" onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.16em] w-fit mb-2" style={{ color: 'var(--ink-3)' }}>← Home</button>
        <h2 className="font-serif tracking-tight leading-none" style={{ fontSize: 48, color: 'var(--ink)', fontWeight: 500 }}>Meetings</h2>
        <p className="text-[14.5px]" style={{ color: 'var(--ink-2)' }}>
          Browse San Francisco civic meetings by date, source, neighborhood, district, or topic.
        </p>
        <div className="mt-2">
          <ViewToggle view={filters.view} onChange={(v) => setFilters({ ...filters, view: v })} />
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 -mt-3">
          {activeChips.map((c) => (
            <button key={c.key} type="button"
              onClick={() => setFilters({ ...filters, [c.key]: undefined })}
              className="text-[12px] px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 transition-colors"
              style={{ background: '#DCEBFB', color: '#1F4E79' }}>
              <span>{c.label}</span>
              <span style={{ opacity: 0.6 }}>×</span>
            </button>
          ))}
          <button type="button"
            onClick={() => setFilters({ view: filters.view, includeCitywide: false })}
            className="text-[12px] px-2 py-1 underline-offset-2 hover:underline"
            style={{ color: 'var(--ink-3)' }}>
            Clear all
          </button>
        </div>
      )}

      {isAddressMode && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          <span className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>Show:</span>
          <button type="button"
            onClick={() => setFilters({ ...filters, includeCitywide: false })}
            className="text-[12.5px] px-3 py-1.5 rounded-full transition-colors"
            style={!filters.includeCitywide
              ? { background: 'var(--ink)', color: 'var(--paper)' }
              : { border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)' }}>
            {[filters.neighborhood, filters.district != null ? `District ${filters.district}` : null].filter(Boolean).join(' / ')} only
          </button>
          <button type="button"
            onClick={() => setFilters({ ...filters, includeCitywide: true })}
            className="text-[12.5px] px-3 py-1.5 rounded-full transition-colors"
            style={filters.includeCitywide
              ? { background: 'var(--ink)', color: 'var(--paper)' }
              : { border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)' }}>
            Also include citywide
          </button>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif tracking-tight" style={{ fontSize: 26, color: 'var(--ink)', fontWeight: 500 }}>
            {filters.view === 'past' ? 'Past' : filters.view === 'all' ? 'All meetings' : 'Upcoming'}
          </h3>
          <span className="text-[13px]" style={{ color: 'var(--accent)' }}>{filtered.length}</span>
        </div>
        {filtered.length === 0 ? (
          <p className="text-[14px] py-6 px-4 border border-dashed" style={{ borderColor: 'var(--rule)', color: 'var(--ink-3)' }}>
            No meetings match the current filters.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {filtered.map((m) => <MeetingCard key={m.id} meeting={m} density={density} cardStyle={cardStyle} />)}
          </div>
        )}
      </section>
    </main>
  );
}

Object.assign(window, { AskScreen, MeetingsScreen });
