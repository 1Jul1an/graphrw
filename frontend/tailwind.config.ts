import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1b1b1b",
        "mdn-dark-bg": "#18191b",
        "mdn-dark-surface": "#212426",
        "mdn-dark-border": "#51565d",
        "mdn-dark-text": "#f5f7fa",
        "mdn-dark-muted": "#b7bec6",
        slate: {
          25: "#fbfcfe",
          75: "#f3f6fb",
          150: "#e7edf5",
          250: "#ccd7e6",
          850: "#23314d",
          925: "#162033",
        },
        brand: {
          50: "#eef4ff",
          100: "#dce8ff",
          500: "#4267b2",
          600: "#315297",
          700: "#253f74",
        },
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.06), 0 18px 40px rgba(37, 63, 116, 0.08)",
      },
      maxWidth: {
        app: "none",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
