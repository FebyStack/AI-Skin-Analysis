/** @type {import('tailwindcss').Config} */
export default {
  content: ["./frontend/index.html", "./frontend/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Apple dark + champagne gold — see DESIGN.md §2
        canvas: "#0B0B0D",
        surface: { DEFAULT: "#161619", raised: "#1F1F23" },
        ink: { DEFAULT: "#F5F5F7", secondary: "#A1A1A6", tertiary: "#6E6E73" },
        gold: { DEFAULT: "#C9A24B", bright: "#E4C36B", ink: "#141210" },
        hairline: { DEFAULT: "rgba(255,255,255,0.10)", strong: "rgba(255,255,255,0.16)" },
        urgent: { DEFAULT: "#FF6B60", surface: "rgba(255,69,58,0.14)", edge: "rgba(255,69,58,0.34)" },
        soon: { DEFAULT: "#FFA23A", surface: "rgba(255,159,64,0.14)", edge: "rgba(255,159,64,0.32)" },
        routine: { DEFAULT: "#C7C7CC", surface: "rgba(255,255,255,0.05)", edge: "rgba(255,255,255,0.12)" },
        // legacy tokens kept so out-of-scope screens still build until they're migrated
        clinical: { DEFAULT: "#0E7C74", soft: "#0f766e" },
        warm: { surface: "#161619", border: "rgba(255,255,255,0.10)" },
        flag: "#FFA23A",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Brand/display only (wordmark, hero) — high-contrast Didone, native on Apple. Never body UI.
        serif: ['Didot', '"Bodoni 72"', '"Hoefler Text"', '"Playfair Display"', 'serif'],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.4), 0 8px 30px rgba(0,0,0,0.35)",
        thumb: "0 1px 2px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.35)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        rise: "rise 320ms cubic-bezier(0.32,0.72,0,1) both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
