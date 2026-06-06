import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EFEEEB", "paper-deep": "#E5E5E2", card: "#EFEEEB",
        ink: "#171511", "ink-soft": "#3A352D", clay: "#7A7A75", line: "#D9D9D6", "line-soft": "#E2E1DE",
        ember: "#B8552E", tomato: "#9A3122", basil: "#3E5A37", ochre: "#B5701C", olive: "#5A6B3B", amber: "#E4A94B",
        night: "#100F0C", "night-2": "#191712", "night-ink": "#F2ECDE",
      },
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        mono: ["DM Mono", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
