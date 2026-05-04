// Single agenda item rendered inside a MeetingCard.
// Header: index + serif title + TypeBadge.
// Chips: District / Neighborhood / Topic (or Citywide fallback).
// Optional ActionCallout (driven by parent — only one per meeting).
// Footer: matter file # + track-legislation link when present.

import { ActionCallout } from './ActionCallout';
import {
  CitywideChip,
  DistrictChip,
  NeighborhoodChip,
  TopicTag,
  TypeBadge,
} from './primitives';

export type ItemSubCardData = {
  id: string;
  position: number | null;
  title: string;
  summary: string | null;
  item_type: string | null;
  district: number | null;
  neighborhoods: string[];
  topics: string[];
  comment_deadline: string | null;
  comment_email: string | null;
  comment_portal_url: string | null;
  in_person_slot: string | null;
  matter_file_number?: string | null;
};

export function ItemSubCard({
  item,
  showAction,
  meetingDate,
  meetingTime,
  meetingLocation,
}: {
  item: ItemSubCardData;
  showAction: boolean;
  meetingDate: string;
  meetingTime?: string | null;
  meetingLocation?: string | null;
}) {
  const isCitywide = item.district == null && item.neighborhoods.length === 0;

  return (
    <article
      className="rounded-[6px] border border-[var(--rule)] bg-[var(--paper)] p-4 flex flex-col gap-2"
      id={item.matter_file_number ? `file-${item.matter_file_number}` : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          {item.position != null && (
            <span className="font-mono text-[13px] tabular-nums text-[var(--ink-3)] shrink-0">
              #{item.position}
            </span>
          )}
          <h3
            className="font-serif font-medium leading-snug text-[var(--ink)]"
            style={{ fontSize: 18 }}
          >
            {item.title}
          </h3>
        </div>
        <TypeBadge type={item.item_type} />
      </div>

      {item.summary && (
        <p
          className="leading-relaxed text-[var(--ink-2)]"
          style={{ fontSize: 14 }}
        >
          {item.summary}
        </p>
      )}

      {(item.district != null ||
        item.neighborhoods.length > 0 ||
        item.topics.length > 0 ||
        isCitywide) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.district != null && <DistrictChip district={item.district} />}
          {item.neighborhoods.map((n) => (
            <NeighborhoodChip key={n} name={n} />
          ))}
          {item.topics.map((t) => (
            <TopicTag key={t} topic={t} />
          ))}
          {isCitywide && <CitywideChip />}
        </div>
      )}

      {showAction && (
        <ActionCallout
          item={item}
          meetingDate={meetingDate}
          meetingTime={meetingTime}
          meetingLocation={meetingLocation}
        />
      )}

      {item.matter_file_number && (
        <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[12px] text-[var(--ink-3)]">
          <span className="font-mono">FILE № {item.matter_file_number}</span>
          <a
            href={`/projects/${item.matter_file_number}`}
            className="underline hover:text-[var(--ink-2)]"
          >
            track legislation →
          </a>
        </div>
      )}
    </article>
  );
}
