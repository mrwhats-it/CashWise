"""LLM client with prompt-based tool calling.

Supports two providers, both driven by the same JSON-action protocol:

  - "ollama"  -> local Ollama /api/chat with format=json (default)
  - "groq"    -> Groq's OpenAI-compatible /chat/completions

The frontend picks the provider per-request via the `x-llm-provider` header.
When provider=groq, the user's API key is sent as `x-llm-key`.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any

import httpx

from .config import settings
from .db import user_client


SYSTEM_INSTRUCTION = """You are Gemma, an SME cash-flow copilot. Be concise and numeric.

You have access to tools. On every turn you MUST reply with EXACTLY ONE JSON object and NOTHING ELSE. Pick one of these shapes:

Chat back to the user (final answer for this turn):
    {"action":"reply","text":"<what you say to the user>"}

Read entries:
    {"action":"list_entries","args":{"kind":"income"|"expense"|null,"since":"YYYY-MM-DD"|null}}

Summarize monthly income / expense / net:
    {"action":"summarize_cashflow","args":{"months":6}}

Add an entry. Required: kind, title, amount (positive), entry_date.
Optional: category, memo, repeat, end_date. If repeat != "never" and end_date
is omitted the backend caps at 12 months.
    {"action":"add_entry","args":{"kind":"expense","title":"Hosting","amount":500,"entry_date":"2026-07-18","category":"Hosting","memo":null,"repeat":"never","end_date":null}}

Hide or show rows in the on-screen worksheet (does NOT delete data):
    {"action":"toggle_entries","args":{"entry_ids":["..."],"active":false}}

Ask the user to confirm an inferred entry (used when a field is missing/ambiguous):
    {"action":"needs_confirmation","draft":{"kind":"expense","title":"...","amount":0,"entry_date":"YYYY-MM-DD","category":null,"memo":null,"repeat":"never","end_date":null}}

Rules:
- Output ONLY the JSON object. No markdown, no prose, no explanation.
- If the user message starts with "TOOL_RESULT:" it means you called a tool
  and this is the result. Read it, then decide what to do next.
- When you have enough info to answer, emit {"action":"reply", ...}.
- Do not keep calling the same tool in a loop.
"""


VALID_ACTIONS = {
    "reply", "list_entries", "add_entry", "summarize_cashflow",
    "toggle_entries", "needs_confirmation",
}


# --------------------------- tool executor --------------------------- #

def _run_tool(action: str, args: dict, user: dict) -> Any:
    db = user_client(user["token"])

    if action == "list_entries":
        q = db.table("entries").select("*").eq("user_id", user["id"])
        if kind := args.get("kind"):
            q = q.eq("kind", kind)
        if since := args.get("since"):
            q = q.gte("entry_date", since)
        return (q.execute().data) or []

    if action == "add_entry":
        from datetime import date as _date
        from .recurrence import expand_dates
        import uuid as _uuid
        start = _date.fromisoformat(args["entry_date"])
        end_raw = args.get("end_date")
        end = _date.fromisoformat(end_raw) if end_raw else None
        repeat = args.get("repeat", "never")
        dates = expand_dates(start, repeat, end)
        series_id = str(_uuid.uuid4()) if repeat != "never" else None
        rows = [
            {
                "user_id": user["id"],
                "kind": args["kind"],
                "title": args["title"],
                "amount": float(args["amount"]),
                "entry_date": d.isoformat(),
                "category": args.get("category"),
                "memo": args.get("memo"),
                "series_id": series_id,
            }
            for d in dates
        ]
        res = db.table("entries").insert(rows).execute()
        return {"inserted": len(res.data or []), "rows": res.data or []}

    if action == "summarize_cashflow":
        months = int(args.get("months", 6))
        since = (date.today().replace(day=1) - timedelta(days=months * 31)).isoformat()
        rows = (
            db.table("entries")
            .select("kind,amount,entry_date")
            .eq("user_id", user["id"])
            .gte("entry_date", since)
            .execute()
            .data
        ) or []
        buckets: dict[str, dict[str, float]] = {}
        for r in rows:
            m = r["entry_date"][:7]
            b = buckets.setdefault(m, {"income": 0.0, "expense": 0.0})
            b[r["kind"]] += float(r["amount"])
        return [
            {"month": m, **v, "net": v["income"] - v["expense"]}
            for m, v in sorted(buckets.items())
        ]

    if action == "toggle_entries":
        return {
            "ui_action": "toggle_entries",
            "entry_ids": args.get("entry_ids", []),
            "active": bool(args.get("active", True)),
        }

    return {"error": f"unknown action {action}"}


# --------------------------- shared helpers --------------------------- #

def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    t = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    depth = 0; start = -1
    for i, ch in enumerate(t):
        if ch == "{":
            if depth == 0: start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    return json.loads(t[start:i+1])
                except Exception:
                    start = -1
    return None


# --------------------------- providers --------------------------- #

def _ollama_call(model: str, messages: list[dict], url: str) -> str:
    try:
        res = httpx.post(
            f"{url.rstrip('/')}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.2},
            },
            timeout=120.0,
        )
    except httpx.ConnectError as e:
        raise RuntimeError(
            f"Can't reach Ollama at {url}. Is `ollama serve` running? ({e})"
        )
    if res.status_code == 404:
        raise RuntimeError(
            f"Ollama model {model!r} not found. Try: ollama pull {model}"
        )
    res.raise_for_status()
    return (res.json().get("message") or {}).get("content", "")


def _groq_call(model: str, messages: list[dict], api_key: str, base_url: str) -> str:
    """Groq is OpenAI-compatible. Prefer response_format=json_object; some
    models (a few Qwen variants) reject it — fall back to a plain call."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}

    def _post(body: dict) -> httpx.Response:
        try:
            return httpx.post(url, headers=headers, json=body, timeout=60.0)
        except httpx.ConnectError as e:
            raise RuntimeError(f"Can't reach Groq at {base_url}: {e}")

    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    res = _post(body)

    # Some models (Qwen especially) either reject json_object mode outright
    # or emit reasoning text around the JSON that Groq's strict validator
    # then rejects. Retry once without the response_format so `_safe_json`
    # can extract the JSON block from raw output.
    if res.status_code == 400:
        body_text = (res.text or "").lower()
        if ("response_format" in body_text
                or "failed to validate json" in body_text
                or "json_object" in body_text):
            body.pop("response_format", None)
            res = _post(body)

    if res.status_code == 401:
        raise RuntimeError("Groq rejected the API key (401). Check the key in Settings.")
    if res.status_code == 404:
        raise RuntimeError(
            f"Groq doesn't have model {model!r}. Check console.groq.com/docs/models."
        )
    if res.status_code >= 400:
        # Surface Groq's actual error message so debugging is possible.
        try:
            detail = res.json().get("error", {}).get("message") or res.text
        except Exception:
            detail = res.text
        raise RuntimeError(f"Groq {res.status_code}: {detail}")

    data = res.json()
    return data["choices"][0]["message"]["content"]


