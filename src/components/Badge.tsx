import { cn } from '@/lib/utils';

type Variant = 'default' | 'topic' | 'neighborhood' | 'district' | 'source' | 'muted';

const variantClass: Record<Variant, string> = {
  default:      'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  topic:        'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  neighborhood: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  district:     'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  source:       'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900',
  muted:        'bg-transparent text-zinc-500 ring-1 ring-inset ring-zinc-300 dark:text-zinc-400 dark:ring-zinc-700',
};

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantClass[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
