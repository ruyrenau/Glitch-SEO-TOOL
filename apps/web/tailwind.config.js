/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        glitch: {
          primary: '#5E5CE6',
          secondary: '#6366F1',
          bg: '#EEF0F8',
          card: '#FFFFFF',
          darkBg: '#121420',
          darkCard: '#1E2132',
          muted: '#8E95A5',
          accent: '#FF7597',
          mint: '#10B981'
        }
      },
      borderRadius: {
        '3xl': '24px',
        '4xl': '32px'
      },
      boxShadow: {
        'soft': '0 10px 30px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)',
        'float': '0 20px 40px rgba(94, 92, 230, 0.12)'
      }
    },
  },
  plugins: [],
};
