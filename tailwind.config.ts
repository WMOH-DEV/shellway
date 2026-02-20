import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nd: {
          bg: {
            primary: 'rgb(var(--nd-bg-primary) / <alpha-value>)',
            secondary: 'rgb(var(--nd-bg-secondary) / <alpha-value>)',
            tertiary: 'rgb(var(--nd-bg-tertiary) / <alpha-value>)'
          },
          surface: {
            DEFAULT: 'rgb(var(--nd-surface) / <alpha-value>)',
            hover: 'rgb(var(--nd-surface-hover) / <alpha-value>)'
          },
          border: {
            DEFAULT: 'rgb(var(--nd-border) / <alpha-value>)',
            hover: 'rgb(var(--nd-border-hover) / <alpha-value>)'
          },
          text: {
            primary: 'rgb(var(--nd-text-primary) / <alpha-value>)',
            secondary: 'rgb(var(--nd-text-secondary) / <alpha-value>)',
            muted: 'rgb(var(--nd-text-muted) / <alpha-value>)'
          },
          accent: {
            DEFAULT: 'rgb(var(--nd-accent) / <alpha-value>)',
            hover: 'rgb(var(--nd-accent-hover) / <alpha-value>)'
          },
          success: 'rgb(var(--nd-success) / <alpha-value>)',
          warning: 'rgb(var(--nd-warning) / <alpha-value>)',
          error: 'rgb(var(--nd-error) / <alpha-value>)',
          info: 'rgb(var(--nd-info) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif'
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }]
      },
      borderRadius: {
        DEFAULT: '6px'
      },
      spacing: {
        sidebar: '260px',
        'sidebar-collapsed': '48px',
        tabbar: '40px',
        statusbar: '28px',
        'transfer-queue': '200px'
      },
      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        'fade-out': 'fadeOut 150ms ease-in',
        'slide-in-right': 'slideInRight 200ms ease-out',
        'slide-in-left': 'slideInLeft 200ms ease-out',
        'slide-up': 'slideUp 200ms ease-out',
        'scale-in': 'scaleIn 150ms ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' }
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        }
      }
    }
  },
  plugins: []
}

export default config
