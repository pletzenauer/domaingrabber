import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: '#F06428',
        'accent-hover': '#D85520',
        dark: {
          bg: '#2B2B2B',
          card: '#363636',
          border: '#444444',
          text: '#E0E0E0',
          muted: '#999999',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
