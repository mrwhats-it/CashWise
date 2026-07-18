"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { api } from "@/lib/supabase";
import { onToggle } from "@/lib/toggleBus";

type Entry = {
  id: string; kind: "income" | "expense"; title: string;
  category?: string | null; amount: number; entry_date: string; memo?: string | null;
};

type View = "monthly" | "weekly" | "daily";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ------- date bucketing ------- */
function bucketKey(iso: string, view: View): string {
  const d = new Date(iso);
  if (view === "daily")  return iso;
  if (view === "weekly") {
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  return iso.slice(0, 7); // YYYY-MM
}
function bucketLabel(key: string, view: View): string {
  if (view === "monthly") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
  }
  if (view === "weekly") return `w/${key.slice(5)}`;
  return key.slice(5);
}
function nextBucket(key: string, view: View): string {
  const d = new Date(view === "monthly" ? `${key}-01` : key);
  if (view === "daily")  d.setUTCDate(d.getUTCDate() + 1);
  else if (view === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return bucketKey(d.toISOString().slice(0, 10), view);
}

/* How far ahead to always show, per view. */
const FORWARD = { monthly: 6, weekly: 8, daily: 30 } as const;
/* How far back to show if there are no earlier entries. */
const BACKWARD = { monthly: 3, weekly: 4, daily: 14 } as const;

function shiftBack(iso: string, view: View, n: number): string {
  const d = new Date(iso);
  if (view === "daily")  d.setUTCDate(d.getUTCDate() - n);
  else if (view === "weekly") d.setUTCDate(d.getUTCDate() - n * 7);
  else d.setUTCMonth(d.getUTCMonth() - n);
  return bucketKey(d.toISOString().slice(0, 10), view);
}
function shiftForward(iso: string, view: View, n: number): string {
  const d = new Date(iso);
  if (view === "daily")  d.setUTCDate(d.getUTCDate() + n);
  else if (view === "weekly") d.setUTCDate(d.getUTCDate() + n * 7);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return bucketKey(d.toISOString().slice(0, 10), view);
}

/* Build a continuous range of buckets so empty periods still render. */
function buildRange(entries: Entry[], view: View): string[] {
  const nowIso = new Date().toISOString().slice(0, 10);
  const nowBucket = bucketKey(nowIso, view);

  let start = shiftBack(nowIso, view, BACKWARD[view]);
  let end   = shiftForward(nowIso, view, FORWARD[view]);

  if (entries.length > 0) {
    const dates = entries.map((e) => e.entry_date).sort();
    const first = bucketKey(dates[0], view);
    const last  = bucketKey(dates[dates.length - 1], view);
    if (first < start) start = first;
    if (last  > end)   end   = last;
  }
  // ensure "now" is included
  if (nowBucket < start) start = nowBucket;
  if (nowBucket > end)   end   = nowBucket;

  const out: string[] = [];
  let cur = start;
  while (cur <= end && out.length < 400) {
    out.push(cur);
    cur = nextBucket(cur, view);
  }
  return out;
}

export default function Dashboard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [view, setView] = useState<View>("monthly");
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  useEffect(() => { api<Entry[]>("/api/entries").then(setEntries).catch(() => {}); }, []);

  // Listen for AI-driven toggle events from the Gemma panel.
  useEffect(() => onToggle(({ entryIds, active }) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      for (const id of entryIds) {
        if (active) next.delete(id); else next.add(id);
      }
      return next;
    });
  }), []);

  const activeEntries = useMemo(
    () => entries.filter((e) => !disabled.has(e.id)),
    [entries, disabled]
  );

  /* ------- graph data: bars at 0 (expense negative), cumulative line ------- */
  const chartData = useMemo(() => {
    const range = buildRange(activeEntries, "monthly");
    const buckets: Record<string, { income: number; expense: number }> = {};
    for (const k of range) buckets[k] = { income: 0, expense: 0 };
    for (const e of activeEntries) {
      const k = bucketKey(e.entry_date, "monthly");
      if (!buckets[k]) buckets[k] = { income: 0, expense: 0 };
      buckets[k][e.kind] += Number(e.amount);
    }
    let running = 0;
    return range.map((k) => {
      const b = buckets[k];
      running += b.income - b.expense;
      return {
        label: bucketLabel(k, "monthly"),
        income: b.income,
        expense: b.expense,        // positive — both bars grow up from y=0
        cashOnHand: running,       // cumulative running total (dips below 0 when negative)
      };
    });
  }, [activeEntries]);

  const totalIncome  = activeEntries.filter(e => e.kind === "income").reduce((s, e) => s + Number(e.amount), 0);
  const totalExpense = activeEntries.filter(e => e.kind === "expense").reduce((s, e) => s + Number(e.amount), 0);

  /* ------- worksheet grid: category × bucket, rows = individual entries ------- */
  const range = useMemo(() => buildRange(entries, view), [entries, view]);
  const rangeLabels = useMemo(() => range.map((k) => bucketLabel(k, view)), [range, view]);

  const grouped = useMemo(() => {
    const g: Record<string, Entry[]> = {};
    const sorted = [...entries].sort(
      (a, b) => (a.category || "~").localeCompare(b.category || "~") ||
                a.entry_date.localeCompare(b.entry_date)
    );
    for (const e of sorted) {
      const cat = e.category || "Uncategorized";
      (g[cat] ??= []).push(e);
    }
    return g;
  }, [entries]);

  const toggleRow = (id: string) => {
    setDisabled((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Total Income (visible)"  value={totalIncome}  color="text-accent" />
        <Stat label="Total Expense (visible)" value={totalExpense} color="text-danger" />
        <Stat label="Net Cash on Hand"        value={totalIncome - totalExpense} color="text-sky-400" />
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Cash flow (monthly)</h2>
          {disabled.size > 0 && (
            <button className="text-xs text-slate-400 hover:text-white"
              onClick={() => setDisabled(new Set())}>
              Show all rows ({disabled.size} hidden)
            </button>
          )}
        </div>
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#232c39" />
              <XAxis dataKey="label" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
              <Tooltip contentStyle={{ background: "#161d27", border: "1px solid #232c39" }} />
              <Legend />
              <Bar dataKey="income"  fill="#22c55e" name="Income"  />
              <Bar dataKey="expense" fill="#ef4444" name="Expense" />
              <Line type="monotone" dataKey="cashOnHand" stroke="#38bdf8" strokeWidth={2}
                    name="Cash on hand" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Worksheet</h2>
          <div className="flex gap-1 bg-bg-soft border border-line rounded-md p-1">
            {(["monthly","weekly","daily"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded text-xs capitalize ${
                  view === v ? "bg-accent text-black" : "text-slate-400 hover:text-white"
                }`}>{v}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="text-slate-400">
              <tr className="border-b border-line">
                <th className="text-left py-2 pr-2 sticky left-0 bg-bg-card w-8"></th>
                <th className="text-left py-2 pr-4 sticky left-8 bg-bg-card">Entry</th>
                {rangeLabels.map((l) => (
                  <th key={l} className="text-right px-3 whitespace-nowrap">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(grouped).length === 0 && (
                <tr><td colSpan={rangeLabels.length + 2} className="py-6 text-center text-slate-500">
                  No entries yet — add one on the Cash tab.
                </td></tr>
              )}
              {Object.entries(grouped).map(([cat, rows]) => (
                <Fragment key={cat}>
                  <tr className="bg-bg-soft/60">
                    <td colSpan={rangeLabels.length + 2}
                        className="py-1.5 px-2 text-xs uppercase tracking-wide text-slate-300 font-semibold">
                      {cat}
                    </td>
                  </tr>
                  {rows.map((e) => {
                    const active = !disabled.has(e.id);
                    const cellKey = bucketKey(e.entry_date, view);
                    const signed = e.kind === "income" ? Number(e.amount) : -Number(e.amount);
                    return (
                      <tr key={e.id}
                          className={`border-b border-line/40 ${active ? "" : "opacity-40"}`}>
                        <td className="py-1.5 pr-2 sticky left-0 bg-bg-card">
                          <input type="checkbox" checked={active}
                                 onChange={() => toggleRow(e.id)}
                                 className="accent-accent" />
                        </td>
                        <td className="pr-4 sticky left-8 bg-bg-card">
                          <div className="text-slate-200">{e.title}</div>
                          <div className="text-[10px] text-slate-500">{e.entry_date}</div>
                        </td>
                        {range.map((k) => (
                          <td key={k}
                              className={`text-right tabular-nums px-3 ${
                                k === cellKey
                                  ? (signed >= 0 ? "text-accent" : "text-danger")
                                  : "text-slate-600"
                              }`}>
                            {k === cellKey ? signed.toFixed(2) : "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>{value.toFixed(2)}</div>
    </div>
  );
}
