'use client';

/**
 * DivergingChart — gráfico divergente reutilizável (± em torno do zero), fiel
 * ao `svgDivergente` do mockup (financeiro-assinaturas.html), mas genérico:
 * qualquer par de séries positiva/negativa por período (novos×churn, entrada×
 * saída semanal, etc.) — não conhece o domínio, só desenha números.
 *
 * SVG puro (sem recharts — gramática do módulo). Barras positivas sobem do
 * zero, negativas descem; tooltip nativo via <title>.
 */

interface DivergingSeriesPoint {
  label: string;
  positive: number;
  negative: number;
  /** Esmaece a coluna (ex: semana em andamento) — só efeito visual, sem lógica. */
  muted?: boolean;
}

interface DivergingChartProps {
  data: DivergingSeriesPoint[];
  /** Formata o valor no tooltip (padrão: número cru). */
  formatValue?: (n: number) => string;
  positiveLabel?: string;
  negativeLabel?: string;
  height?: number;
  /** Quando presente, cada coluna vira clicável (overlay invisível, como o
   *  `.colbg` do mockup bancario.html) — dispara o drill pro índice clicado. */
  onSelect?: (index: number) => void;
}

const VIEW_WIDTH = 340;
const VIEW_HEIGHT = 145;
const X0 = 16;
const X1 = 330;
const BAR_WIDTH = 18;
const ZERO_Y = 58;
const MAX_BAR_HEIGHT = 44;

export function DivergingChart({
  data,
  formatValue = (n) => String(n),
  positiveLabel = 'Positivo',
  negativeLabel = 'Negativo',
  onSelect,
}: DivergingChartProps) {
  if (data.length === 0) {
    return <div className="fin-eyebrow px-4 py-8 text-center text-[hsl(var(--fin-muted))]">Sem dados no período</div>;
  }

  const max = Math.max(1, ...data.map(d => d.positive), ...data.map(d => d.negative));
  const scale = MAX_BAR_HEIGHT / max;
  const slot = (X1 - X0) / data.length;

  return (
    <div>
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={`${positiveLabel} e ${negativeLabel} por período`} className="block w-full h-auto">
        <line x1={X0} y1={ZERO_Y} x2={X1} y2={ZERO_Y} stroke="hsl(var(--fin-border))" strokeWidth={1} />
        {data.map((d, i) => {
          const cx = X0 + slot * i + slot / 2;
          const posH = d.positive * scale;
          const negH = d.negative * scale;
          const opacity = d.muted ? 0.55 : 1;
          const barClassName = onSelect ? 'pointer-events-none transition-opacity' : 'transition-opacity hover:opacity-80';
          return (
            <g key={d.label}>
              {onSelect && (
                <rect
                  x={(X0 + slot * i + 1).toFixed(1)}
                  y={2}
                  width={(slot - 2).toFixed(1)}
                  height={VIEW_HEIGHT - 16}
                  fill="hsl(var(--fin-surface-2))"
                  opacity={0}
                  rx={8}
                  className="cursor-pointer transition-opacity hover:opacity-70"
                  onClick={() => onSelect(i)}
                >
                  <title>{`${d.label} — clique pra ver o detalhe`}</title>
                </rect>
              )}
              {d.positive > 0 && (
                <rect
                  x={(cx - BAR_WIDTH / 2).toFixed(1)}
                  y={(ZERO_Y - posH).toFixed(1)}
                  width={BAR_WIDTH}
                  height={posH.toFixed(1)}
                  rx={3}
                  fill="hsl(var(--fin-pos))"
                  opacity={opacity}
                  className={barClassName}
                >
                  <title>{`${d.label} · ${positiveLabel} ${formatValue(d.positive)}`}</title>
                </rect>
              )}
              {d.negative > 0 && (
                <rect
                  x={(cx - BAR_WIDTH / 2).toFixed(1)}
                  y={ZERO_Y}
                  width={BAR_WIDTH}
                  height={negH.toFixed(1)}
                  rx={3}
                  fill="hsl(var(--fin-crit))"
                  opacity={opacity}
                  className={barClassName}
                >
                  <title>{`${d.label} · ${negativeLabel} ${formatValue(d.negative)}`}</title>
                </rect>
              )}
              <text x={cx} y={136} textAnchor="middle" fontSize={9} fill="hsl(var(--fin-muted))">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 px-1 pt-1 text-xs text-[hsl(var(--fin-muted))]">
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-[3px] bg-[hsl(var(--fin-pos))] inline-block" />
          {positiveLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-[3px] bg-[hsl(var(--fin-crit))] inline-block" />
          {negativeLabel}
        </span>
      </div>
    </div>
  );
}
