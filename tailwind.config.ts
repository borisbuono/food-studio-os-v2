import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FBF8F2", "paper-deep": "#F2ECE0", card: "#FBF6EC",
        ink: "#171511", "ink-soft": "#3A352D", clay: "#9C9282", line: "#E6DECF",
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
