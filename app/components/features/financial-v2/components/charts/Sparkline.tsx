'use client';

/**
 * Sparkline — mini gráfico de linha + gradiente, usado no StatTile hero
 * (espelha o `.spark` do mockup). SVG puro, sem lib de chart (gramática do
 * módulo, ver CLAUDE.md/plano §1.3 — recharts não entra no financial-v2).
 */

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Cor via token HSL escopado (.fin2), ex: 'var(--fin-primary)'. */
  colorVar?: string;
}

export function Sparkline({ values, width = 260, height = 34, className, colorVar = '--fin-primary' }: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 2;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const gradId = `fin2-spark-grad-${colorVar.replace(/[^a-z0-9]/gi, '')}`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Tendência dos últimos períodos"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(var(${colorVar}))`} stopOpacity="0.28" />
          <stop offset="1" stopColor={`hsl(var(${colorVar}))`} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={linePath} fill="none" stroke={`hsl(var(${colorVar}))`} strokeWidth={2} strokeLinecap="round" />
      <path d={areaPath} fill={`url(#${gradId})`} />
      <circle cx={lastX} cy={lastY} r={3} fill={`hsl(var(${colorVar}))`} />
    </svg>
  );
}
