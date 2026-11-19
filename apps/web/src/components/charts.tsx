/**
 * Charts are rendered with TradingView Lightweight Charts from real executions only.
 * Times are shifted into the viewer's local zone (the library renders UTC).
 */
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryPoint } from '@/lib/api';
import { int, money } from '@/lib/format';
import { cssVar, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const tzShift = () => -new Date().getTimezoneOffset() * 60;
const toTime = (iso: string) => (Math.floor(new Date(iso).getTime() / 1000) + tzShift()) as UTCTimestamp;
const fromTime = (t: Time) => new Date(((t as number) - tzShift()) * 1000);
const dollars = (c: number) => c / 100;

function baseOptions(height: number) {
  return {
    height,
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: cssVar('--fg-subtle'),
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: 11,
      attributionLogo: false,
    },
    grid: { vertLines: { color: cssVar('--chart-grid') }, horzLines: { color: cssVar('--chart-grid') } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: cssVar('--border-strong'), labelBackgroundColor: cssVar('--surface-3') },
      horzLine: { color: cssVar('--border-strong'), labelBackgroundColor: cssVar('--surface-3') },
    },
    localization: { priceFormatter: (p: number) => `$${p.toFixed(2)}` },
    handleScale: { axisPressedMouseMove: false },
  } as const;
}

export type ChartStyle = 'candles' | 'line';

interface Legend {
  at: Date;
  o?: number;
  h?: number;
  l?: number;
  c: number;
  v: number;
}

