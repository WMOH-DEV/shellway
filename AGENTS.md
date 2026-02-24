# AGENTS.md — Shellway

## Project Overview

Shellway is a cross-platform SSH & SFTP desktop client built with **Electron + React + TypeScript**. It uses a custom title bar (frameless window), Zustand for state, Tailwind CSS for styling, and xterm.js for terminals. The app also includes an SQL client (MySQL/PostgreSQL over SSH tunnels), port forwarding, and host/client key management.

## Architecture

```
electron/              # Main process (Node.js)
  main.ts              # App entry, window creation, IPC handlers
  preload.ts           # Context bridge → window.novadeck API
  ipc/                 # IPC handler modules (one per domain: ssh.ipc.ts, sftp.ipc.ts, etc.)
  services/            # Business logic services (SSHService, SFTPService, TransferQueue, etc.)
  utils/               # Node-side utilities (encryption, platform detection)
src/                   # Renderer process (React)
  main.tsx             # React entry point
  App.tsx              # Root component, IPC event listeners
  components/          # UI components organized by feature
    ui/                # Reusable primitives (Button, Modal, Input, Toast, etc.)
    connection/        # SSH connection components
    sftp/              # SFTP file browser
    terminal/          # Terminal wrapper (xterm.js)
    sql/               # SQL client UI
    settings/          # App settings
    layout/            # AppShell, sidebar, tab bar
  stores/              # Zustand stores (connectionStore, sessionStore, uiStore, etc.)
  types/               # Shared TypeScript type definitions
  hooks/               # Custom React hooks (useTheme, useSession, useKeyboardShortcuts)
  utils/               # Renderer-side utilities (cn, fileSize, permissions, etc.)
  data/                # Static data (terminal themes, session templates)
```

## Build / Dev / Lint Commands

```bash
npm run dev            # Start Electron in dev mode (hot-reload renderer)
npm run build          # Build main + preload + renderer for production
npm run preview        # Preview built app
npm run typecheck      # Type-check both renderer (tsconfig.web.json) and main (tsconfig.node.json)
npm run lint           # ESLint with auto-fix (.ts, .tsx)

npm run dist:mac       # Build + package macOS DMG
npm run dist:win       # Build + package Windows NSIS installer
npm run dist:all       # Build + package all platforms
```

**No test framework is configured.** There are no test files, no test runner (vitest/jest), and no test scripts. If adding tests, use vitest (already compatible with the Vite toolchain).

## TypeScript Configuration

- **Strict mode** enabled in both `tsconfig.web.json` and `tsconfig.node.json`
- **Module**: ESNext with bundler resolution
- **Target**: ESNext
- **Path alias**: `@/*` → `src/*` (renderer only). Use `@/` imports in all renderer code.
- Electron code imports shared types via relative paths: `../../src/types/session`
- Build-time define: `__APP_VERSION__` (from package.json)

## Code Style & Conventions

### Imports

- Use `@/` path alias for all renderer imports (e.g., `import { cn } from '@/utils/cn'`)
- Use `type` imports for type-only usage: `import type { Session } from '@/types/session'`
- Order: React/external libs → `@/` project imports → relative imports
- Electron main process uses relative imports (no path alias)

### Components

- **Functional components only** — no class components
- Named exports for components: `export function WelcomeScreen() {}`
- Exception: `forwardRef` components use `export const Button = forwardRef<...>(...)`
- Components that use `forwardRef` must set `.displayName`
- Props interfaces defined inline above the component, not exported unless shared
- Use `cn()` utility (clsx + tailwind-merge) for conditional/merged class names

### State Management

- **Zustand** for all shared state — one store per domain (connectionStore, sessionStore, uiStore, etc.)
- Store pattern: `create<TypedState>((set) => ({ ... }))`
- Access outside React: `useConnectionStore.getState()`
- Exported as named hooks: `export const useConnectionStore = create<...>(...)`

### Naming Conventions

