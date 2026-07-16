'use client';

/**
 * CashTimeline — bloco ② do santo-graal: "O caixa nos próximos 30 dias".
 * Porta fiel do gráfico `chart-inner`/`chart-tip` do mockup (scratchpad/
 * mockups/visao-geral.html): realizado sólido (passado reconstruído a partir
 * de Transaction paga/history) + previsto tracejado (pendente/atrasado +
 * recorrências projetadas) + 1 marcador único no primeiro dia em que o caixa
 * projetado fica negativo. Clique num dia abre o detalhe local (tooltip) —
 * é só leitura, a navegação é dos outros 4 blocos, não deste gráfico.
 *
 * SVG puro (gramática do módulo, sem recharts — ver CLAUDE.md/plano §1.3).
 */

import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/utils/format';
import type { ProjecaoCaixaOverview } from '../../read-models/projecao-caixa';

interface CashTimelineProps {
  overview: ProjecaoCaixaOverview;
}

const W = 900;
const H = 220;
const PAD_L = 16;
const PAD_R = 16;
const PAD_TOP = 34;
const PAD_BOTTOM = 26;
const MARKER_W = 210;
const MARKER_H = 36;

export function CashTimeline({ overview }: CashTimelineProps) {
  const { points, todayIndex, crossZeroIndex } = overview;
  const [selected, setSelected] = useState<number | null>(null);

  const { xFor, yFor, zeroY } = useMemo(() => {
    const n = points.length;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_TOP - PAD_BOTTOM;
    const values = points.map(p => p.balance);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;
    const xForFn = (i: number) => PAD_L + (n <= 1 ? 0 : i * (plotW / (n - 1)));
    const yForFn = (v: number) => PAD_TOP + ((max - v) / range) * plotH;
    return { xFor: xForFn, yFor: yForFn, zeroY: yForFn(0) };
  }, [points]);

  const n = points.length;
  const solidPath = points
    .slice(0, todayIndex + 1)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.balance).toFixed(1)}`)
    .join(' ');
  const dashPath = points
    .slice(todayIndex)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(todayIndex + i).toFixed(1)},${yFor(p.balance).toFixed(1)}`)
    .join(' ');

  let crossX: number | null = null;
  let crossFillPath: string | null = null;
  let critPath: string | null = null;
  if (crossZeroIndex !== null) {
    const prevIdx = Math.max(todayIndex, crossZeroIndex - 1);
    const prevVal = points[prevIdx].balance;
    const curVal = points[crossZeroIndex].balance;
    if (prevIdx === crossZeroIndex || prevVal < 0) {
      crossX = xFor(crossZeroIndex);
    } else {
      const frac = curVal !== prevVal ? (0 - prevVal) / (curVal - prevVal) : 0;
      crossX = xFor(prevIdx) + frac * (xFor(crossZeroIndex) - xFor(prevIdx));
    }
    crossFillPath =
      `M ${crossX.toFixed(1)},${zeroY.toFixed(1)} ` +
      Array.from({ length: n - crossZeroIndex }, (_, k) => crossZeroIndex + k)
        .map(i => `L ${xFor(i).toFixed(1)},${yFor(points[i].balance).toFixed(1)} `)
        .join('') +
      `L ${xFor(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;
    critPath =
      `M ${crossX.toFixed(1)},${zeroY.toFixed(1)} ` +
      Array.from({ length: n - crossZeroIndex }, (_, k) => crossZeroIndex + k)
        .map(i => `L ${xFor(i).toFixed(1)},${yFor(points[i].balance).toFixed(1)}`)
        .join(' ');
  }

  const todayX = xFor(todayIndex);
  const slot = (W - PAD_L - PAD_R) / n;

  return (
    <div>
      <div className="flex gap-4 px-4.5 pb-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-[2.5px] rounded-sm bg-gray-800 dark:bg-gray-200" />
          realizado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-[2.5px] border-dashed border-gray-800/70 dark:border-gray-200/70" />
          previsto
        </span>
      </div>

      <div className="relative mx-2 mb-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Projeção do caixa para os próximos 30 dias, com realizado e previsto"
          className="block w-full h-auto"
        >
          {/* Faixa sutil abaixo de zero — território de risco, sempre visível. */}
          <rect
            x={PAD_L}
            y={zeroY.toFixed(1)}
            width={W - PAD_L - PAD_R}
            height={Math.max(0, H - PAD_BOTTOM - zeroY).toFixed(1)}
            fill="hsl(var(--fin-crit) / 0.035)"
          />
          <line x1={PAD_L} y1={zeroY.toFixed(1)} x2={W - PAD_R} y2={zeroY.toFixed(1)} stroke="hsl(var(--fin-border))" strokeWidth={1} strokeDasharray="2 3" />
          <text x={PAD_L + 2} y={(zeroY - 4).toFixed(1)} fontSize={9} fill="hsl(var(--fin-faint))">
            0
          </text>

          {crossFillPath && <path d={crossFillPath} fill="hsl(var(--fin-crit) / 0.15)" />}

          <line
            x1={todayX.toFixed(1)}
            y1={PAD_TOP - 8}
            x2={todayX.toFixed(1)}
            y2={H - PAD_BOTTOM}
            stroke="hsl(var(--fin-muted))"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.55}
          />

          <path d={solidPath} fill="none" stroke="currentColor" className="text-gray-800 dark:text-gray-100" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={dashPath}
            fill="none"
            stroke="currentColor"
            className="text-gray-800 dark:text-gray-100"
            strokeWidth={2.4}
            strokeDasharray="1 5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.8}
          />
          {critPath && (
            <path d={critPath} fill="none" stroke="hsl(var(--fin-crit))" strokeWidth={2.6} strokeDasharray="1 5.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {crossZeroIndex !== null && crossX !== null && (
            <g>
              <line
                x1={crossX.toFixed(1)}
                y1={(4 + MARKER_H).toFixed(1)}
                x2={crossX.toFixed(1)}
                y2={(yFor(points[crossZeroIndex].balance) - 9).toFixed(1)}
                stroke="hsl(var(--fin-crit))"
                strokeWidth={1.3}
                strokeDasharray="2 3"
                opacity={0.55}
              />
              <rect
                x={Math.max(PAD_L, Math.min(crossX - MARKER_W / 2, W - PAD_R - MARKER_W)).toFixed(1)}
                y={4}
                width={MARKER_W}
                height={MARKER_H}
                rx={9}
                fill="hsl(var(--fin-crit-soft))"
                stroke="hsl(var(--fin-crit) / 0.35)"
              />
              <text
                x={(Math.max(PAD_L, Math.min(crossX - MARKER_W / 2, W - PAD_R - MARKER_W)) + 11).toFixed(1)}
                y={19}
                fontSize={10.5}
                fontWeight={700}
                fill="hsl(var(--fin-crit))"
              >
                {points[crossZeroIndex].dayLabel} · aqui fica negativo
              </text>
              <text
                x={(Math.max(PAD_L, Math.min(crossX - MARKER_W / 2, W - PAD_R - MARKER_W)) + 11).toFixed(1)}
                y={33}
                fontSize={11.5}
                fontWeight={700}
                fill="hsl(var(--fin-crit))"
                fontFamily="var(--fin-mono)"
              >
                {formatCurrency(points[crossZeroIndex].balance)} projetado
              </text>
              <circle cx={crossX.toFixed(1)} cy={yFor(points[crossZeroIndex].balance).toFixed(1)} r={5} fill="hsl(var(--fin-crit))" stroke="white" strokeWidth={2.2} />
            </g>
          )}

          {[0, todayIndex, n - 1].map((i, k) => (
            <text
              key={i}
              x={xFor(i).toFixed(1)}
              y={H - PAD_BOTTOM + 15}
              fontSize={10}
              fill="hsl(var(--fin-muted))"
              textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
            >
              {i === todayIndex ? 'hoje' : points[i].dayLabel}
            </text>
          ))}

          {points.map((p, i) => (
            <rect
              key={p.date}
              x={(xFor(i) - slot / 2).toFixed(1)}
              y={PAD_TOP - 8}
              width={slot.toFixed(1)}
              height={(H - PAD_BOTTOM - (PAD_TOP - 8)).toFixed(1)}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => setSelected(i)}
            />
          ))}
        </svg>

        {selected !== null && points[selected] && (() => {
          const p = points[selected];
          return (
            <div
              className="absolute -translate-x-1/2 -translate-y-[122%] bg-gray-900 dark:bg-gray-100 text-gray-50 dark:text-gray-900 rounded-xl px-3 py-2.5 text-[11.5px] leading-relaxed min-w-[178px] shadow-xl pointer-events-none z-10"
              style={{ left: `${(xFor(selected) / W) * 100}%`, top: `${(yFor(p.balance) / H) * 100}%` }}
            >
              <div className="font-bold mb-0.5">
                {p.dayLabel}
                {p.isToday ? ' · hoje' : ''}
              </div>
              <div className="fin-num opacity-90">
                Saldo projetado: <b>{formatCurrency(p.balance)}</b>
              </div>
              {p.event ? (
                <div className={`mt-1 font-semibold ${p.event.tone === 'pos' ? 'text-emerald-300 dark:text-emerald-700' : 'text-rose-300 dark:text-rose-700'}`}>
                  {p.event.delta > 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(p.event.delta))} · {p.event.label}
                </div>
              ) : (
                <div className="mt-1 text-gray-400 dark:text-gray-500 font-normal">Sem vencimento grande — variação do dia a dia.</div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
