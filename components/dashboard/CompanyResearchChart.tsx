"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

type Props = {
  data: { day: string; count: number }[];
};

export function CompanyResearchChart({ data }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary mb-6">
        Company Research Activity
      </h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barSize={24}>
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
          <Bar
            dataKey="count"
            fill="var(--color-info)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
