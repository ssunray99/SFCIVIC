// Editorial home page. Three sections separated by gap-16:
//   1. Hero — wordmark + tagline + Ask form (client island)
//   2. Explore — By topic / By neighborhood with address search card
//   3. Browse meetings — Upcoming / Past tiles with live counts

import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { HeroAsk } from '@/components/HeroAsk';
import { AddressSearch } from '@/components/AddressSearch';
import { Eyebrow, Pill, SectionRule } from '@/components/primitives';
import { NEIGHBORHOODS, TOPICS } from '@/lib/constants';

export const revalidate = 300;

const FEATURED_TOPICS = [
  'housing',
  'zoning',
  'transit',
  'public-safety',
  'homelessness',
  'parks',
  'budget',
  'climate',
] as const;

const FEATURED_NEIGHBORHOODS = [
  'Mission',
  'SoMa',
  'Tenderloin',
  'Castro',
  'Bayview',
  'Chinatown',
  'Inner Sunset',
  'Outer Sunset',
] as const;

const humanize = (s: string) =>
  s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function getMeetingCounts(): Promise<{ upcoming: number; past: number }> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const [up, pst] = await Promise.all([
    supabase.from('meetings').select('id', { count: 'exact', head: true }).gte('meeting_date', today),
    supabase.from('meetings').select('id', { count: 'exact', head: true }).lt('meeting_date', today),
  ]);
  return { upcoming: up.count ?? 0, past: pst.count ?? 0 };
}

export default async function Home() {
  const counts = await getMeetingCounts();

  return (
    <main className="px-10 py-10 flex flex-col gap-16">
      <HeroAsk />

      {/* Explore — By neighborhood (+ address card) / By topic */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div className="flex flex-col gap-5">
          <div>
            <SectionRule label="Explore by neighborhood" />
            <div className="flex flex-wrap gap-2">
              {FEATURED_NEIGHBORHOODS.map((n) => (
                <Pill key={n} href={`/meetings?neighborhood=${encodeURIComponent(n)}&view=all`}>
                  {n}
                </Pill>
              ))}
              <Pill accent href="/neighborhoods">
                + all {NEIGHBORHOODS.length} →
              </Pill>
            </div>
          </div>

          <div className="bg-[var(--paper-2)] border border-[var(--rule)] rounded-[6px] p-5 flex flex-col gap-2.5">
            <Eyebrow>Find by address</Eyebrow>
            <p className="text-[14.5px] text-[var(--ink-2)] leading-relaxed">
              Enter an SF address to see what&rsquo;s on the agenda for that
              neighborhood and district.
            </p>
            <AddressSearch />
          </div>
        </div>

        <div>
          <SectionRule label="Explore by topic" />
          <div className="flex flex-wrap gap-2">
            {FEATURED_TOPICS.map((t) => (
              <Pill key={t} href={`/meetings?topic=${t}&view=all`}>
                {humanize(t)}
              </Pill>
            ))}
            <Pill accent href="/topics">
              + all {TOPICS.length} →
            </Pill>
          </div>
        </div>
      </section>

      {/* Browse meetings — hairline-divided 2-up tiles */}
      <section className="flex flex-col gap-4">
        <SectionRule label="Browse meetings" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[var(--rule)] border border-[var(--rule)] rounded-[8px] overflow-hidden">
          <BrowseTile
            count={counts.upcoming}
            label="Upcoming meetings"
            subtitle="Hearings, ordinances, and votes coming up."
            href="/meetings"
          />
          <BrowseTile
            count={counts.past}
            label="Past meetings"
            subtitle="Agendas and outcomes from prior sessions."
            href="/meetings?view=past"
          />
        </div>
      </section>
    </main>
  );
}

function BrowseTile({
  count,
  label,
  subtitle,
  href,
}: {
  count: number;
  label: string;
  subtitle: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-[var(--paper)] hover:bg-[var(--paper-2)] p-8 flex flex-col gap-3 text-left transition-colors"
    >
      <div
        className="font-serif tabular-nums text-[var(--ink)]"
        style={{ fontSize: 72, lineHeight: 1, fontWeight: 500 }}
      >
        {count}
      </div>
      <Eyebrow>{label}</Eyebrow>
      <p className="text-[15.5px] text-[var(--ink-2)] leading-relaxed">{subtitle}</p>
      <span className="mt-auto font-mono uppercase text-[12px] tracking-[0.16em] text-[var(--accent)]">View all →</span>
    </Link>
  );
}
