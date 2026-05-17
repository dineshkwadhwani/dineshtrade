/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}','./components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT:'#c9a84c', light:'#e8c97a', pale:'#f5e9c8', dark:'#8a6a1a' },
        obsidian: { DEFAULT:'#080604', '2':'#100e0a', '3':'#1a1610' },
        up: { DEFAULT:'#52b788', dark:'#2d6a4f' },
        dn: { DEFAULT:'#e05a5e', dark:'#9b2226' },
      },
      fontFamily: {
        serif: ['var(--font-cormorant)', 'Georgia', 'serif'],
        sans:  ['var(--font-outfit)',    'system-ui', 'sans-serif'],
        mono:  ['var(--font-jetbrains)', 'monospace'],
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        'ticker':    'ticker 30s linear infinite',
        'fade-up':   'fade-up 0.5s ease forwards',
      },
      keyframes: {
        'pulse-dot': { '0%,100%':{ opacity:'1' }, '50%':{ opacity:'0.3' } },
        'ticker':    { '0%':{ transform:'translateX(0)' }, '100%':{ transform:'translateX(-50%)' } },
        'fade-up':   { 'from':{ opacity:'0', transform:'translateY(12px)' }, 'to':{ opacity:'1', transform:'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
