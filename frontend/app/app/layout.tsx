"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import GemmaPanel from "@/components/GemmaPanel";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/");
      else setReady(true);
    });
  }, [router]);

  if (!ready) return null;

  const tab = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-sm ${
        path?.startsWith(href) ? "bg-bg-soft text-white" : "text-slate-400 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-bg-soft">
        <div className="flex items-center gap-4 px-6 h-14">
          <div className="font-semibold">CashWise</div>
          <nav className="flex gap-1">
            {tab("/app/cash", "Cash")}
            {tab("/app/dashboard", "Dashboard")}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setChatOpen((v) => !v)}>
              {chatOpen ? "Hide Gemma" : "Ask Gemma"}
            </button>
            <button
              className="btn-ghost"
              onClick={async () => { await supabase.auth.signOut(); router.replace("/"); }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className={`px-6 py-6 ${chatOpen ? "pr-[27rem]" : ""}`}>
        <main className="max-w-5xl">{children}</main>
      </div>
      {chatOpen && (
        <div className="fixed top-16 right-4 z-50">
          <GemmaPanel />
        </div>
      )}
    </div>
  );
}
