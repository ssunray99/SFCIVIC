// 3-column grid of clickable tiles with last-row centering. When the total
// count isn't divisible by 3, the leftover 1 or 2 tiles render in a centered
// flex row below the main grid.
//
// Used by /topics and /neighborhoods index pages.

import Link from 'next/link';

export type Tile = { label: string; href: string };

function GridTile({ tile }: { tile: Tile }) {
  return (
    <Link
      href={tile.href}
      className="block px-5 py-4 border border-[var(--rule)] rounded-[8px] bg-[var(--paper)] hover:bg-[var(--paper-2)] text-[15.5px] text-[var(--ink)] transition-colors"
    >
      {tile.label}
    </Link>
  );
}

export function TileGrid({ tiles }: { tiles: Tile[] }) {
  const n = tiles.length;
  const tailLen = n % 3;
  const fullCount = tailLen === 0 ? n : n - tailLen;
  const head = tiles.slice(0, fullCount);
  const tail = tiles.slice(fullCount);

  return (
    <div className="flex flex-col gap-3">
      {head.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {head.map((t) => (
            <GridTile key={t.label} tile={t} />
          ))}
        </div>
      )}
      {tail.length > 0 && (
        <div
          className="grid gap-3 mx-auto w-full"
          style={{
            gridTemplateColumns: `repeat(${tail.length}, minmax(0, 1fr))`,
            maxWidth: `calc(${(tail.length / 3) * 100}% - ${
              ((3 - tail.length) * 12) / 3
            }px)`,
          }}
        >
          {tail.map((t) => (
            <GridTile key={t.label} tile={t} />
          ))}
        </div>
      )}
    </div>
  );
}
