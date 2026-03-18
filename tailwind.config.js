const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#FFFFFF",
          surface: "#F8F9FA",
          "surface-alt": "#F0F1F3",
          border: "#E0E0E0",
        },
        accent: {
          primary: "#E20074",
          info: "#E20074",
          warning: "#E20074",
          danger: "#DC2626",
        },
        text: {
          primary: "#333333",
          muted: "#888888",
        },
        sidebar: {
          bg: "#1E293B",
          hover: "#334155",
          text: "#E2E8F0",
          dim: "#94A3B8",
          border: "#334155",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
}

export default config
