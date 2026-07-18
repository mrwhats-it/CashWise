"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/supabase";
import { emitToggle } from "@/lib/toggleBus";

type Msg = { role: "user" | "assistant"; content: string };
type Repeat = "never" | "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
type Draft = {
  kind: "income" | "expense"; title: string; amount: number;
  entry_date: string; category?: string | null; memo?: string | null;
  repeat?: Repeat; end_date?: string | null;
};

export default function GemmaPanel() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi — I'm Gemma. Ask me about your cash flow, or say something like \"log $500 hosting expense today\"." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState<"ollama" | "groq">("ollama");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");

  useEffect(() => {
    setProvider((localStorage.getItem("llm_provider") as any) || "ollama");
    setApiKey(localStorage.getItem("llm_api_key") || "");
    setModelName(localStorage.getItem("llm_model") || "");
  }, []);

  function saveKey() {
    localStorage.setItem("llm_provider", provider);
    if (apiKey) localStorage.setItem("llm_api_key", apiKey);
    else localStorage.removeItem("llm_api_key");
    if (modelName) localStorage.setItem("llm_model", modelName);
    else localStorage.removeItem("llm_model");
    setShowSettings(false);
  }

  async function send() {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user" as const, content: input }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const r = await api<{ reply: string; tool_calls: any[] }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: next }),
      });

      // Surface any UI-side effects from tools (toggle_entries).
      for (const tc of r.tool_calls || []) {
        const res = tc?.result;
        if (res?.ui_action === "toggle_entries") {
          emitToggle({ entryIds: res.entry_ids || [], active: !!res.active });
        }
      }

      // Detect a draft the model asked us to confirm
      const parsedDraft = tryParseDraft(r.reply);
      if (parsedDraft) setDraft(parsedDraft);
      setMessages([...next, { role: "assistant", content: parsedDraft ? "I need a quick confirmation below." : r.reply }]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally { setBusy(false); }
  }

  async function confirmDraft(accepted: boolean) {
    if (!draft) return;
    try {
      await api("/api/chat/confirm-inference", {
        method: "POST",
        body: JSON.stringify({ ...draft, accepted }),
      });
      setMessages((m) => [...m, {
        role: "assistant",
        content: accepted ? `Saved: ${draft.kind} ${draft.title} $${draft.amount} on ${draft.entry_date}.` : "Discarded.",
      }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Save failed: ${e.message}` }]);
    } finally { setDraft(null); }
  }

  return (
    <aside className="card w-96 shrink-0 flex flex-col h-[calc(100vh-6rem)] shadow-2xl">
      <div className="p-4 border-b border-line flex items-center">
        <span className="font-semibold">Gemma</span>
        <span className="ml-2 text-[10px] text-slate-500 uppercase">
          {provider === "groq" ? "Groq" : "Local Ollama"}
        </span>
        <button
          className="ml-auto text-xs text-slate-400 hover:text-white"
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? "Close" : "Settings"}
        </button>
      </div>

      {showSettings && (
        <div className="p-4 border-b border-line space-y-3 bg-bg-soft">
          <div>
            <label className="label">Provider</label>
            <div className="flex gap-1 bg-bg-card border border-line rounded-md p-1">
              {(["ollama","groq"] as const).map((p) => (
                <button key={p} type="button"
                  onClick={() => setProvider(p)}
                  className={`flex-1 px-3 py-1 rounded text-xs capitalize ${
                    provider === p ? "bg-accent text-black" : "text-slate-400 hover:text-white"
                  }`}>
                  {p === "ollama" ? "Local (Ollama)" : "Groq (cloud)"}
                </button>
              ))}
            </div>
          </div>

          {provider === "groq" && (
            <div>
              <label className="label">Groq API key</label>
              <input className="input" type="password" placeholder="gsk_…"
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <p className="text-[11px] text-slate-500 mt-1">
                Get one at console.groq.com/keys — free tier, fast.
              </p>
            </div>
          )}

          <div>
            <label className="label">Model {provider === "ollama" ? "(Ollama tag)" : "(Groq id)"}</label>
            <input className="input"
              placeholder={provider === "ollama" ? "gemma4:e2b" : "qwen/qwen3-32b"}
              value={modelName} onChange={(e) => setModelName(e.target.value)} />
            <p className="text-[11px] text-slate-500 mt-1">
              {provider === "ollama"
                ? "Must be a model you've pulled locally (ollama pull <tag>)."
                : "e.g. qwen/qwen3-32b, llama-3.3-70b-versatile"}
            </p>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={saveKey}>Save</button>
            <button
              className="btn-ghost flex-1"
              onClick={() => {
                setApiKey(""); setModelName(""); setProvider("ollama");
                localStorage.removeItem("llm_api_key");
                localStorage.removeItem("llm_model");
                localStorage.removeItem("llm_provider");
              }}
            >Clear</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-slate-200" : "text-slate-300"}>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{m.role}</div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {draft && (
          <div className="card p-3 mt-2 border-accent/40">
            <div className="text-xs text-slate-400 mb-2">Confirm this entry?</div>
            <DraftForm draft={draft} onChange={setDraft} />
            <div className="flex gap-2 mt-3">
              <button className="btn-primary flex-1" onClick={() => confirmDraft(true)}>Save</button>
              <button className="btn-ghost flex-1" onClick={() => confirmDraft(false)}>Discard</button>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-line flex gap-2">
        <input
          className="input"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={busy ? "Thinking…" : "Ask Gemma…"}
        />
        <button className="btn-primary" onClick={send} disabled={busy}>Send</button>
      </div>
    </aside>
  );
}

function DraftForm({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const upd = (k: keyof Draft, v: any) => onChange({ ...draft, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div>
        <label className="label">Kind</label>
        <select className="input" value={draft.kind} onChange={(e) => upd("kind", e.target.value)}>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
      </div>
      <div>
        <label className="label">Amount</label>
        <input className="input" type="number" step="0.01" value={draft.amount}
          onChange={(e) => upd("amount", Number(e.target.value))} />
      </div>
      <div className="col-span-2">
        <label className="label">Title</label>
        <input className="input" value={draft.title} onChange={(e) => upd("title", e.target.value)} />
      </div>
      <div>
        <label className="label">Date</label>
        <input className="input" type="date" value={draft.entry_date}
          onChange={(e) => upd("entry_date", e.target.value)} />
      </div>
      <div>
        <label className="label">Category</label>
        <input className="input" value={draft.category || ""}
          onChange={(e) => upd("category", e.target.value)} />
      </div>
      <div>
        <label className="label">Repeat</label>
        <select className="input" value={draft.repeat || "never"}
          onChange={(e) => upd("repeat", e.target.value)}>
          {["never","daily","weekly","biweekly","monthly","quarterly","yearly"].map((r) =>
            <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {draft.repeat && draft.repeat !== "never" && (
        <div className="col-span-2">
          <label className="label">End date</label>
          <input className="input date-white" type="date" value={draft.end_date || ""}
            onChange={(e) => upd("end_date", e.target.value)} />
        </div>
      )}
    </div>
  );
}

function tryParseDraft(text: string): Draft | null {
  const match = text.match(/\{[\s\S]*"needs_confirmation"[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (obj.needs_confirmation && obj.draft) return obj.draft as Draft;
  } catch { /* ignore */ }
  return null;
}
