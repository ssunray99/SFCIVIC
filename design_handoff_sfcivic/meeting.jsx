// SFCIVIC — Item card + Meeting card

const sourceById = (id) => window.SFCIVIC_DATA.SOURCES.find((s) => s.id === id);

function ActionCallout({ item, meeting }) {
  const today = new Date().toISOString().slice(0, 10);
  const deadlineFuture = item.comment_deadline && item.comment_deadline >= today;
  const upcoming = meeting.meeting_date >= today;
  const hasAction = item.comment_deadline || item.comment_email || item.comment_portal_url || item.in_person_slot || upcoming;
  if (!hasAction) return null;

  // Format the meeting date and time/location like "Monday, May 4, 2026, 10:00 AM, City Hall, Legislative Chamber, Room 250"
  const dateStr = new Date(meeting.meeting_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const lineParts = [dateStr];
  if (meeting.time) lineParts.push(meeting.time);
  if (meeting.location) lineParts.push(meeting.location);

  return (
    <div className="mt-3 px-3.5 py-2.5 border" style={{
      borderColor: 'oklch(0.84 0.10 90)',
      background: 'oklch(0.97 0.05 95)',
      borderRadius: 6,
    }}>
      <div className="font-medium text-[13px]" style={{ color: 'oklch(0.46 0.13 65)' }}>
        {item.comment_deadline && item.comment_deadline >= today ? `Take action by ${fmtDate(item.comment_deadline)}` : 'Take action'}
      </div>
      <div className="text-[13px] leading-relaxed mt-0.5" style={{ color: 'oklch(0.46 0.13 65)' }}>
        {lineParts.join(', ')}
      </div>
      {(item.comment_email || item.comment_portal_url) && (
        <div className="flex flex-wrap gap-x-4 text-[12px] mt-1" style={{ color: 'oklch(0.46 0.13 65)' }}>
          {item.comment_email && <a href={`mailto:${item.comment_email}`} className="underline underline-offset-2">Email comment</a>}
          {item.comment_portal_url && <a href="#" onClick={(e) => e.preventDefault()} className="underline underline-offset-2">Comment portal →</a>}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }) {
  if (!type) return null;
  return (
    <span className="shrink-0 inline-flex items-center px-3 py-1 text-[12px] border rounded-full"
      style={{ borderColor: 'var(--rule)', background: 'var(--paper)', color: 'var(--ink-2)' }}>
      {type}
    </span>
  );
}

function ItemSubCard({ item, idx, meeting, density, showAction }) {
  const tight = density === 'compact';
  return (
    <article className="border p-4 flex flex-col gap-2" style={{ borderColor: 'var(--rule)', background: 'var(--paper)', borderRadius: 6 }}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span className="font-mono tabular-nums text-[13px] shrink-0" style={{ color: 'var(--ink-3)' }}>
            #{idx + 1}
          </span>
          <h3 className="font-serif font-medium leading-snug" style={{ fontSize: tight ? 16 : 17, color: 'var(--ink)' }}>
            {item.title}
          </h3>
        </div>
        <TypeBadge type={item.item_type} />
      </header>
      {item.summary && !tight && (
        <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-2)', textWrap: 'pretty' }}>{item.summary}</p>
      )}
      {(item.district != null || item.neighborhoods.length > 0 || item.topics.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {item.district != null && <DistrictChip n={item.district} />}
          {item.neighborhoods.map((n) => <NeighborhoodChip key={n}>{n}</NeighborhoodChip>)}
          {item.neighborhoods.length === 0 && item.district == null && (
            <span className="text-[11.5px] px-2.5 py-0.5 border rounded-full"
              style={{ borderColor: 'var(--rule)', background: 'var(--paper)', color: 'var(--ink-2)' }}>Citywide</span>
          )}
          {item.topics.map((t) => <TopicTag key={t}>{t}</TopicTag>)}
        </div>
      )}
      {showAction && <ActionCallout item={item} meeting={meeting} />}
      {item.matter_file_number && (
        <a href="#" onClick={(e) => e.preventDefault()}
          className="inline-flex items-center gap-1.5 text-[11px] w-fit mt-1" style={{ color: 'var(--ink-3)' }}>
          <span className="font-mono">FILE № {item.matter_file_number}</span>
          <span className="underline underline-offset-2">track legislation →</span>
        </a>
      )}
    </article>
  );
}

function SourcePill({ source }) {
  if (!source) return null;
  return (
    <span className="inline-flex items-center px-3 py-1 text-[12px] font-medium rounded-full"
      style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
      {source.name}
    </span>
  );
}

function MeetingCard({ meeting, density, cardStyle }) {
  const source = sourceById(meeting.source_id);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = meeting.meeting_date >= today;
  const items = meeting.items || [];

  // Show "Take action" callout only on a flagged item per meeting (the first item with action info, or the first item if upcoming).
  const actionIdx = (() => {
    const withDeadline = items.findIndex((i) => i.comment_deadline || i.comment_email || i.comment_portal_url || i.in_person_slot);
    if (withDeadline >= 0) return withDeadline;
    return upcoming && items.length > 1 ? 1 : -1;
  })();

  const dateStr = new Date(meeting.meeting_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  const styleByCard = {
    rules:    { background: 'var(--paper)',   border: '1px solid var(--rule)' },
    filled:   { background: 'var(--paper-2)', border: '1px solid var(--rule)' },
    floating: { background: 'var(--paper)',   border: '1px solid var(--rule)', boxShadow: '0 1px 0 var(--rule), 0 10px 28px -18px rgba(60,30,10,0.18)' },
  };

  return (
    <section className="meeting-card flex flex-col" style={{ ...styleByCard[cardStyle] || styleByCard.rules, borderRadius: 8 }}>
      {/* Card title — editorial style */}
      <header className="px-5 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <SourcePill source={source} />
          <span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>{dateStr}</span>
          {upcoming && daysFromToday(meeting.meeting_date) <= 3 && (
            <span className="font-mono uppercase tracking-[0.14em] text-[10px]" style={{ color: 'var(--accent)' }}>
              {relativeDay(meeting.meeting_date)}
            </span>
          )}
        </div>
        <h3 className="font-serif font-medium leading-tight" style={{ fontSize: 21, color: 'var(--ink)' }}>
          {meeting.title}
        </h3>
        <a href="#" onClick={(e) => e.preventDefault()}
          className="inline-flex items-center gap-1 text-[13px] w-fit hover:underline underline-offset-2"
          style={{ color: 'var(--accent)' }}>
          Original agenda ↗
        </a>
      </header>
      <div className="px-5 pb-5 flex flex-col gap-3">
        {items.map((it, idx) => (
          <ItemSubCard key={it.id} item={it} idx={idx} meeting={meeting} density={density} showAction={idx === actionIdx} />
        ))}
      </div>
    </section>
  );
}

Object.assign(window, { MeetingCard, ItemSubCard, ActionCallout, sourceById });
