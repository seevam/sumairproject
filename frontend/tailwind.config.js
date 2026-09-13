/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Green-tinted near-black, per the approved V1 mockup. This supersedes
        // the navy (#0A1628) named in the original PRD design system.
        bg: '#050A07',
        surface: '#0B120E',
        'surface-2': '#111A15',
        accent: '#4ADE80',
        'accent-strong': '#22C55E',
        'accent-deep': '#14532D',
        muted: '#7C8F85',
        warn: '#F0A500',
        danger: '#F04438',
        line: '#1C2A22',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { card: '16px', btn: '10px', input: '10px' },
      backgroundImage: {
        'accent-grad': 'linear-gradient(180deg, #5EE79B 0%, #2BBF6B 100%)',
      },
    },
  },
  plugins: [],
}
