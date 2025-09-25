/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./pages/**/*.{js,ts,jsx,tsx}",
      "./components/**/*.{js,ts,jsx,tsx}",
      "./lib/**/*.{js,ts,jsx,tsx}",
      "./utils/**/*.{js,ts,jsx,tsx}"
    ],
    theme: {
      extend: {},
    },
    plugins: [],
    // Add safelist to prevent purging issues
    safelist: [
      'bg-white/5',
      'bg-white/10',
      'bg-white/20',
      'text-white/60',
      'text-white/70',
      'text-white/80',
      'border-white/10',
      'border-white/20',
      'bg-cyan-300/20',
      'border-cyan-300',
      'text-cyan-300',
      'bg-black/90',
      'backdrop-blur-xl'
    ]
  };
  