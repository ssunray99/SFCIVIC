import { Badge } from './Badge';

export type ItemCardData = {
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

const formatDeadline = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

function ActionCTA({ item, meetingUpcoming }: { item: ItemCardData; meetingUpcoming: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const deadlineFuture = item.comment_deadline != null && item.comment_deadline >= today;
  const hasAnyAction =
    item.comment_deadline != null ||
    item.comment_email != null ||
    item.comment_portal_url != null ||
    item.in_person_slot != null;

  if (!hasAnyAction) return null;
  // Hide entirely once the meeting is in the past and any deadline has lapsed
  if (!meetingUpcoming && !deadlineFuture) return null;

  const headline =
    item.comment_deadline != null
      ? `Take action by ${formatDeadline(item.comment_deadline)}`
      : 'Take action';

  return (
    <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/60 dark:bg-amber-900/20">
      <div className="font-medium text-amber-900 dark:text-amber-200">{headline}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-amber-800 dark:text-amber-300">
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
            Comment portal ↗
          </a>
        )}
        {item.in_person_slot && <span>{item.in_person_slot}</span>}
      </div>
    </div>
  );
}

export function ItemCard({
  item,
  meetingUpcoming = false,
}: {
  item: ItemCardData;
  meetingUpcoming?: boolean;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium leading-snug">
          {item.position != null && (
            <span className="mr-2 text-zinc-400">#{item.position}</span>
          )}
          {item.title}
        </h3>
        {item.item_type && (
          <Badge variant="muted" className="shrink-0 capitalize">
            {item.item_type}
          </Badge>
        )}
      </div>

      {item.summary && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.summary}</p>
      )}

      {(() => {
        const isCitywide = item.district == null && item.neighborhoods.length === 0;
        if (!isCitywide && item.district == null && item.neighborhoods.length === 0 && item.topics.length === 0) {
          return null;
        }
        return (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {isCitywide && <Badge variant="muted">Citywide</Badge>}
            {item.district != null && (
              <Badge variant="district">District {item.district}</Badge>
            )}
            {item.neighborhoods.map((n) => (
              <Badge key={n} variant="neighborhood">{n}</Badge>
            ))}
            {item.topics.map((t) => (
              <Badge key={t} variant="topic">{t}</Badge>
            ))}
          </div>
        );
      })()}

      <ActionCTA item={item} meetingUpcoming={meetingUpcoming} />

      {item.matter_file_number && (
        <a
          href={`/projects/${item.matter_file_number}`}
          className="mt-1 w-fit text-xs text-sky-700 underline dark:text-sky-400"
        >
          File #{item.matter_file_number} — track this legislation →
        </a>
      )}
    </article>
  );
}
