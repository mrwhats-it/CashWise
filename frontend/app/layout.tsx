import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cashwise — SME Cashflow Copilot",
  description: "AI-powered cash flow forecasting for small businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