# --------------------------- top-level chat loop --------------------------- #

def chat(
    messages: list[dict],
    user: dict,
    provider: str = "ollama",
    api_key: str | None = None,
    model_name: str | None = None,
) -> dict:
    """Run a chat turn. `provider` is 'ollama' or 'groq'.

    - ollama : uses OLLAMA_URL + `model_name` (or OLLAMA_MODEL default).
    - groq   : uses `api_key` (or GROQ_API_KEY default) + `model_name`
               (defaults to qwen/qwen3-32b).
    """
    provider = (provider or "ollama").lower()

    convo: list[dict] = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
    for m in messages:
        convo.append({
            "role": "user" if m["role"] == "user" else "assistant",
            "content": m["content"],
        })

    tool_log: list[dict] = []

    def call_llm() -> str:
        if provider == "groq":
            key = (api_key or settings.groq_api_key or "").strip()
            if not key:
                raise RuntimeError(
                    "No Groq API key. Add one in the Gemma panel Settings, "
                    "or set GROQ_API_KEY on the server."
                )
            model = (model_name or settings.groq_model).strip()
            return _groq_call(model, convo, key, settings.groq_base_url)
        # ollama
        model = (model_name or settings.ollama_model).strip()
        return _ollama_call(model, convo, settings.ollama_url)

    for _ in range(5):
        raw = call_llm()
        parsed = _safe_json(raw)

        if not parsed or "action" not in parsed:
            return {"reply": raw or "(no reply)", "tool_calls": tool_log}

        action = parsed.get("action")

        if action == "reply":
            return {"reply": parsed.get("text", ""), "tool_calls": tool_log}

        if action == "needs_confirmation":
            return {
                "reply": json.dumps({
                    "needs_confirmation": True,
                    "draft": parsed.get("draft", {}),
                }),
                "tool_calls": tool_log,
            }

        if action not in VALID_ACTIONS:
            convo.append({"role": "assistant", "content": raw})
            convo.append({"role": "user", "content":
                f"TOOL_RESULT: unknown action {action!r}. "
                f"Please emit one of {sorted(VALID_ACTIONS)}."})
            continue

        args = parsed.get("args") or {}
        try:
            result = _run_tool(action, args, user)
        except Exception as e:
            result = {"error": str(e)}
        tool_log.append({"name": action, "args": args, "result": result})

        convo.append({"role": "assistant", "content": raw})
        convo.append({"role": "user",
                      "content": "TOOL_RESULT: " + json.dumps(result, default=str)})

    return {
        "reply": "Sorry — I couldn't finish that in a few tool calls. Try rephrasing?",
        "tool_calls": tool_log,
    }


def _safe_json(raw: str) -> dict | None:
    try:
        return json.loads(raw)
    except Exception:
        return _extract_json(raw)
