import { useId } from 'react';
import { formatMoney } from '@/utils/currency';
import styles from './Charts.module.css';

export interface TrendPoint {
  label: string;
  value: number;
}

export interface TrendChartProps {
  points: TrendPoint[];
  /** Chart height in CSS pixels. */
  height?: number;
  /** Accessible summary of the whole series. */
  summary: string;
}

/**
 * Sales trend line chart.
 *
 * Hand-drawn SVG rather than a charting dependency: the shape is a polyline
 * with a filled area, which the runtime can render in a few hundred bytes and
 * without an animation loop. Points are evenly spaced, so an empty day still
 * occupies its slot on the x axis instead of vanishing.
 */
export function TrendChart({ points, height = 128, summary }: TrendChartProps) {
  const gradientId = useId().replace(/[:]/g, '');
  const width = 320;
  const padX = 6;
  const padY = 10;
  const plotHeight = height - padY * 2;
  const peak = Math.max(...points.map((point) => point.value), 0);

  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
  const yFor = (value: number) =>
    peak > 0 ? height - padY - (value / peak) * plotHeight : height - padY;

  const coords = points.map((point, index) => ({
    ...point,
    x: padX + index * step,
    y: yFor(point.value),
  }));

  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area =
    coords.length > 0
      ? `${coords[0]!.x.toFixed(1)},${height - padY} ${line} ${coords[
          coords.length - 1
        ]!.x.toFixed(1)},${height - padY}`
      : '';

  if (points.every((point) => point.value === 0)) {
    return (
      <p className={styles.empty} role="img" aria-label={summary}>
        No sales in this period yet.
      </p>
    );
  }

  return (
    <div className={styles.trend} role="img" aria-label={summary}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={styles.trendSvg}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ul className={styles.trendAxis}>
        {coords.map((point) => (
          <li key={point.label} className={styles.axisPoint}>
            <span className={styles.axisLabel}>{point.label}</span>
            <span className={styles.axisValue}>
              {formatMoney(point.value, { withSymbol: false })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  count?: number;
  color: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  /** Text shown inside the ring, e.g. "42 orders". */
  centreValue: string;
  centreLabel: string;
  /** Formats a slice value for the legend. */
  formatValue: (value: number) => string;
  summary: string;
}

/**
 * Doughnut chart drawn with stroke dashes on a single circle.
 *
 * No animation: the ring is static so it cannot shift under a screenshot or
 * distract an operator taking an order. Zero totals render an empty track.
 */
export function DonutChart({
  slices,
  centreValue,
  centreLabel,
  formatValue,
  summary,
}: DonutChartProps) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={styles.donut}>
      <div className={styles.donutRing}>
        <svg viewBox="0 0 120 120" role="img" aria-label={summary}>
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="var(--color-surface-muted)"
            strokeWidth="14"
          />
          {total > 0
            ? slices.map((slice) => {
                const share = Math.max(0, slice.value) / total;
                const dash = share * circumference;
                const element = (
                  <circle
                    key={slice.label}
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth="14"
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 60 60)"
                  />
                );
                offset += dash;
                return element;
              })
            : null}
        </svg>
        <span className={styles.donutCentre}>
          <span className={styles.donutValue}>{centreValue}</span>
          <span className={styles.donutLabel}>{centreLabel}</span>
        </span>
      </div>

      <ul className={styles.legend}>
        {slices.map((slice) => (
          <li key={slice.label} className={styles.legendRow}>
            <span
              className={styles.legendDot}
              style={{ backgroundColor: slice.color }}
              aria-hidden="true"
            />
            <span className={styles.legendLabel}>{slice.label}</span>
            <span className={styles.legendValue}>
              {formatValue(slice.value)}
              {typeof slice.count === 'number' ? (
                <span className={styles.legendCount}>
                  {slice.count} order{slice.count === 1 ? '' : 's'}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Palette shared by every chart so series colours stay consistent. */
export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
