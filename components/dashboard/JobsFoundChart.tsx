"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

type Props = {
  data: { day: string; count: number }[];
};

export function JobsFoundChart({ data }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary mb-6">
        Jobs Found Over Time
      </h2>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="jobsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-accent)"
                stopOpacity={0.2}
              />
              <stop
                offset="95%"
                stopColor="var(--color-accent)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--color-accent)"
            strokeWidth={3}
            fill="url(#jobsGradient)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
