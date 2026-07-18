"use client";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (session) headers.set("authorization", `Bearer ${session.access_token}`);

  // BYOK: forward the user's provider / key / model settings if they've picked one.
  if (typeof window !== "undefined") {
    const provider = localStorage.getItem("llm_provider");
    const key = localStorage.getItem("llm_api_key");
    const model = localStorage.getItem("llm_model");
    if (provider) headers.set("x-llm-provider", provider);
    if (key) headers.set("x-llm-key", key);
    if (model) headers.set("x-llm-model", model);
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
