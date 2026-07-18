import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#0b0f14", soft: "#121821", card: "#161d27" },
        line: "#232c39",
        accent: "#22c55e",
        danger: "#ef4444",
      },
    },
  },
  plugins: [],
};
export default config;
