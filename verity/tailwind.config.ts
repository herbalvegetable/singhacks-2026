import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#061A3D",
        slate: "#1B3A6F",
        bronze: "#F6C453",
        grounded: "#00B894",
        "risk-mid": "#FF9F43",
        "risk-high": "#FF4D6D",
        opportunity: "#7ED957",
        bg: "#EEF7FF",
        "bg-dark": "#0B1020",
        ink: "#162033",
        "ink-inv": "#FFFFFF",
        aqua: "#27DDEB",
        violet: "#8B5CF6",
        lagoon: "#0EA5E9",
      },
      fontVariantNumeric: {
        tabular: "tabular-nums",
      },
    },
  },
  plugins: [],
} satisfies Config;
