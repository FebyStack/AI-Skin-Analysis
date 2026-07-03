/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clinical: { DEFAULT: "#0f766e", soft: "#f0fdfa" },
        warm: { surface: "#fffdf9", border: "#ede5d8" },
        flag: "#f59e0b",
      },
    },
  },
  plugins: [],
};
