"use client";

import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bucketLabel, type ReportSummary } from "@/lib/reports";

// Validated with the dataviz palette checker on the white card surface:
// slot 1 (blue) and slot 2 (orange) pass lightness, chroma, colour-blind
// separation and 3:1 contrast. Text stays in the app's ink colours.
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const INK = "#26332d";
const MUTED = "#5b6b63";
const GRID = "#e6ebe7";

const axisTick = { fill: MUTED, fontSize: 12 };
const tooltipStyle = {
  contentStyle: { borderRadius: 8, border: "1px solid #dfe5e0", fontSize: 13, color: INK },
  labelStyle: { color: INK, fontWeight: 600 },
  cursor: { fill: "rgba(38, 51, 45, 0.06)" },
};

// Measures the box the chart sits in and draws the chart at that exact width,
// re-measuring whenever the box changes (window resize, grid reflow). Recharts'
// own ResponsiveContainer could measure a card before the grid had laid it out
// and keep that first, too-small size.
function Sized({ height, label, children }: { height: number; label: string; children: (width: number) => ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ height }} className="w-full min-w-0" role="img" aria-label={label} data-chart-width={width}>
      {width > 0 ? children(width) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="flex h-40 items-center justify-center rounded-lg bg-lightgrey text-sm text-muted">{text}</p>;
}

export function OverTimeChart({ data, bucket }: { data: ReportSummary["over_time"]; bucket: ReportSummary["bucket"] }) {
  if (!data.some((d) => d.received || d.fulfilled)) return <Empty text="No requests in this period." />;
  const rows = data.map((d) => ({ ...d, label: bucketLabel(d.bucket, bucket) }));
  return (
    <Sized height={256} label="Requests received and fulfilled over time">
      {(width) => (
        <LineChart width={width} height={256} data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip {...tooltipStyle} cursor={{ stroke: MUTED, strokeDasharray: "3 3" }} />
          <Legend wrapperStyle={{ fontSize: 13, color: INK }} iconType="plainline" />
          <Line type="monotone" dataKey="received" name="Received" stroke={SERIES_1} strokeWidth={2} dot={rows.length <= 31 ? { r: 3 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="fulfilled" name="Fulfilled" stroke={SERIES_2} strokeWidth={2} strokeDasharray="6 3" dot={rows.length <= 31 ? { r: 3 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      )}
    </Sized>
  );
}

// One series per chart: every bar takes slot 1, values are labelled at the end.
export function RankedBars({
  data,
  label,
  unit,
  empty,
}: {
  data: Array<{ name: string; value: number; suffix?: string }>;
  label: string;
  unit: string;
  empty: string;
}) {
  if (!data.some((d) => d.value > 0)) return <Empty text={empty} />;
  const height = Math.max(120, data.length * 40 + 24);
  return (
    <Sized height={height} label={label}>
      {(width) => (
        <BarChart width={width} height={height} data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }} barCategoryGap={8}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={130} tick={{ ...axisTick, fill: INK }} tickLine={false} axisLine={false} />
          <Tooltip {...tooltipStyle} formatter={(v) => [`${v} ${unit}`, ""]} separator="" />
          <Bar dataKey="value" fill={SERIES_1} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" fill={INK} fontSize={12} />
          </Bar>
        </BarChart>
      )}
    </Sized>
  );
}
