/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Inter', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
      },
      colors: {
        background: '#f5f6f8',
        primary: {
          DEFAULT: '#0d59f2',
          content: '#ffffff',
        },
        surface: {
          DEFAULT: '#ffffff',
          dark: '#1a2230',
        },
        accent: {
          DEFAULT: '#f59e0b',
          glow: '#fbbf24',
        },
      },
      borderRadius: {
        DEFAULT: '1rem',
        lg: '1.5rem',
        xl: '2rem',
        '2xl': '2.5rem',
      },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(13, 89, 242, 0.08), 0 0 4px -2px rgba(0, 0, 0, 0.04)',
        glow: '0 0 20px -5px rgba(13, 89, 242, 0.3)',
      },
      animation: {
        'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
