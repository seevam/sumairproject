/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A1628',
        surface: '#0D1117',
        accent: '#1DB954',
        'accent-dim': '#166B33',
        muted: '#6E7681',
        warn: '#F0A500',
        danger: '#CF222E',
        line: '#30363D',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { card: '12px', btn: '8px', input: '4px' },
    },
  },
  plugins: [],
}