/** Security price chart: candles or line, volume histogram and a labeled reference line. */
export function PriceChart({
  points,
  style,
  referencePriceCents,
  referenceLabel,
  height = 340,
}: {
  points: HistoryPoint[];
  style: ChartStyle;
  referencePriceCents: number | null;
  referenceLabel: string;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [legend, setLegend] = useState<Legend | null>(null);

  // Aggregate trade points sharing a second (the library needs strictly increasing times).
  const series = useMemo(() => {
    const bars: { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number }[] = [];
    for (const p of points) {
      const time = toTime(p.at);
      const o = p.kind === 'bar' ? p.openCents : p.priceCents;
      const h = p.kind === 'bar' ? p.highCents : p.priceCents;
      const l = p.kind === 'bar' ? p.lowCents : p.priceCents;
      const c = p.kind === 'bar' ? p.closeCents : p.priceCents;
      const v = p.kind === 'bar' ? p.volume : p.quantity;
      const last = bars[bars.length - 1];
      if (last && last.time === time) {
        last.high = Math.max(last.high, h);
        last.low = Math.min(last.low, l);
        last.close = c;
        last.volume += v;
      } else bars.push({ time, open: o, high: h, low: l, close: c, volume: v });
    }
    return bars;
  }, [points]);

  useEffect(() => {
    if (!el.current) return;
    const up = cssVar('--up');
    const down = cssVar('--down');
    const chart: IChartApi = createChart(el.current, baseOptions(height));
    const main =
      style === 'candles'
        ? chart.addSeries(CandlestickSeries, {
            upColor: up,
            downColor: down,
            wickUpColor: up,
            wickDownColor: down,
            borderVisible: false,
            priceLineVisible: true,
          })
        : chart.addSeries(LineSeries, { color: up, lineWidth: 2, priceLineVisible: true, crosshairMarkerRadius: 4 });
    if (style === 'candles') {
      (main as ReturnType<typeof chart.addSeries<'Candlestick'>>).setData(
        series.map((b) => ({ time: b.time, open: dollars(b.open), high: dollars(b.high), low: dollars(b.low), close: dollars(b.close) })),
      );
    } else {
      (main as ReturnType<typeof chart.addSeries<'Line'>>).setData(series.map((b) => ({ time: b.time, value: dollars(b.close) })));
    }
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(
      series.map((b, i) => ({
        time: b.time,
        value: b.volume,
        color: (b.close >= (series[i - 1]?.close ?? b.open) ? up : down) + '55',
      })),
    );
    if (referencePriceCents !== null) {
      main.createPriceLine({
        price: dollars(referencePriceCents),
        color: cssVar('--fg-subtle'),
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: referenceLabel,
      });
    }
    chart.timeScale().fitContent();

    const byTime = new Map(series.map((b) => [b.time as number, b]));
    const onMove = (p: MouseEventParams) => {
      const b = p.time !== undefined ? byTime.get(p.time as number) : undefined;
      setLegend(b ? { at: fromTime(b.time), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [series, style, referencePriceCents, referenceLabel, height, theme]);

  const last = series[series.length - 1];
  const shown: Legend | null = legend ?? (last ? { at: fromTime(last.time), o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume } : null);
  return (
    <div className="relative">
      {shown && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-muted num">
          <span className="text-fg-subtle">{shown.at.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          {style === 'candles' && shown.o !== undefined && (
            <>
              <span>O <b className="font-medium text-fg">{money(shown.o)}</b></span>
              <span>H <b className="font-medium text-fg">{money(shown.h)}</b></span>
              <span>L <b className="font-medium text-fg">{money(shown.l)}</b></span>
            </>
          )}
          <span>{style === 'candles' ? 'C' : 'Price'} <b className="font-medium text-fg">{money(shown.c)}</b></span>
          <span>Vol <b className="font-medium text-fg">{int(shown.v)}</b></span>
        </div>
      )}
      <div ref={el} style={{ height }} className="w-full" />
    </div>
  );
}

/** Account value area chart. */
export function ValueChart({
  points,
  baselineCents,
  height = 280,
  onHover,
}: {
  points: { at: string; valueCents: number }[];
  baselineCents: number;
  height?: number;
  onHover?: (p: { at: string; valueCents: number } | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const hover = useRef(onHover);
  hover.current = onHover;

  const data = useMemo(() => {
    const out: { time: UTCTimestamp; value: number; at: string; valueCents: number }[] = [];
    for (const p of points) {
      const time = toTime(p.at);
      const last = out[out.length - 1];
      if (last && last.time >= time) {
        last.value = dollars(p.valueCents);
        last.valueCents = p.valueCents;
        last.at = p.at;
      } else out.push({ time, value: dollars(p.valueCents), at: p.at, valueCents: p.valueCents });
    }
    return out;
  }, [points]);

  useEffect(() => {
    if (!el.current) return;
    const lastV = data[data.length - 1]?.valueCents ?? baselineCents;
    const c = lastV >= baselineCents ? cssVar('--up') : cssVar('--down');
    const chart = createChart(el.current, {
      ...baseOptions(height),
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.08 } },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--chart-grid') } },
    });
    const s = chart.addSeries(AreaSeries, {
      lineColor: c,
      lineWidth: 2,
      topColor: c + '33',
      bottomColor: c + '00',
      priceLineVisible: false,
      crosshairMarkerRadius: 4,
    });
    s.setData(data.map((d) => ({ time: d.time, value: d.value })));
    s.createPriceLine({ price: dollars(baselineCents), color: cssVar('--fg-subtle'), lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' });
    chart.timeScale().fitContent();
    const byTime = new Map(data.map((d) => [d.time as number, d]));
    const onMove = (p: MouseEventParams) => {
      const d = p.time !== undefined ? byTime.get(p.time as number) : undefined;
      hover.current?.(d ? { at: d.at, valueCents: d.valueCents } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [data, baselineCents, height, theme]);

  return <div ref={el} style={{ height }} className="w-full" />;
}

/** Tiny SVG sparkline from real prices (cents). */
export function Sparkline({ values, className, positive }: { values: number[]; className?: string; positive?: boolean }) {
  if (values.length < 2) return <div className={cn('h-8 w-20', className)} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 80;
  const h = 28;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const up = positive ?? values[values.length - 1]! >= values[0]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-7 w-20', className)} aria-hidden preserveAspectRatio="none">
      <path d={d} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
