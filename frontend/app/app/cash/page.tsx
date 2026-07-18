"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/supabase";

type Entry = {
  id: string; kind: "income" | "expense"; title: string;
  category?: string | null; amount: number; entry_date: string;
  memo?: string | null; series_id?: string | null;
};
type Row = Entry & { occurrences: number; last_date?: string };
type Repeat = "never" | "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

const REPEATS: Repeat[] = ["never","daily","weekly","biweekly","monthly","quarterly","yearly"];

export default function CashPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState({
    kind: "income" as "income" | "expense",
    title: "", category: "", amount: "",
    entry_date: new Date().toISOString().slice(0, 10),
    memo: "",
    repeat: "never" as Repeat,
    end_on: "never" as "never" | "end_date",
    end_date: "",
  });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setEntries(await api<Entry[]>("/api/entries")); }
    catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.category) s.add(e.category);
    return Array.from(s).sort();
  }, [entries]);

  /* Collapse recurring series into one row per series_id. */
  const collapsedRows: Row[] = useMemo(() => {
    const bySeries = new Map<string, Entry[]>();
    const singles: Row[] = [];
    for (const e of entries) {
      if (e.series_id) {
        if (!bySeries.has(e.series_id)) bySeries.set(e.series_id, []);
        bySeries.get(e.series_id)!.push(e);
      } else {
        singles.push({ ...e, occurrences: 1 });
      }
    }
    const series: Row[] = [];
    for (const rows of bySeries.values()) {
      const sorted = [...rows].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      const first = sorted[0];
      series.push({
        ...first,
        occurrences: sorted.length,
        last_date: sorted[sorted.length - 1].entry_date,
      });
    }
    return [...series, ...singles].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  }, [entries]);

  const [editing, setEditing] = useState<Row | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const wantsEndDate = form.repeat !== "never" && form.end_on === "end_date";
    if (wantsEndDate && !form.end_date) {
      setErr("Please choose an end date.");
      return;
    }
    try {
      await api("/api/entries", {
        method: "POST",
        body: JSON.stringify({
          kind: form.kind,
          title: form.title,
          category: form.category || null,
          amount: Number(form.amount),
          entry_date: form.entry_date,
          memo: form.memo || null,
          repeat: form.repeat,
          end_date: wantsEndDate ? form.end_date : null,
        }),
      });
      setForm({ ...form, title: "", category: "", amount: "", memo: "",
                repeat: "never", end_on: "never", end_date: "" });
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function del(id: string) {
    await api(`/api/entries/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-4">Add entry</h2>
        <form onSubmit={add} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="col-span-1">
            <label className="label">Kind</label>
            <select className="input" value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as any })}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Title</label>
            <input className="input" required value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="col-span-1">
            <label className="label">Category</label>
            <CategoryCombo
              value={form.category}
              options={categories}
              onChange={(v) => setForm({ ...form, category: v })}
            />
          </div>
          <div className="col-span-1">
            <label className="label">Amount</label>
            <input className="input" type="number" step="0.01" required value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="col-span-1">
            <label className="label">Date</label>
            <input className="input date-white" type="date" required value={form.entry_date}
              onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </div>

          <div className="col-span-1">
            <label className="label">Repeat</label>
            <select className="input" value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value as Repeat })}>
              {REPEATS.map((r) => (
                <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </div>

          {form.repeat !== "never" && (
            <>
              <div className="col-span-1">
                <label className="label">End on</label>
                <select className="input" value={form.end_on}
                  onChange={(e) => setForm({ ...form, end_on: e.target.value as any })}>
                  <option value="never">Never</option>
                  <option value="end_date">End date</option>
                </select>
              </div>
              {form.end_on === "end_date" && (
                <div className="col-span-1">
                  <label className="label">End date</label>
                  <input className="input date-white" type="date" required
                    value={form.end_date}
                    min={form.entry_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              )}
            </>
          )}

          <div className="col-span-6">
            <label className="label">Memo</label>
            <input className="input" value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </div>

          <div className="col-span-6 flex justify-end">
            <button className="btn-primary px-6">Add</button>
          </div>
        </form>
        {err && <p className="text-danger text-sm mt-3">{err}</p>}
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-4">Entries</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-line">
              <tr>
                <th className="text-left py-2">Date</th>
                <th className="text-left">Kind</th>
                <th className="text-left">Title</th>
                <th className="text-left">Category</th>
                <th className="text-right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {collapsedRows.map((e) => (
                <tr key={e.id} className="border-b border-line/50">
                  <td className="py-2">
                    {e.entry_date}
                    {e.series_id && (
                      <div className="text-[10px] text-slate-500">
                        recurring · {e.occurrences} occurrences · through {e.last_date}
                      </div>
                    )}
                  </td>
                  <td className={e.kind === "income" ? "text-accent" : "text-danger"}>{e.kind}</td>
                  <td>{e.title}</td>
                  <td className="text-slate-400">{e.category || "—"}</td>
                  <td className="text-right tabular-nums">{Number(e.amount).toFixed(2)}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="text-slate-400 hover:text-white mr-3"
                      onClick={() => setEditing(e)}>edit</button>
                    <button className="text-slate-500 hover:text-danger"
                      onClick={() => del(e.id)} title={e.series_id ? "Delete series" : "Delete"}>×</button>
                  </td>
                </tr>
              ))}
              {collapsedRows.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-slate-500">No entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <EditModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function EditModal({ row, onClose, onSaved }: {
  row: Row; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    kind: row.kind, title: row.title, category: row.category || "",
    amount: String(row.amount), entry_date: row.entry_date, memo: row.memo || "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await api(`/api/entries/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          kind: f.kind,
          title: f.title,
          category: f.category || null,
          amount: Number(f.amount),
          entry_date: f.entry_date,
          memo: f.memo || null,
        }),
      });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={save}
            className="card p-5 w-full max-w-lg space-y-3">
        <div className="flex items-center">
          <h3 className="text-lg font-semibold">Edit entry</h3>
          {row.series_id && (
            <span className="ml-2 text-xs text-slate-400">
              (applies to all {row.occurrences} occurrences except the date)
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Kind</label>
            <select className="input" value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as any })}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div>
            <label className="label">Amount</label>
            <input className="input" type="number" step="0.01" required value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Title</label>
            <input className="input" required value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })} />
          </div>
          <div>
            <label className="label">Date {row.series_id && "(this occurrence)"}</label>
            <input className="input date-white" type="date" required value={f.entry_date}
              onChange={(e) => setF({ ...f, entry_date: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Memo</label>
            <input className="input" value={f.memo}
              onChange={(e) => setF({ ...f, memo: e.target.value })} />
          </div>
        </div>
        {err && <p className="text-danger text-sm">{err}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? "…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

function CategoryCombo({
  value, options, onChange,
}: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const q = value.trim().toLowerCase();
  const matches = options.filter((o) => o.toLowerCase().includes(q));
  const exact = options.some((o) => o.toLowerCase() === q);

  return (
    <div ref={ref} className="relative">
      <input
        className="input"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="e.g. Hosting"
      />
      {open && (matches.length > 0 || (q && !exact)) && (
        <div className="absolute z-10 mt-1 w-full card overflow-hidden max-h-52 overflow-y-auto">
          {matches.map((m) => (
            <button
              key={m}
              type="button"
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-bg-soft"
              onClick={() => { onChange(m); setOpen(false); }}
            >{m}</button>
          ))}
          {q && !exact && (
            <button
              type="button"
              className="block w-full text-left px-3 py-1.5 text-sm text-accent hover:bg-bg-soft border-t border-line"
              onClick={() => { onChange(value.trim()); setOpen(false); }}
            >+ Add “{value.trim()}”</button>
          )}
        </div>
      )}
    </div>
  );
}
