/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          // rgb channels so opacity modifiers (bg-primary/10, ring-primary/15) work; plain var() drops them.
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        elevated: 'var(--elevated)',
        success: '#1a7f37',
        warning: '#bf8700',
        danger: '#cf222e',
        /* legacy aliases — migrate away */
        canvas: 'var(--elevated)',
        paper: 'var(--card)',
        line: 'var(--border)',
        ink: 'var(--foreground)',
        mute: 'var(--muted-foreground)',
        faint: 'var(--muted-foreground)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
        hand: ['Caveat', '"Comic Sans MS"', 'cursive'],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
        sm: '6px',
        button: '13px',
        DEFAULT: 'var(--radius)',
      },
      spacing: {
        7: '28px',
        9: '36px',
        gutter: '22px',
      },
      zIndex: {
        nav: '50',
        overlay: '70',
      },
      transitionDuration: {
        micro: '150ms',
        DEFAULT: '200ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      animation: {
        'cursor-blink': 'blink 1s step-end infinite',
        'fade-up': 'fadeUp 0.2s cubic-bezier(0.4, 0, 0.2, 1) both',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
