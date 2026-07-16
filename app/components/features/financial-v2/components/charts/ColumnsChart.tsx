/**
 * ColumnsChart — colunas (baseline única, sem divergente) + linha tracejada da
 * média, fiel à gramática do mockup ("colunas 12m + linha de média" citada no
 * plano §1.3). Usado no drill de "Contas fixas" pra mostrar o histórico de
 * pagamento de uma recorrência e destacar o degrau (ocorrência acima da
 * média). SVG puro — sem recharts, mesma linha das outras charts do módulo.
 */

interface ColumnPoint {
  label: string;
  value: number;
  /** true realça a coluna (o "degrau") na cor crítica em vez da cor padrão. */
  highlight?: boolean;
}

interface ColumnsChartProps {
  data: ColumnPoint[];
  average: number;
  formatValue?: (n: number) => string;
}

const VIEW_WIDTH = 340;
const VIEW_HEIGHT = 145;
const X0 = 16;
const X1 = 330;
const BASE_Y = 100;
const TOP_Y = 14;
const BAR_WIDTH = 16;

export function ColumnsChart({ data, average, formatValue = (n) => String(n) }: ColumnsChartProps) {
  if (data.length === 0) {
    return <div className="fin-eyebrow px-4 py-8 text-center text-[hsl(var(--fin-muted))]">Sem histórico ainda</div>;
  }

  const max = Math.max(1, average, ...data.map(d => d.value));
  const scale = (BASE_Y - TOP_Y) / max;
  const slot = (X1 - X0) / data.length;
  const avgY = BASE_Y - average * scale;

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="Histórico de valores pagos" className="block w-full h-auto">
      <line x1={X0} y1={BASE_Y} x2={X1} y2={BASE_Y} stroke="hsl(var(--fin-border))" strokeWidth={1} />
      <line
        x1={X0}
        y1={avgY.toFixed(1)}
        x2={X1}
        y2={avgY.toFixed(1)}
        stroke="hsl(var(--fin-muted))"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text x={X1} y={(avgY - 4).toFixed(1)} textAnchor="end" fontSize={8.5} fill="hsl(var(--fin-muted))">
        média {formatValue(average)}
      </text>
      {data.map((d, i) => {
        const cx = X0 + slot * i + slot / 2;
        const h = Math.max(1, d.value * scale);
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={(cx - BAR_WIDTH / 2).toFixed(1)}
              y={(BASE_Y - h).toFixed(1)}
              width={BAR_WIDTH}
              height={h.toFixed(1)}
              rx={3}
              fill={d.highlight ? 'hsl(var(--fin-crit))' : 'hsl(var(--fin-primary))'}
              className="transition-opacity hover:opacity-80"
            >
              <title>{`${d.label} · ${formatValue(d.value)}`}</title>
            </rect>
            <text x={cx} y={136} textAnchor="middle" fontSize={9} fill="hsl(var(--fin-muted))">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
