import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  dialog,
  Tray,
  Menu,
  nativeImage,
  powerMonitor,
} from "electron";
import { join, basename, extname } from "path";
import { readFile, writeFile, stat } from "fs/promises";
import { watch, type FSWatcher } from "fs";
import { spawn, execFileSync } from "child_process";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";

/**
 * Check if the running macOS app bundle is code-signed.
 * Returns true if signed (auto-update will work), false if unsigned.
 * Always returns true on non-macOS (Windows NSIS doesn't require signing for updates).
 */
function isAppCodeSigned(): boolean {
  if (process.platform !== "darwin") return true;
  try {
    // codesign --verify exits 0 if signed, non-zero if unsigned
    execFileSync("codesign", ["--verify", "--deep", "--strict", app.getAppPath()], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** Cached result — checked once at startup */
let appIsSigned: boolean | null = null;
import { registerSessionIPC } from "./ipc/session.ipc";
import { registerSettingsIPC } from "./ipc/settings.ipc";
import { registerSSHIPC } from "./ipc/ssh.ipc";
import { registerTerminalIPC, startPendingAttach } from "./ipc/terminal.ipc";
import { registerSFTPIPC, cleanupSFTP } from "./ipc/sftp.ipc";
import { registerLogIPC } from "./ipc/log.ipc";
import { registerHostKeyIPC } from "./ipc/hostkey.ipc";
import { registerClientKeyIPC } from "./ipc/clientkey.ipc";
import { registerSnippetIPC } from "./ipc/snippet.ipc";
import { registerPortForwardIPC } from "./ipc/portforward.ipc";
import { registerHealthIPC } from "./ipc/health.ipc";
import { registerSQLIPC, disconnectSQLByConnectionId } from "./ipc/sql.ipc";
import { registerExportIPC } from "./ipc/export.ipc";
import { registerMonitorIPC, getMonitorService } from "./ipc/monitor.ipc";
import { registerServiceManagerIPC } from "./ipc/servicemanager.ipc";
import { getSettingsStore } from "./ipc/settings.ipc";
import { getSSHService } from "./ipc/ssh.ipc";
import { getSQLService } from "./ipc/sql.ipc";
import { initNotificationService } from "./services/NotificationService";
import { getLogService } from "./services/LogService";
import { windowManager, type StandaloneMode } from "./services/WindowManager";

// ──── Global error handlers ────
// Prevent unhandled errors from crashing the app with an ugly Electron dialog.
// These catch errors from stale SSH connections (laptop sleep/wake, network loss, etc.)

process.on("uncaughtException", (error) => {
  const msg = error?.message ?? String(error);
  // Suppress common network-related errors from ssh2 / database drivers
  // that occur after sleep/wake or network drops — these are expected and non-fatal
  const isNetworkError =
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTCONN|ERR_UNHANDLED_ERROR/i.test(
      msg,
    );
  if (isNetworkError) {
    console.warn("[main] Suppressed network error:", msg);
    try {
      getLogService().log("__system__", "warning", "system", `Connection error suppressed: ${msg}`);
    } catch {
      /* LogService may not be initialized yet */
    }
    return;
  }
  // For non-network errors, log but don't crash
  console.error("[main] Uncaught exception:", error);
  try {
    getLogService().log("__system__", "error", "system", `Uncaught exception: ${msg}`);
  } catch {
    /* LogService may not be initialized yet */
  }
});

process.on("unhandledRejection", (reason) => {
  const msg =
    reason instanceof Error ? reason.message : String(reason ?? "unknown");
  const isNetworkError =
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTCONN/i.test(
      msg,
    );
  if (isNetworkError) {
    console.warn("[main] Suppressed unhandled rejection:", msg);
    try {
      getLogService().log("__system__", "warning", "system", `Rejected promise suppressed: ${msg}`);
    } catch {
      /* LogService may not be initialized yet */
    }
    return;
  }
  console.error("[main] Unhandled rejection:", reason);
  try {
    getLogService().log("__system__", "error", "system", `Unhandled rejection: ${msg}`);
  } catch {
    /* LogService may not be initialized yet */
  }
});

/** Create the main application window */
function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0f1117",
    icon: join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  windowManager.register(mainWindow, "main");

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Load the renderer
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

/**
 * Create a standalone child window that renders a single feature (SQL, terminal,
 * monitor, or SFTP). The renderer detects `?standalone=<mode>` in the URL and
 * skips the normal sidebar/workspace chrome.
 *
 * The new window is registered with WindowManager on creation so it participates
 * in the subscription/refcount system for connection event routing. Each
 * standalone window holds its own Zustand stores; connections are shared through
 * the main-process singleton services, reference-counted per connectionId.
 */
interface OpenStandaloneOptions {
  mode: StandaloneMode;
  sessionId: string;
  name?: string;
  sessionColor?: string;
}

function createStandaloneWindow(opts: OpenStandaloneOptions): {
  window: BrowserWindow;
  windowId: string;
} {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0f1117",
    icon: join(__dirname, "../../resources/icon.png"),
    title: opts.name || "Shellway",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const windowId = windowManager.register(win, "standalone", opts.mode);

  win.on("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  const params = new URLSearchParams({
    standalone: opts.mode,
    sessionId: opts.sessionId,
  });
  if (opts.name) params.set("name", opts.name);
  if (opts.sessionColor) params.set("sessionColor", opts.sessionColor);

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}?${params.toString()}`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), {
      search: params.toString(),
    });
  }

  // Broadcast maximize/unmaximize events to the renderer so the custom
  // title bar stays in sync with actual window state.
  win.on("maximize", () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window:maximized-change", true);
    }
  });
  win.on("unmaximize", () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window:maximized-change", false);
    }
  });

  return { window: win, windowId };
}

/**
 * Shut down the main-process resources for a connection that no window is
 * watching anymore. Each service no-ops if it doesn't own the given id, so
 * we can fire all of them without worrying about which one is the "real" owner.
 *
 * Called on window close (via the `connections-orphaned` event emitted by
 * WindowManager) and on explicit `window:unsubscribe` when the refcount hits 0.
 */
function cleanupOrphanedConnection(connectionId: string): void {
  try {
    getSSHService().disconnect(connectionId);
  } catch (err) {
    console.warn(
      `[main] SSH cleanup failed for orphaned connection ${connectionId}:`,
      err,
    );
  }
  try {
    getMonitorService().removeMonitoring(connectionId);
  } catch (err) {
    console.warn(
      `[main] Monitor cleanup failed for orphaned connection ${connectionId}:`,
      err,
    );
  }
  // SFTPService wraps an SFTPWrapper tied to the SSH client lifecycle, so the
  // ssh.disconnect above already tears down the underlying channel. But the
  // `sftpServices` Map in sftp.ipc.ts must also be cleared to avoid leaking a
  // stale SFTPService reference.
  try {
    cleanupSFTP(connectionId);
  } catch (err) {
    console.warn(
      `[main] SFTP cleanup failed for orphaned connection ${connectionId}:`,
      err,
    );
  }
  // SQL connections are keyed by sqlSessionId, not connectionId. The SQL IPC
  // layer maintains a reverse map and exposes a helper to disconnect by
  // connectionId. Fire-and-forget — cleanup is best-effort.
  disconnectSQLByConnectionId(connectionId).catch((err) => {
    console.warn(
      `[main] SQL cleanup failed for orphaned connection ${connectionId}:`,
      err,
    );
  });
}

// Register the orphaned-connection listener once, at module load.
windowManager.on("connections-orphaned", (...args: unknown[]) => {
  const orphaned = args[0] as string[];
  for (const connectionId of orphaned) {
    cleanupOrphanedConnection(connectionId);
  }
});

/**
 * Transient handoff state passed from a source window (e.g. the main window
 * popping out a tab) to a newly-created standalone window. The source window
 * writes the state via `window:openStandalone`; the new window drains it via
 * `window:getHandoff` during its bootstrap.
 *
 * Stored keyed by windowId (the new window's id). Entries are deleted after
 * the first successful `getHandoff` call — the handoff is single-use.
 */
interface StandaloneHandoffState {
  connectionId: string;
  sessionId: string;
  sqlSessionId?: string | null;
  /**
   * When the database is tunneled through an existing SSH connection, the new
   * window subscribes to BOTH the SQL connectionId and the SSH connectionId so
   * the tunnel stays alive if the original SSH tab in the main window closes.
   */
  viaSSHConnectionId?: string;
  /** Full serialized sqlStore slice — tabs, history, staged changes, etc. */
  sqlSlice?: unknown;
  /**
   * Terminal pop-out: the shellId being handed off and an ANSI-serialized
   * snapshot of the xterm buffer so the new window can replay the visible
   * scrollback + cursor state before attaching to the live shell.
   */
  shellId?: string;
  bufferSnapshot?: string;
  name?: string;
  sessionColor?: string;
}

const pendingHandoff = new Map<string, StandaloneHandoffState>();

/**
 * Clean up stale handoff entries when their window closes without ever
 * draining the handoff (edge case: crash during bootstrap).
 */
windowManager.on("window-closed", (...args: unknown[]) => {
  const windowId = args[0] as string;
  pendingHandoff.delete(windowId);
});

// When a window hosting a monitor view closes without properly unmounting its
// MonitorView component, its viewer registration would otherwise leak and keep
// polling running forever. This listener catches that case and stops polling
// for any connection whose last viewer was the closing window.
windowManager.on("window-closed", (...args: unknown[]) => {
  const windowId = args[0] as string;
  const emptiedConnections = getMonitorService().removeViewerFromAll(windowId);
  for (const connectionId of emptiedConnections) {
    try {
      getMonitorService().stopMonitoring(connectionId);
    } catch (err) {
      console.warn(
        `[main] Monitor stop failed for connection ${connectionId} on window-closed:`,
        err,
      );
    }
  }
});

// ──── Window control IPC handlers ────
ipcMain.handle("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});

ipcMain.handle("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.handle("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

ipcMain.handle("window:isMaximized", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win?.isMaximized() ?? false;
});

/**
 * Open a new standalone BrowserWindow for a specific feature.
 *
 * If a standalone window for the same (mode, sessionId) already exists, focus
 * it instead of creating a duplicate — the caller can pass `allowDuplicate: true`
 * to override (e.g. "Open in New Window" from a context menu).
 *
 * If `connectionId` is supplied the new window is **pre-subscribed** to that
 * connection in the main process before the handler returns. This is the key
 * invariant for tab tear-off: the source window can then `removeTab` without
 * calling `sql.disconnect`, because the connection's refcount never drops to
 * zero during the handoff (new window holds a subscription the instant the
 * old one lets go).
 *
 * If `sqlSlice` is supplied it is stashed in a per-window handoff map; the new
 * window drains it via `window:getHandoff` during its bootstrap so tabs,
 * history, staged changes, etc. carry over seamlessly.
 */
ipcMain.handle(
  "window:openStandalone",
  (
    _event,
    opts: OpenStandaloneOptions & {
      allowDuplicate?: boolean;
      connectionId?: string;
      sqlSessionId?: string | null;
      viaSSHConnectionId?: string;
      sqlSlice?: unknown;
      shellId?: string;
      bufferSnapshot?: string;
    },
  ) => {
    if (!opts || !opts.mode || !opts.sessionId) {
      throw new Error(
        "window:openStandalone requires { mode, sessionId }",
      );
    }

    if (!opts.allowDuplicate) {
      const existing = windowManager.findStandaloneFor(opts.mode, opts.sessionId);
      if (existing) {
        if (existing.isMinimized()) existing.restore();
        existing.focus();
        return { ok: true, focusedExisting: true };
      }
    }

    const { windowId } = createStandaloneWindow(opts);

    // Pre-subscribe the new window to the connection(s) it will observe.
    // This MUST happen before the handler returns so the source window can
    // safely remove its own tab without racing the orphan-cleanup path.
    if (opts.connectionId) {
      windowManager.subscribe(windowId, opts.connectionId);
    }
    if (opts.viaSSHConnectionId) {
      windowManager.subscribe(windowId, opts.viaSSHConnectionId);
    }

    // Terminal pop-out: start buffering shell output immediately so nothing
    // is lost in the gap between createStandaloneWindow and the new
    // BrowserWindow's TerminalView registering its ipcRenderer listener.
    // The new window drains the buffer via `terminal:attach` once ready.
    if (opts.shellId) {
      startPendingAttach(opts.shellId);
    }

    // Stash the handoff state keyed by windowId. The new window drains it
    // via `window:getHandoff` once the renderer has booted.
    if (
      opts.connectionId ||
      opts.sqlSessionId ||
      opts.viaSSHConnectionId ||
      opts.sqlSlice ||
      opts.shellId ||
      opts.bufferSnapshot
    ) {
      pendingHandoff.set(windowId, {
        connectionId: opts.connectionId || "",
        sessionId: opts.sessionId,
        sqlSessionId: opts.sqlSessionId ?? null,
        viaSSHConnectionId: opts.viaSSHConnectionId,
        sqlSlice: opts.sqlSlice,
        shellId: opts.shellId,
        bufferSnapshot: opts.bufferSnapshot,
        name: opts.name,
        sessionColor: opts.sessionColor,
      });
    }

    return { ok: true, windowId };
  },
);

/**
 * Drain the pending handoff state for the calling window (if any). Called by
 * StandaloneDatabaseApp (and future StandaloneTerminalApp / MonitorApp / etc.)
 * during bootstrap before the feature view mounts. Returns `null` if this
 * window was opened without a handoff (direct sidebar launch or non-tear-off
 * flow).
 *
 * Single-use: the entry is deleted on first successful call.
 */
ipcMain.handle("window:getHandoff", (event) => {
  const windowId = windowManager.getWindowIdForWebContents(event.sender);
  if (!windowId) return null;
  const state = pendingHandoff.get(windowId) ?? null;
  if (state) pendingHandoff.delete(windowId);
  return state;
});

/**
 * Merge-back payload sent by a standalone window when the user clicks
 * "Merge into main window". The main window receives this payload on the
 * `window:mergeRequest` channel and reconstructs the tab/view.
 *
 * The IPC is fire-and-ack from the standalone window's perspective: as soon
 * as this handler returns `{ ok: true }`, the standalone window closes
 * itself. WindowManager's refcounted subscription model ensures the
 * underlying connection stays alive during the handoff: main is subscribed
 * before the standalone window closes (we subscribe main here explicitly).
 */
interface MergeBackPayload {
  mode: StandaloneMode;
  connectionId: string;
  sessionId: string;
  name?: string;
  sessionColor?: string;
  /** SQL: full serialized sqlStore slice to re-hydrate in main */
  sqlSlice?: unknown;
  /** SQL: SSH tunnel connectionId (if the DB runs over SSH) */
  viaSSHConnectionId?: string;
  /** Terminal: shellId + buffer snapshot to re-adopt in main's TerminalTabs */
  shellId?: string;
  bufferSnapshot?: string;
}

ipcMain.handle("window:mergeBack", (_event, payload: MergeBackPayload) => {
  const mainWin = windowManager.getMainWindow();
  if (!mainWin || mainWin.isDestroyed()) {
    return { ok: false, reason: "no main window" };
  }

  // Subscribe the main window to the connection BEFORE the standalone
  // window closes, so the refcount never drops to zero during the handoff.
  const mainWindowId = windowManager.getWindowIdForWebContents(
    mainWin.webContents,
  );
  if (mainWindowId) {
    windowManager.subscribe(mainWindowId, payload.connectionId);
    if (payload.viaSSHConnectionId) {
      windowManager.subscribe(mainWindowId, payload.viaSSHConnectionId);
    }
  }

  // Terminal merge-back: start a pendingAttach buffer so the main window's
  // newly-mounted TerminalView doesn't lose shell output during the gap
  // between merge-back and the listener re-registering. Symmetric to the
  // pop-out path.
  if (payload.mode === "terminal" && payload.shellId) {
    startPendingAttach(payload.shellId);
  }

  // Forward the payload to the main window's renderer, which will
  // reconstruct the tab in its Zustand stores and focus it.
  mainWin.webContents.send("window:mergeRequest", payload);

  // Surface the main window to the user.
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();

  return { ok: true };
});

/**
 * Subscribe the calling window to a connection's event stream.
 * Idempotent — calling multiple times with the same connectionId is safe.
 *
 * Services publish events via `windowManager.broadcastToConnection(connectionId, ...)`,
 * which only reaches subscribers. A window that displays a connection MUST
 * subscribe before the service fires any events, otherwise it will miss them.
 */
ipcMain.handle("window:subscribe", (event, connectionId: string) => {
  const windowId = windowManager.getWindowIdForWebContents(event.sender);
  if (!windowId) return { ok: false, error: "unknown window" };
  windowManager.subscribe(windowId, connectionId);
  return { ok: true, windowId, refcount: windowManager.refcount(connectionId) };
});

/**
 * Unsubscribe the calling window. If this was the last subscriber the
 * `connections-orphaned` event fires and the IPC layer can shut down the
 * underlying service resource (SSH shell, DB pool, monitor poller, etc.).
 */
ipcMain.handle("window:unsubscribe", (event, connectionId: string) => {
  const windowId = windowManager.getWindowIdForWebContents(event.sender);
  if (!windowId) return { ok: false, error: "unknown window" };
  const wasLast = windowManager.unsubscribe(windowId, connectionId);
  if (wasLast) {
    cleanupOrphanedConnection(connectionId);
  }
  return { ok: true, wasLast };
});

ipcMain.handle("platform:get", () => {
  return process.platform;
});

ipcMain.handle("theme:getNative", () => {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
});

// ──── Dialog IPC handlers ────
ipcMain.handle(
  "dialog:openFile",
  async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result;
  },
);

ipcMain.handle(
  "dialog:saveFile",
  async (_event, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options);
    return result;
  },
);

ipcMain.handle("fs:readFile", async (_event, filePath: string) => {
  const content = await readFile(filePath, "utf-8");
  return content;
});

ipcMain.handle(
  "fs:writeFile",
  async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, "utf-8");
  },
);

ipcMain.handle("shell:openPath", async (_event, filePath: string) => {
  return shell.openPath(filePath);
});

/**
 * Spawn an application to open a file.
 * Uses 'spawn' event (Node 15.1+) to avoid race condition where ENOENT
 * fires after synchronous resolve. The 'spawn' event confirms the process
 * actually started; 'error' fires if it couldn't start (bad path, etc.).
 */
function launchAppWithFile(
  appPath: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    if (process.platform === "darwin") {
      child = spawn("open", ["-a", appPath, filePath], {
        detached: true,
        stdio: "ignore",
      });
    } else {
      child = spawn(appPath, [filePath], { detached: true, stdio: "ignore" });
    }

    child.on("error", (err) => resolve({ success: false, error: err.message }));
    child.on("spawn", () => {
      child.unref();
      resolve({ success: true });
    });
  });
}

/**
 * Open a file with a specific application (bypass OS default).
 */
ipcMain.handle(
  "shell:openFileWithApp",
  async (_event, filePath: string, appPath: string) => {
    return launchAppWithFile(appPath, filePath);
  },
);

/**
 * Show a file picker dialog so the user can choose which app to open a file with.
 * Returns { appPath, appName } if user chose an app, or null if cancelled.
 * On macOS: filter for .app bundles in /Applications
 * On Windows: filter for .exe files
 */
ipcMain.handle("shell:openWithPicker", async (event, filePath: string) => {
  const win =
    BrowserWindow.fromWebContents(event.sender) ??
    BrowserWindow.getFocusedWindow();
  if (!win) return null;

  let dialogOptions: Electron.OpenDialogOptions;

  if (process.platform === "darwin") {
    dialogOptions = {
      title: "Open With…",
      message: "Choose an application to open this file with",
      defaultPath: "/Applications",
      properties: ["openFile"],
      filters: [
        { name: "Applications", extensions: ["app"] },
        { name: "All Files", extensions: ["*"] },
      ],
    };
  } else if (process.platform === "win32") {
    dialogOptions = {
      title: "Open With…",
      defaultPath: "C:\\Program Files",
      properties: ["openFile"],
      filters: [{ name: "Executables", extensions: ["exe"] }],
    };
  } else {
    dialogOptions = {
      title: "Open With…",
      properties: ["openFile"],
      filters: [{ name: "Executables", extensions: ["*"] }],
    };
  }

  const result = await dialog.showOpenDialog(win, dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const appPath = result.filePaths[0];
  const appName = basename(appPath, extname(appPath));

  const openResult = await launchAppWithFile(appPath, filePath);
  if (!openResult.success) {
    return null;
  }

  return { appPath, appName };
});

ipcMain.handle("fs:getTempDir", () => {
  return app.getPath("temp");
});

// ──── File watcher for auto-upload on save ────
const activeWatchers = new Map<string, FSWatcher>();

ipcMain.handle("fs:watchFile", (event, watchId: string, filePath: string) => {
  // Clean up any existing watcher for this ID
  const existing = activeWatchers.get(watchId);
  if (existing) {
    existing.close();
    activeWatchers.delete(watchId);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSize = -1;

  const watcher = watch(filePath, { persistent: false }, async (eventType) => {
    if (eventType !== "change") return;

    // Debounce: editors may trigger multiple change events for a single save
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        // Check if the renderer is still alive
        if (event.sender.isDestroyed()) {
          // Clean up — the tab/window was closed
          watcher.close();
          activeWatchers.delete(watchId);
          return;
        }

        // Verify the file actually changed by checking size/mtime
        const s = await stat(filePath);
        if (s.size === lastSize) return; // Likely a duplicate event
        lastSize = s.size;

        // Notify renderer that the file was modified
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          win.webContents.send("fs:file-changed", watchId, filePath);
        }
      } catch {
        // File may have been deleted or renderer destroyed — stop watching
        watcher.close();
        activeWatchers.delete(watchId);
      }
    }, 500);
  });

  activeWatchers.set(watchId, watcher);
  return { success: true };
});

ipcMain.handle("fs:unwatchFile", (_event, watchId: string) => {
  const watcher = activeWatchers.get(watchId);
  if (watcher) {
    watcher.close();
    activeWatchers.delete(watchId);
  }
  return { success: true };
});

// ──── Tray support ────
let tray: Tray | null = null;
let isQuitting = false;

function setupTray(mainWindow: BrowserWindow): void {
  if (tray) return; // Already created

  // Windows: prefer .ico for crisp tray icon; others: .png
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  const iconPath = join(__dirname, "../../resources", iconFile);
  const trayIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("Shellway");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// ──── App lifecycle ────
app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.shellway.app");

  // Register IPC handlers
  registerSessionIPC();
  registerSettingsIPC();
  registerSSHIPC();
  registerTerminalIPC();
  registerSFTPIPC();
  registerLogIPC();
  registerHostKeyIPC();
  registerClientKeyIPC();
  registerSnippetIPC();
  registerPortForwardIPC();
  registerHealthIPC();
  registerSQLIPC();
  registerExportIPC();
  registerMonitorIPC();
  registerServiceManagerIPC();

  // Initialize notification service (after settings IPC is registered)
  initNotificationService(getSettingsStore());

  // Default open or close DevTools by F12 in dev / ignore in production
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const mainWindow = createWindow();

  // Notify renderer on maximize/unmaximize
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized-change", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized-change", false);
  });

  // Ensure isQuitting is set for all quit paths (Cmd+Q, taskbar close, etc.)
  app.on("before-quit", () => {
    isQuitting = true;
  });

  // ──── Apply settings on startup ────
  const settingsStore = getSettingsStore();
  const initialSettings = settingsStore.getAll();

  // Minimize to Tray: always attach the close handler so it can be toggled at runtime
  let minimizeToTrayEnabled =
    initialSettings.minimizeToTray && process.platform !== "darwin";
  if (minimizeToTrayEnabled) {
    setupTray(mainWindow);
  }
  mainWindow.on("close", (e) => {
    if (minimizeToTrayEnabled && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Expose tray toggle for settings.ipc.ts
  (global as any).__shellway_setMinimizeToTray = (enabled: boolean) => {
    minimizeToTrayEnabled = enabled && process.platform !== "darwin";
    if (minimizeToTrayEnabled) {
      setupTray(mainWindow);
    } else {
      destroyTray();
    }
  };

  // Start on Boot: sync login item setting
  app.setLoginItemSettings({ openAtLogin: initialSettings.startOnBoot });

  // Log settings: apply maxEntries and debugMode from saved settings
  const logService = getLogService();
  logService.setMaxEntries(initialSettings.logMaxEntries);
  logService.setDebugMode(initialSettings.logDebugMode);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // ──── Auto-updater ────
  // Only check for updates in production builds (not dev mode)
  if (!is.dev) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (msg: unknown) => console.log("[auto-updater]", msg),
      warn: (msg: unknown) => console.warn("[auto-updater]", msg),
      error: (msg: unknown) => console.error("[auto-updater]", msg),
      debug: (msg: unknown) => console.log("[auto-updater:debug]", msg),
    };

    /** Safely send IPC to renderer (window may be destroyed during async updater events) */
    const sendUpdaterEvent = (channel: string, ...args: unknown[]) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    };

    autoUpdater.on("checking-for-update", () => {
      sendUpdaterEvent("updater:checking-for-update");
    });

    autoUpdater.on("update-available", (info) => {
      sendUpdaterEvent("updater:update-available", info);
    });

    autoUpdater.on("update-not-available", (info) => {
      sendUpdaterEvent("updater:update-not-available", info);
    });

    autoUpdater.on("download-progress", (progress) => {
      sendUpdaterEvent("updater:download-progress", {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      sendUpdaterEvent("updater:update-downloaded", info);
    });

    autoUpdater.on("error", (err) => {
      console.error("[auto-updater]", err.message);
      sendUpdaterEvent("updater:error", err.message);
    });

    // Check for updates 5 seconds after the window is ready (if setting allows)
    const initialCheckForUpdates = settingsStore.get("checkForUpdates");
    if (initialCheckForUpdates !== false) {
      setTimeout(() => autoUpdater.checkForUpdates(), 5000);
    }
  }

  // Renderer can trigger a manual check for updates.
  // Errors are reported via the 'updater:error' event, not the return value.
  ipcMain.handle("updater:check-for-updates", async () => {
    if (is.dev) return { ok: false, dev: true };
    try {
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      // Error will also fire via the 'error' event → renderer gets it via onError
      console.error("[auto-updater] manual check failed:", err?.message);
    }
    return { ok: true };
  });

  // Check code signing status once (cached for the session).
  appIsSigned = isAppCodeSigned();
  console.log(`[auto-updater] App code signed: ${appIsSigned}`);

  // Expose signing status so renderer can show "Download" vs "Restart" button.
  ipcMain.handle("updater:is-auto-update-supported", () => appIsSigned);

  // Renderer can trigger an install-and-restart (signed) or open release page (unsigned).
  // On macOS, auto-update requires code signing. Without it, quitAndInstall silently
  // fails. For unsigned builds we open the GitHub release page in the default browser.
  ipcMain.handle("updater:install-and-restart", (_event, version?: string) => {
    if (!appIsSigned) {
      // Unsigned macOS → open release page for manual download
      const tag = version ? `v${version}` : "latest";
      const url = `https://github.com/WMOH-DEV/shellway/releases/${tag === "latest" ? "latest" : `tag/${tag}`}`;
      console.log(`[auto-updater] Unsigned app — opening release page: ${url}`);
      shell.openExternal(url);
      return { action: "opened-release-page", url };
    }

    // Signed app → proceed with auto-update
    isQuitting = true;
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        console.error("[auto-updater] quitAndInstall failed:", err);
        app.relaunch();
        app.exit(0);
      }
    });
    return { action: "quit-and-install" };
  });

  // ──── System sleep/wake detection ────
  // When the system resumes from sleep, SSH/DB connections are likely stale.
  // Notify the renderer so it can handle reconnection gracefully.
  powerMonitor.on("resume", () => {
    console.log("[main] System resumed from sleep — notifying renderer");
    try {
      getLogService().log("__system__", "info", "system", "System resumed from sleep — checking connections");
    } catch { /* ignore */ }
    mainWindow.webContents.send("system:resume");
  });

  powerMonitor.on("suspend", () => {
    console.log("[main] System going to sleep");
    try {
      getLogService().log("__system__", "info", "system", "System suspending — connections may become stale");
    } catch { /* ignore */ }
  });
});

app.on("window-all-closed", () => {
  // Per-window orphaned-connection cleanup already ran via WindowManager's
  // `connections-orphaned` event as each window closed. Anything still alive
  // in the services at this point is a safety net for edge cases (crashes,
  // missed unsubscribe calls, etc.).
  //
  // We still close file watchers here because they're not tied to
  // WindowManager's subscription model — they're bound to IPC senders that
  // may already be destroyed.
  for (const [, watcher] of activeWatchers) {
    watcher.close();
  }
  activeWatchers.clear();

  // Safety net: force-clean any services that still hold connections.
  // In the normal path these are already no-ops because every connection
  // was orphan-cleaned as its last window closed.
  try {
    getMonitorService().stopAll();
  } catch { /* ignore */ }
  try {
    getSSHService().disconnectAll();
  } catch { /* ignore — service may not be initialized */ }
  try {
    getSQLService().disconnectAll();
  } catch { /* ignore — service may not be initialized */ }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
