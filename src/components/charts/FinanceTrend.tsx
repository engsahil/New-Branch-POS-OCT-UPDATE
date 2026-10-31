import { useId } from 'react';
import type { FinanceDay } from '@/services/financeService';
import { formatMoney } from '@/utils/currency';
import styles from './FinanceTrend.module.css';

/** Small SVG, no chart dependency; null profit values remain real gaps. */
export function FinanceTrend({ rows, profit = false }: { rows: FinanceDay[]; profit?: boolean }) {
  const id = useId().replace(/:/g, '');
  const series = profit ? [{ key: 'operatingProfit' as const, label: 'Estimated operating profit', color: 'var(--chart-1)' }] : [
    { key: 'revenue' as const, label: 'Sales revenue', color: 'var(--chart-1)' },
    { key: 'expenses' as const, label: 'Operating expenses', color: 'var(--chart-3)' },
  ];
  const values = rows.flatMap((row) => series.map((s) => row[s.key])).filter((value): value is number => value !== null);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (index: number) => 12 + index * 576 / Math.max(1, rows.length - 1);
  const y = (value: number) => 154 - (value - min) / (max - min) * 136;
  const summary = rows.map((row) => `${row.date}: ${series.map((s) => `${s.label} ${row[s.key] === null ? 'unavailable' : formatMoney(row[s.key]!)}`).join(', ')}`).join('; ');
  return <div className={styles.wrapper}>
    <div className={styles.legend}>{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    {values.length === 0 ? <p className={styles.empty}>{profit ? 'No complete cost data for a profit trend in this period.' : 'No sales or expenses in this period.'}</p> : <>
      <svg viewBox="0 0 600 176" role="img" aria-label={summary} className={styles.chart}>
        <defs><clipPath id={id}><rect x="0" y="0" width="600" height="176" /></clipPath></defs>
        <line x1="12" x2="588" y1={y(0)} y2={y(0)} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
        <g clipPath={`url(#${id})`}>{series.map((s) => {
          // Split at missing values instead of drawing a misleading connection.
          const segments: string[] = []; let current: string[] = [];
          rows.forEach((row, index) => {
            const value = row[s.key];
            if (value === null) { if (current.length) segments.push(current.join(' ')); current = []; }
            else current.push(`${x(index)},${y(value)}`);
          });
          if (current.length) segments.push(current.join(' '));
          return <g key={s.key}>{segments.map((points, index) => <polyline key={index} points={points} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}{rows.map((row, index) => row[s.key] !== null ? <circle key={row.date} cx={x(index)} cy={y(row[s.key]!)} r={rows.length < 40 ? 2.5 : 1} fill={s.color}><title>{row.date}: {formatMoney(row[s.key]!)}</title></circle> : null)}</g>;
        })}</g>
      </svg>
      <div className={styles.axis}><span>{rows[0]?.date}</span><span>{profit ? `Range ${formatMoney(min)} to ${formatMoney(max)}` : `Peak ${formatMoney(max)}`}</span><span>{rows[rows.length - 1]?.date}</span></div>
    </>}
    <details className={styles.data}><summary>View daily values</summary><div className={styles.tableScroll}><table><thead><tr><th>Date</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead><tbody>{rows.slice(0, 366).map((row) => <tr key={row.date}><td>{row.date}</td>{series.map((s) => <td key={s.key}>{row[s.key] === null ? 'Unavailable' : formatMoney(row[s.key]!)}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
