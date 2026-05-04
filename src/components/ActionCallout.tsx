// Soft yellow callout shown on at most one item per meeting card.
// Highlights public-comment deadlines, email/portal links, in-person slots.

import { fmtDateLong } from '@/lib/format';
import type { ItemSubCardData } from './ItemSubCard';

const calloutStyle = {
  background: 'oklch(0.97 0.05 95)',
  borderColor: 'oklch(0.84 0.10 90)',
  color: 'oklch(0.46 0.13 65)',
};

export function ActionCallout({
  item,
  meetingDate,
  meetingTime,
  meetingLocation,
}: {
  item: ItemSubCardData;
  meetingDate: string;
  meetingTime?: string | null;
  meetingLocation?: string | null;
}) {
  const headline = item.comment_deadline
    ? `Take action by ${fmtDateLong(item.comment_deadline)}`
    : 'Take action';

  const meetingLine = [
    fmtDateLong(meetingDate),
    meetingTime,
    meetingLocation,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className="mt-3 px-4 py-3 border rounded-[6px] text-[14.5px] leading-relaxed"
      style={calloutStyle}
    >
      <div className="font-semibold">{headline}</div>
      {meetingLine && <div className="mt-0.5">{meetingLine}</div>}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {item.comment_email && (
          <a className="underline" href={`mailto:${item.comment_email}`}>
            Email comment
          </a>
        )}
        {item.comment_portal_url && (
          <a
            className="underline"
            href={item.comment_portal_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Comment portal →
          </a>
        )}
        {item.in_person_slot && <span>{item.in_person_slot}</span>}
      </div>
    </div>
  );
}
