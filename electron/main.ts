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
import { spawn } from "child_process";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";
import { registerSessionIPC } from "./ipc/session.ipc";
import { registerSettingsIPC } from "./ipc/settings.ipc";
import { registerSSHIPC } from "./ipc/ssh.ipc";
import { registerTerminalIPC } from "./ipc/terminal.ipc";
import { registerSFTPIPC } from "./ipc/sftp.ipc";
import { registerLogIPC } from "./ipc/log.ipc";
import { registerHostKeyIPC } from "./ipc/hostkey.ipc";
import { registerClientKeyIPC } from "./ipc/clientkey.ipc";
import { registerSnippetIPC } from "./ipc/snippet.ipc";
import { registerPortForwardIPC } from "./ipc/portforward.ipc";
import { registerHealthIPC } from "./ipc/health.ipc";
import { registerSQLIPC } from "./ipc/sql.ipc";
import { registerExportIPC } from "./ipc/export.ipc";
import { registerMonitorIPC, getMonitorService } from "./ipc/monitor.ipc";
import { registerServiceManagerIPC } from "./ipc/servicemanager.ipc";
import { getSettingsStore } from "./ipc/settings.ipc";
import { getSSHService } from "./ipc/ssh.ipc";
import { getSQLService } from "./ipc/sql.ipc";
import { initNotificationService } from "./services/NotificationService";
import { getLogService } from "./services/LogService";

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

  // Renderer can trigger a manual check for updates
  ipcMain.handle("updater:check-for-updates", async () => {
    if (is.dev) return { error: "Auto-update is not available in development mode" };
    await autoUpdater.checkForUpdates();
    return { ok: true };
  });

  // Renderer can trigger an install-and-restart
  ipcMain.handle("updater:install-and-restart", () => {
    autoUpdater.quitAndInstall();
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
  // Clean up all file watchers
  for (const [, watcher] of activeWatchers) {
    watcher.close();
  }
  activeWatchers.clear();

  // Stop all monitor polling
  getMonitorService().stopAll();

  // Disconnect all SSH and SQL sessions to prevent zombie connections
  try {
    getSSHService().disconnectAll();
  } catch {
    /* ignore — service may not be initialized */
  }
  try {
    getSQLService().disconnectAll();
  } catch {
    /* ignore — service may not be initialized */
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