- **Files**: PascalCase for components (`WelcomeScreen.tsx`), camelCase for everything else (`connectionStore.ts`, `cn.ts`)
- **Types/Interfaces**: PascalCase (`ConnectionTab`, `FileEntry`, `AuthMethod`)
- **Type aliases for unions**: PascalCase (`type ConnectionStatus = 'connected' | 'error' | ...`)
- **Variables/functions**: camelCase (`handleHostKeyCancel`, `addTab`)
- **Constants**: camelCase for objects, UPPER_SNAKE_CASE not used
- **IPC channels**: `domain:action` format (`ssh:connect`, `sftp:readdir`, `settings:getAll`)
- **IPC files**: `domain.ipc.ts` (e.g., `ssh.ipc.ts`, `sftp.ipc.ts`)
- **Service files**: PascalCase class name (`SSHService.ts`, `SFTPService.ts`)

### Styling

- **Tailwind CSS** for all styling — no CSS modules or styled-components
- Custom design token system via CSS variables (`--nd-bg-primary`, `--nd-accent`, etc.)
- Tailwind classes reference tokens: `bg-nd-bg-primary`, `text-nd-text-secondary`, `border-nd-border`
- Dark mode is default; light mode via `.light` class on `<html>`
- Use the `cn()` helper for merging Tailwind classes: `cn('base-class', condition && 'conditional-class')`
- Font: Inter (sans), JetBrains Mono (mono)
- Custom animations defined in `tailwind.config.ts`: `animate-fade-in`, `animate-slide-up`, etc.

### IPC / Electron Patterns

- All renderer↔main communication goes through `window.novadeck` (defined in `preload.ts`)
- IPC handlers use `ipcMain.handle()` for request/response, `ipcRenderer.on()` for events
- Event listeners return unsubscribe functions: `const unsub = window.novadeck.ssh.onStatusChange(...); return unsub`
- IPC registration is modular: each `ipc/*.ipc.ts` exports a `registerXxxIPC()` function called from `main.ts`
- Services are singleton instances created at module level or via getter functions

### Error Handling

- Main process: try/catch with error messages returned as `{ success: boolean; error?: string }`
- Renderer: `.catch()` on IPC calls, `console.warn()` for non-critical failures
- Toast notifications for user-facing errors: `toast.error('Title', 'Message')`
- Silent catches (`catch {}`) used only for non-critical fallbacks (e.g., key resolution)

### Types

- Shared types live in `src/types/` — imported by both renderer and electron code
- Use `interface` for object shapes, `type` for unions and aliases
- Prefer explicit types over `any` — use `unknown` when type is genuinely dynamic
- JSDoc comments on exported interfaces and important functions: `/** Description */`

### UI Components (src/components/ui/)

- Reusable primitives: Button, Modal, Input, Select, Toast, Tooltip, Tabs, etc.
- Button variants: `primary`, `secondary`, `ghost`, `danger`, `outline`
- Button sizes: `sm`, `md`, `lg`, `icon`
- Icons from `lucide-react` — import individually: `import { Plus, Settings } from 'lucide-react'`
- Animations via `framer-motion` for modals and transitions

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `electron` / `electron-vite` | Desktop shell + build tooling |
| `react` 18 / `react-dom` | UI framework |
| `zustand` | State management |
| `ssh2` | SSH/SFTP protocol |
| `@xterm/xterm` | Terminal emulator |
| `@monaco-editor/react` | Code/SQL editor |
| `ag-grid-react` | Data grid (SQL results, SFTP file list) |
| `tailwindcss` 3 | Utility-first CSS |
| `framer-motion` | Animations |
| `lucide-react` | Icons |
| `clsx` + `tailwind-merge` | Class name utilities (via `cn()`) |
| `mysql2` / `pg` | Database drivers |
| `electron-store` | Persistent JSON storage (main process) |
| `socks` | SOCKS proxy support |

## Gotchas

- The preload API is on `window.novadeck` (not `window.electron` or `window.api`)
- `sandbox: true` and `contextIsolation: true` — never use `nodeIntegration`
- Connection tabs are always rendered (hidden via CSS `hidden` class) to preserve terminal/SFTP state
- The `@/` path alias only works in renderer code; electron code uses relative paths
- No test runner is configured — if you need to verify logic, use `npm run typecheck`
- CSS variables use space-separated RGB channels (e.g., `15 17 23`) for Tailwind alpha support

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
