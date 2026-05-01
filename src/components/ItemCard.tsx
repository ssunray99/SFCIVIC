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
};

export function ItemCard({ item }: { item: ItemCardData }) {
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

      {(item.district != null || item.neighborhoods.length > 0 || item.topics.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1.5">
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
      )}
    </article>
  );
}
