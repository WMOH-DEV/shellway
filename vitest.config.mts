import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import pkg from './package.json'

const alias = { '@': resolve(import.meta.dirname, 'src') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'electron/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        define: { __APP_VERSION__: JSON.stringify(pkg.version) },
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'electron/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.tsx'
      ]
    }
  }
})
