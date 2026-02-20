# Shellway

**Premium cross-platform SSH & SFTP desktop client built with Electron, React, and TypeScript.**

Shellway is a modern, feature-rich SSH/SFTP client inspired by industry leaders like Bitvise SSH Client, offering a polished dark-themed UI, encrypted credential storage, multi-session management, and powerful terminal + file transfer capabilities — all in a single native desktop application for Windows, macOS, and Linux.

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development](#development)
- [Building Installers](#building-installers)
  - [Windows](#windows-installer)
  - [macOS](#macos-installer)
  - [Linux](#linux-installer)
  - [All Platforms](#all-platforms-at-once)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Security](#security)
- [License](#license)

---

## Features

### Session Management

- **Session Profiles** — Save, organize, and group SSH sessions with names, colors, icons, and notes
- **Session Groups** — Organize sessions into logical groups for quick filtering
- **Quick Launch Buttons** — One-click buttons on session cards to open Terminal, SFTP, or both simultaneously
- **Per-Session Setting Overrides** — Override global terminal, SFTP, SSH, and proxy settings on a per-session basis
- **Structured Startup Commands** — Define ordered post-connect commands with delays and enable/disable toggles
- **Import / Export** — Share session profiles (secrets are stripped on export)

### Authentication

- **Password** — Standard password authentication (encrypted at rest)
- **Public Key** — RSA, Ed25519, ECDSA key files with optional passphrase
- **Public Key + Password** — Combined two-factor authentication
- **Keyboard-Interactive (KBDI)** — Full support for server challenge prompts with auto-respond from saved responses
- **GSSAPI / Kerberos** — Enterprise SSO with optional credential delegation
- **SSH Agent Forwarding** — Forward local SSH agent to the remote host
- **None** — For servers that allow passwordless connections

### Terminal

- **xterm.js-based Terminal** — Full-featured terminal emulator with 256-color support
- **Multiple Terminal Tabs** — Open multiple shells per connection
- **Customizable Appearance** — Font family, font size, line height, cursor style, color scheme
- **Scrollback Buffer** — Configurable scrollback lines (default 5,000)
- **Copy on Select** — Optional automatic clipboard copy
- **Right-Click Paste** — Optional paste on right-click
- **Bell Behavior** — Sound, visual flash, or none
- **Search** — Search within terminal output (xterm addon-search)
- **Web Links** — Clickable URLs in terminal output

### SFTP File Manager

- **Dual-Pane File Browser** — Local and remote file panels side by side
- **Drag & Drop Transfers** — Drag files between panels to upload/download
- **Transfer Queue** — Queued, pausable, and cancellable file transfers with progress tracking
- **Concurrent Transfers** — Configurable parallel transfer slots (1-10)
- **Conflict Resolution** — Ask, overwrite, overwrite if newer, skip, or rename
- **Bandwidth Limiting** — Per-session upload/download speed caps (KB/s)
- **Hidden Files Toggle** — Show/hide dotfiles
- **View Modes** — List or grid view
- **Timestamp Preservation** — Optionally preserve file timestamps on transfer
- **Symlink Following** — Configurable symlink behavior

### Combined Split View

- **Terminal + SFTP Split Layout** — Resizable horizontal or vertical split view showing terminal and SFTP simultaneously
- **Adjustable Split Ratio** — Drag the divider to resize panels
- **Per-Session Layout Memory** — Each session remembers its preferred split layout and ratio

### Connection Activity Log

- **Real-Time Log Panel** — Scrolling log of SSH events, SFTP operations, terminal actions, and errors per connection
- **Log Levels** — Debug, Info, Warning, Error filtering
- **Source Filtering** — Filter by SSH, SFTP, Terminal, or System events
- **Search** — Full-text search within log entries
- **Auto-Scroll** — Lock/unlock auto-scroll to bottom
- **Export** — Export session logs to file
- **FIFO Buffer** — Keeps the last 5,000 entries per session to limit memory usage

### Reconnection Manager

- **Automatic Reconnection** — Exponential backoff retry on unexpected disconnects
- **Configurable Strategy** — Initial delay, max delay, backoff multiplier, jitter, max attempts
- **UI Overlay** — Real-time overlay showing retry countdown, attempt count, and controls
- **Manual Controls** — Retry Now, Pause, Resume, and Cancel buttons during reconnection
- **Reset on Success** — Optionally reset backoff counters after a successful reconnect

### Host Key Management

- **Host Key Verification Flow** — Interactive dialog when connecting to new/changed hosts showing fingerprint details
- **Trust Actions** — Trust once, trust and save permanently, accept new key, or disconnect
- **Host Key Manager Panel** — View, search, and delete all trusted host keys
- **Known Hosts Export/Import** — Export trusted keys in OpenSSH `known_hosts` format

### SSH Protocol Options

- **Algorithm Preferences** — Configure preferred ciphers, key exchange, HMAC, and host key algorithms
- **Compression** — Enable/disable zlib compression per session
- **Keep-Alive** — Configurable keep-alive interval and max missed count
- **Connection Timeout** — Adjustable connection timeout per session
- **Environment Variables** — Set environment variables on the remote host
- **Custom Shell** — Override default shell command
- **Terminal Type** — Configurable terminal type string (default: `xterm-256color`)
- **Encoding** — Character encoding selection (default: UTF-8)

### Proxy Support

- **SOCKS4** — Route connections through a SOCKS4 proxy
- **SOCKS5** — Route connections through a SOCKS5 proxy with optional authentication and remote DNS
- **HTTP CONNECT** — Route connections through an HTTP CONNECT proxy with optional authentication

### Port Forwarding

- **Local Forwarding** — Forward local ports to remote destinations
- **Remote Forwarding** — Forward remote ports to local destinations
- **Dynamic Forwarding** — SOCKS proxy via SSH tunnel
- **Auto-Start** — Automatically start port forwards on connection
- **Enable/Disable** — Toggle individual rules on and off

### UI & Experience

- **Dark Theme** — Modern dark interface with custom Shellway color palette
- **Framer Motion Animations** — Smooth transitions and micro-interactions throughout
- **Lucide Icons** — Consistent, clean icon system
- **Custom Title Bar** — Native-feeling frameless window with custom controls
- **Tabbed Connections** — Multiple active connections as tabs
- **Settings Panel** — Comprehensive global settings for terminal, SFTP, SSH, and appearance
- **Toast Notifications** — Non-blocking success/error/info notifications
- **Command Snippets** — Save and reuse frequently used commands

---

## Screenshots

> *Coming soon — the app features a modern dark-themed UI with tabbed sessions, split terminal/SFTP views, and a connection activity log.*

---

## Architecture

Shellway follows Electron's process isolation model:

```
+---------------------------+        IPC Bridge         +---------------------------+
|     Main Process          | <======================>  |    Renderer Process        |
|  (Node.js / Electron)     |     (contextBridge)       |  (React / TypeScript)     |
|                           |                           |                           |
|  - SSHService (ssh2)      |   window.shellway.ssh     |  - App.tsx                |
|  - SFTPService            |   window.shellway.sftp    |  - Zustand stores         |
|  - LogService             |   window.shellway.log     |  - UI Components          |
|  - HostKeyStore           |   window.shellway.hostkey |  - xterm.js terminal      |
|  - SessionStore           |   window.shellway.sessions|  - SFTP file browser      |
|  - SettingsStore          |   window.shellway.settings|  - Activity log panel     |
|  - ReconnectionManager    |   window.shellway.terminal|  - Reconnection overlay   |
|  - TransferQueue          |                           |  - Host key manager       |
|  - Encryption utils       |                           |  - Session form (7 tabs)  |
+---------------------------+                           +---------------------------+
```

- **Main Process** handles all SSH/SFTP connections via `ssh2`, encrypted storage via `electron-store` + AES-256-GCM, and exposes functionality through IPC handlers.
- **Preload Script** bridges main ↔ renderer using `contextBridge`, exposing a typed `window.shellway` API.
- **Renderer Process** is a React SPA with Zustand state management, Tailwind CSS styling, and xterm.js terminal emulation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Electron](https://www.electronjs.org/) 33+ |
| Build Tool | [electron-vite](https://electron-vite.org/) |
| Packaging | [electron-builder](https://www.electron.build/) |
| Frontend | [React](https://react.dev/) 18 + [TypeScript](https://www.typescriptlang.org/) 5 |
| State Management | [Zustand](https://zustand-demo.pmnd.rs/) 4 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) 3 |
| Terminal | [xterm.js](https://xtermjs.org/) 6 |
| SSH/SFTP | [ssh2](https://github.com/mscdex/ssh2) |
| Proxy | [socks](https://github.com/JoshGlazebrook/socks) (SOCKS4/5 & HTTP CONNECT) |
| Storage | [electron-store](https://github.com/sindresorhus/electron-store) (AES-256-GCM encrypted) |
| Animations | [Framer Motion](https://www.framer.com/motion/) 11 |
| Icons | [Lucide React](https://lucide.dev/) |

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 18.x (LTS recommended)
- **npm** >= 9.x (comes with Node.js)
- **Git** (for cloning the repository)

### Platform-Specific Requirements

**Windows:**
- No additional requirements. Building native modules uses prebuilt binaries.

**macOS:**
- **Xcode Command Line Tools**: `xcode-select --install`
- For notarization (optional): Apple Developer account + certificates

**Linux:**
- Build essentials: `sudo apt install build-essential libsecret-1-dev`
- For AppImage: `sudo apt install libfuse2`

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/shellway/shellway.git
cd shellway
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run in Development Mode

```bash
npm run dev
```

This launches the Electron app with hot-reload enabled for the renderer process. Changes to React components will update instantly. Changes to main process files require a restart.

### 4. Type Checking

```bash
npm run typecheck
```

This runs TypeScript checking on both the renderer (`tsconfig.web.json`) and main process (`tsconfig.node.json`) configurations.

### 5. Linting

```bash
npm run lint
```

---

## Development

### Available Scripts

| Command | Description |
|---------|------------|
| `npm run dev` | Start the app in development mode with hot-reload |
| `npm run build` | Build the app for production (compiles to `out/`) |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run TypeScript type checking on all code |
| `npm run lint` | Run ESLint with auto-fix on `.ts` and `.tsx` files |
| `npm run dist:win` | Build + package Windows installer (NSIS `.exe`) |
| `npm run dist:mac` | Build + package macOS installer (`.dmg`) |
| `npm run dist:all` | Build + package for Windows and macOS |

### Hot-Reload Workflow

During development (`npm run dev`):

- **Renderer changes** (anything in `src/`) — instant hot-reload in the browser window
- **Preload changes** (`electron/preload.ts`) — requires window reload (`Ctrl+R` / `Cmd+R`)
- **Main process changes** (`electron/main.ts`, `electron/services/`, `electron/ipc/`) — requires full app restart (`Ctrl+C` then `npm run dev`)

---

## Building Installers

Shellway uses `electron-builder` to package the application into native installers for each platform.

### Windows Installer

Generates an **NSIS installer** (`.exe`) for 64-bit Windows:

```bash
npm run dist:win
```

**Output:** `dist/shellway-0.1.0-setup.exe`

The Windows installer:
- Creates a desktop shortcut
- Allows the user to choose the installation directory
- Supports silent installation: `shellway-0.1.0-setup.exe /S`
- Supports custom install path: `shellway-0.1.0-setup.exe /D=C:\MyApps\Shellway`
- Includes a proper uninstaller in Add/Remove Programs

### macOS Installer

Generates a **DMG disk image** for both Intel (x64) and Apple Silicon (arm64):

```bash
npm run dist:mac
```

**Output:** `dist/shellway-0.1.0.dmg`

> **Note:** Building macOS installers requires running on macOS. Cross-compilation from Windows/Linux is not supported by electron-builder for DMG targets.

The macOS build:
- Produces a universal DMG with both x64 and arm64 architectures
- Includes entitlements for file system access (SFTP transfers)
- Notarization is disabled by default — enable it in `electron-builder.yml` by setting `notarize: true` and configuring your Apple Developer credentials

**To enable notarization:**

1. Set environment variables:
   ```bash
   export APPLE_ID="your-apple-id@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
   export APPLE_TEAM_ID="your-team-id"
   ```
2. Update `electron-builder.yml`:
   ```yaml
   mac:
     notarize: true
   ```

### Linux Installer

Generates an **AppImage** for 64-bit Linux:

```bash
npm run build && npx electron-builder --linux
```

**Output:** `dist/shellway-0.1.0.AppImage`

The AppImage:
- Is a self-contained portable executable
- Requires `libfuse2` on the host system
- Categorized as a "Network" application in desktop environments

### All Platforms at Once

To build for Windows and macOS simultaneously (must be run on macOS):

```bash
npm run dist:all
```

### Build Output

All installers are written to the `dist/` directory:

```
dist/
  shellway-0.1.0-setup.exe       # Windows NSIS installer
  shellway-0.1.0.dmg             # macOS disk image
  shellway-0.1.0.AppImage        # Linux AppImage
  win-unpacked/                   # Unpacked Windows app (for testing)
  mac/                            # Unpacked macOS app (for testing)
```

### CI/CD Publishing

The project is configured for GitHub Releases publishing:

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: shellway
  repo: shellway
```

To publish a release:

```bash
# Set GitHub token
export GH_TOKEN="your-github-personal-access-token"

# Build and publish
npx electron-builder --win --publish always
npx electron-builder --mac --publish always
```

---

## Project Structure

```
shellway/
  electron/                      # Main process (Node.js)
    main.ts                      # Electron entry point, window creation, IPC registration
    preload.ts                   # Context bridge — exposes window.shellway API
    ipc/                         # IPC handler modules
      ssh.ipc.ts                 # SSH connection/disconnect/reconnect handlers
      sftp.ipc.ts                # SFTP file operations handlers
      terminal.ipc.ts            # Terminal shell create/resize/input handlers
      session.ipc.ts             # Session CRUD handlers
      settings.ipc.ts            # Settings read/write handlers
      log.ipc.ts                 # Activity log handlers
      hostkey.ipc.ts             # Host key management handlers
    services/                    # Business logic services
      SSHService.ts              # SSH connection manager (ssh2 wrapper)
      SFTPService.ts             # SFTP file operations
      SessionStore.ts            # Encrypted session persistence
      SettingsStore.ts           # Global settings persistence
      LogService.ts              # Per-session activity logging
      ReconnectionManager.ts     # Exponential backoff reconnection
      HostKeyStore.ts            # Trusted host key management
      TransferQueue.ts           # File transfer queue with concurrency
    utils/
      encryption.ts              # AES-256-GCM encryption/decryption

  src/                           # Renderer process (React)
    main.tsx                     # React entry point
    App.tsx                      # Root component, event listeners, global dialogs
    index.css                    # Tailwind imports + custom theme
    env.d.ts                     # Window type augmentation for window.shellway
    types/                       # Shared TypeScript types
      session.ts                 # Session, Auth, Proxy, Overrides, ConnectionTab types
      settings.ts                # AppSettings type
      log.ts                     # LogEntry, LogLevel, LogSource types
      hostkey.ts                 # TrustedHostKey type
      sftp.ts                    # SFTP-specific types
      transfer.ts                # Transfer state types
    stores/                      # Zustand state stores
      connectionStore.ts         # Active connections & tabs
      sessionStore.ts            # Session profiles
      uiStore.ts                 # UI state (panels, modals, split view)
      logStore.ts                # Per-session log entries
      hostkeyStore.ts            # Host key management state
      transferStore.ts           # File transfer state
    hooks/                       # React hooks
      useSession.ts              # Session-related hooks
      useKeyboardShortcuts.ts    # Global keyboard shortcut handler
    utils/
      resolveSettings.ts         # Deep-merge session overrides with globals
    components/
      App.tsx                    # Root layout
      ConnectionView.tsx         # Main connection view (tabs, split, log, reconnection)
      SplitView.tsx              # Resizable split panel component
      WelcomeScreen.tsx          # Shown when no connections are active
      layout/
        AppShell.tsx             # Main app shell layout
        Sidebar.tsx              # Left sidebar with session list & actions
        TitleBar.tsx             # Custom frameless title bar
      sessions/
        SessionManager.tsx       # Session list, search, filtering
        SessionCard.tsx          # Session card with quick-launch buttons
        SessionForm.tsx          # 7-tab session editor (Login/Terminal/SFTP/SSH/Proxy/Notes/Advanced)
        KBDIDialog.tsx           # Keyboard-interactive challenge dialog
      terminal/
        TerminalView.tsx         # xterm.js terminal wrapper
        TerminalTabs.tsx         # Terminal tab bar
        TerminalToolbar.tsx      # Terminal action toolbar
      sftp/
        SFTPView.tsx             # SFTP dual-pane file manager
        FileBrowser.tsx          # Single file browser panel
        FilePanel.tsx            # File panel container
      keys/
        HostKeyManager.tsx       # Host key management panel
        HostKeyVerifyDialog.tsx  # New/changed host key verification dialog
      log/
        ActivityLog.tsx          # Activity log panel
        LogToolbar.tsx           # Log filtering/search/export toolbar
        LogEntry.tsx             # Individual log entry row
      reconnection/
        ReconnectionOverlay.tsx  # Reconnection status overlay
      port-forwarding/
        PortForwardingView.tsx   # Port forwarding rule manager
      settings/                  # Global settings UI
      snippets/                  # Command snippet manager
      ui/                        # Reusable UI primitives
        Button.tsx               # Button (primary/secondary/ghost/danger/outline)
        Input.tsx                # Text input
        Select.tsx               # Dropdown select
        Modal.tsx                # Modal dialog
        Tabs.tsx                 # Tab navigation
        Toggle.tsx               # Toggle switch
        Toast.tsx                # Toast notifications
        ...

  resources/                     # Build resources (icons, entitlements)
  electron-builder.yml           # electron-builder packaging config
  electron.vite.config.ts        # electron-vite build config
  tailwind.config.ts             # Tailwind CSS config with Shellway theme
  tsconfig.json                  # Base TypeScript config
  tsconfig.web.json              # Renderer TypeScript config
  tsconfig.node.json             # Main process TypeScript config
  postcss.config.js              # PostCSS config
  package.json                   # Dependencies and scripts
```

---

## Configuration

### Global Settings

Shellway stores global settings via `electron-store` at the OS-standard config path:

- **Windows:** `%APPDATA%/shellway-settings/`
- **macOS:** `~/Library/Application Support/shellway-settings/`
- **Linux:** `~/.config/shellway-settings/`

### Session Data

Session profiles (with encrypted secrets) are stored separately:

- **Windows:** `%APPDATA%/shellway-sessions/`
- **macOS:** `~/Library/Application Support/shellway-sessions/`
- **Linux:** `~/.config/shellway-sessions/`

### Trusted Host Keys

Known host keys are persisted at:

- **Windows:** `%APPDATA%/shellway-hostkeys/`
- **macOS:** `~/Library/Application Support/shellway-hostkeys/`
- **Linux:** `~/.config/shellway-hostkeys/`

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+T` | Quick-launch terminal for active session |
| `Ctrl+Shift+F` | Quick-launch SFTP for active session |
| `Ctrl+Shift+B` | Toggle split view (Terminal + SFTP) |
| `Ctrl+1` | Switch to Terminal sub-tab |
| `Ctrl+2` | Switch to SFTP sub-tab |

---

## Security

Shellway takes security seriously:

- **AES-256-GCM Encryption** — All passwords, passphrases, private key data, KBDI saved responses, and proxy passwords are encrypted at rest using AES-256-GCM with a per-installation master key
- **No Plaintext Secrets** — Secrets are never written to disk in plaintext
- **Export Stripping** — When exporting session profiles, all secret fields are automatically stripped
- **Host Key Verification** — Interactive verification on first connect or when a host key changes, preventing MITM attacks
- **Context Isolation** — Renderer process runs with `contextIsolation: true` and `nodeIntegration: false`; all main process access goes through the typed `contextBridge` preload API
- **Process Sandboxing** — Electron's sandbox is enabled for the renderer process

---

## License

This project is licensed under the [MIT License](LICENSE).
