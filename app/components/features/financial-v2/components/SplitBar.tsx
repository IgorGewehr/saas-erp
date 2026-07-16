'use client';

/**
 * SplitBar — a barrinha bicolor `.split-bar` do mockup (fixo × variável).
 * Puramente visual: recebe as duas fatias já calculadas, nunca faz matemática.
 */

interface SplitBarProps {
  /** 0-100 */
  leftPct: number;
  leftClassName?: string;
  rightClassName?: string;
}

export function SplitBar({ leftPct, leftClassName, rightClassName }: SplitBarProps) {
  const clamped = Math.max(0, Math.min(100, leftPct));
  return (
    <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
      <div className={leftClassName ?? 'bg-[hsl(var(--fin-primary))]'} style={{ width: `${clamped}%` }} />
      <div className={rightClassName ?? 'bg-gray-100 dark:bg-gray-800'} style={{ width: `${100 - clamped}%` }} />
    </div>
  );
}
