import { useCallback, useState, useEffect, useMemo } from "react";
import {
  Settings,
  ChevronLeft,
  ChevronRight,
  Shield,
  KeyRound,
  Plus,
  Database,
  Server,
  Download,
  Upload,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { SessionManager } from "@/components/sessions/SessionManager";
import {
  SessionForm,
  type SessionFormData,
} from "@/components/sessions/SessionForm";
import { DatabasesPanel } from "@/components/layout/DatabasesPanel";
import { ExportDialog } from "@/components/sessions/ExportDialog";
import { ImportDialog } from "@/components/sessions/ImportDialog";
import { useSession } from "@/hooks/useSession";
import { Tooltip } from "@/components/ui/Tooltip";
import { toast } from "@/components/ui/Toast";
import type { Session } from "@/types/session";

/** Minimal shape for a saved standalone DB config — used only for collapsed-view avatars */
interface SavedDBConfig {
  sessionId: string;
  connectionName?: string;
  type: "mysql" | "postgres";
  host: string;
  port: number;
  database: string;
}

interface SidebarProps {
  onConnect: (
    session: Session,
    defaultSubTab?: "terminal" | "sftp" | "both",
  ) => void;
  onConnectDatabase: () => void;
  onOpenSavedDatabase: (savedSessionId: string, name?: string) => void;
}

// ── Panel toggle button ──

interface PanelTabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function PanelTab({ icon, label, active, onClick }: PanelTabProps) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
          active
            ? "bg-nd-accent/10 text-nd-accent border border-nd-accent/20"
            : "text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface",
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

/**
 * Left sidebar — the primary connection switcher.
 *
 * Expanded view uses two panel-toggle buttons in the header:
 *   • Sessions  — SSH/SFTP sessions (via SessionManager, includes search + groups)
 *   • Databases — Standalone DB connections (via DatabasesPanel, includes search)
 *
 * Collapsed (icon-only) view shows all connection avatars regardless of panel.
 */
export function Sidebar({
  onConnect,
  onConnectDatabase,
  onOpenSavedDatabase,
}: SidebarProps) {
  const {
    sidebarOpen,
    toggleSidebar,
    toggleSettings,
    toggleHostKeyManager,
    toggleClientKeyManager,
    selectedSessionId,
    setSelectedSessionId,
    sidebarPanel,
    setSidebarPanel,
  } = useUIStore();

  const { sessions } = useSessionStore();
  const { tabs, activeTabId, setActiveTab } = useConnectionStore();

  const width = sidebarOpen ? 260 : 48;

  // ── Sorted sessions for collapsed icon view ──
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aOrder = a.sortOrder ?? Infinity;
      const bOrder = b.sortOrder ?? Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aCreated = a.createdAt ?? 0;
      const bCreated = b.createdAt ?? 0;
      if (aCreated !== bCreated) return aCreated - bCreated;
      return a.name.localeCompare(b.name);
    });
  }, [sessions]);

  // ── Saved DB configs — only needed for collapsed-view avatars ──
  // DatabasesPanel owns its own copy for the expanded view.
  const SAVED_DBS_CACHE_KEY = "sql-saved-dbs";
  const [savedDBsCollapsed, setSavedDBsCollapsed] = useState<SavedDBConfig[]>(
    () => {
      try {
        const cached = localStorage.getItem(SAVED_DBS_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      return [];
    },
  );

  const dbTabCount = useMemo(
    () => tabs.filter((t) => t.type === "database").length,
    [tabs],
  );

  useEffect(() => {
    let cancelled = false;
    window.novadeck.sql
      .configGetStandalone()
      .then((result) => {
        if (!cancelled && result?.success && Array.isArray(result.data)) {
          setSavedDBsCollapsed(result.data as SavedDBConfig[]);
          // Warm the cache so DatabasesPanel renders instantly on first open
          try { localStorage.setItem(SAVED_DBS_CACHE_KEY, JSON.stringify(result.data)); } catch {}
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dbTabCount]);

  const savedDBsNotOpenCollapsed = useMemo(() => {
    const openIds = new Set(
      tabs.filter((t) => t.type === "database").map((t) => t.sessionId),
    );
    return savedDBsCollapsed.filter((db) => !openIds.has(db.sessionId));
  }, [savedDBsCollapsed, tabs]);

  // ── Import / Export dialogs (shared across both panels) ──
  const { createSession, reload: reloadSessions } = useSession();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // ── Session form for collapsed sidebar "+" button ──
  const [collapsedFormOpen, setCollapsedFormOpen] = useState(false);
  const { sessionFormRequested, clearSessionFormRequest } = useUIStore();

  useEffect(() => {
    if (sessionFormRequested && !sidebarOpen) {
      setCollapsedFormOpen(true);
      clearSessionFormRequest();
    }
  }, [sessionFormRequested, sidebarOpen, clearSessionFormRequest]);

  const handleCollapsedFormSave = useCallback(
    async (data: SessionFormData) => {
      const sessionData = {
        name: data.name || `${data.username}@${data.host}`,
        group: data.group || undefined,
        host: data.host,
        port: data.port,
        username: data.username,
        auth: data.auth,
        proxy: data.proxy,
        overrides: data.overrides,
        color: data.color || undefined,
        defaultDirectory: data.defaultDirectory || undefined,
        startupCommands: data.startupCommands,
        encoding: data.encoding,
        shellCommand: data.shellCommand || undefined,
        terminalType: data.terminalType,
        environmentVariables: data.environmentVariables,
        viewPreferences: data.viewPreferences,
        notes: data.notes || undefined,
      };
      await createSession(sessionData as Parameters<typeof createSession>[0]);
      toast.success(
        "Session created",
        `${data.name || data.host} has been added`,
      );
      setCollapsedFormOpen(false);
    },
    [createSession],
  );

  // ── Auto-switch panel when the active tab type changes ──
  // (e.g. user clicks a DB tab from collapsed view → switch to Databases panel)
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;
    if (activeTab.type === "database" && sidebarPanel !== "databases") {
      setSidebarPanel("databases");
    } else if (activeTab.type !== "database" && sidebarPanel !== "sessions") {
      setSidebarPanel("sessions");
    }
    // Intentionally omit sidebarPanel from deps — we only react to activeTabId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-nd-bg-secondary border-r border-nd-border shrink-0 transition-all duration-200 overflow-hidden",
      )}
      style={{ width }}
    >
      {/* ── Header ── */}
      <div
        className={cn(
          "flex items-center h-10 shrink-0 border-b border-nd-border",
          sidebarOpen ? "px-2 gap-1" : "justify-center px-0",
        )}
      >
        {sidebarOpen && (
          <>
            <PanelTab
              icon={<Server size={13} />}
              label="Sessions"
              active={sidebarPanel === "sessions"}
              onClick={() => setSidebarPanel("sessions")}
            />
            <PanelTab
              icon={<Database size={13} />}
              label="Databases"
              active={sidebarPanel === "databases"}
              onClick={() => setSidebarPanel("databases")}
            />
            <div className="flex-1" />
          </>
        )}

        <Tooltip
          content={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          side="right"
        >
          <button
            onClick={toggleSidebar}
            className="p-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors shrink-0"
          >
            {sidebarOpen ? (
              <ChevronLeft size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        </Tooltip>
      </div>

      {sidebarOpen ? (
        <>
          {/* ── Active panel ── */}
          {sidebarPanel === "sessions" ? (
            <SessionManager onConnect={onConnect} />
          ) : (
            <DatabasesPanel
              onConnectDatabase={onConnectDatabase}
              onOpenSavedDatabase={onOpenSavedDatabase}
            />
          )}

          {/* ── Bottom utility bar ── */}
          <div className="shrink-0 border-t border-nd-border px-3 py-2 flex items-center gap-1">
            <Tooltip content="Settings" side="top">
              <button
                onClick={toggleSettings}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Settings size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Client Key Manager" side="top">
              <button
                onClick={toggleClientKeyManager}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <KeyRound size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Host Key Manager" side="top">
              <button
                onClick={toggleHostKeyManager}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Shield size={15} />
              </button>
            </Tooltip>
            <div className="flex-1" />
            <Tooltip content="Import Data" side="top">
              <button
                onClick={() => setImportDialogOpen(true)}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Download size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Export Data" side="top">
              <button
                onClick={() => setExportDialogOpen(true)}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Upload size={15} />
              </button>
            </Tooltip>
          </div>
        </>
      ) : (
        /* ── Collapsed icon-only view ── */
        <div className="flex flex-col items-center flex-1 overflow-hidden">
          {/* Quick-add button — scoped to the active panel */}
          <div className="shrink-0 py-1.5 w-full flex flex-col items-center gap-0.5 border-b border-nd-border">
            {sidebarPanel === "sessions" ? (
              <Tooltip content="New Session" side="right">
                <button
                  onClick={() => useUIStore.getState().requestSessionForm()}
                  className="flex items-center justify-center w-9 h-7 rounded-md text-nd-accent hover:bg-nd-surface transition-colors"
                >
                  <Plus size={16} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="New Database Connection" side="right">
                <button
                  onClick={onConnectDatabase}
                  className="flex items-center justify-center w-9 h-7 rounded-md text-nd-accent hover:bg-nd-surface transition-colors"
                >
                  <Plus size={16} />
                </button>
              </Tooltip>
            )}
          </div>

          {/* Connection avatars — scoped to the active panel */}
          <div className="flex flex-col items-center gap-0.5 py-1.5 flex-1 overflow-y-auto scrollbar-none w-full">
            {/* SSH session avatars — sessions panel only */}
            {sidebarPanel === "sessions" &&
              sortedSessions.map((session) => {
                const tab = tabs.find((t) => t.sessionId === session.id);
                const isConnected = tab?.status === "connected";
                const isConnecting =
                  tab?.status === "connecting" ||
                  tab?.status === "authenticating";
                const isError = tab?.status === "error";
                const isActive = tab?.id === activeTabId;
                const isSelected = selectedSessionId === session.id && !tab;

                return (
                  <Tooltip
                    key={session.id}
                    content={`${session.name}${
                      isConnected
                        ? " (connected)"
                        : isConnecting
                          ? " (connecting)"
                          : isError
                            ? " (error)"
                            : ""
                    }`}
                    side="right"
                  >
                    <button
                      onClick={() => {
                        if (tab) {
                          setActiveTab(tab.id);
                          setSelectedSessionId(null);
                        } else {
                          setActiveTab(null);
                          setSelectedSessionId(session.id);
                        }
                      }}
                      onDoubleClick={() => {
                        if (!tab) onConnect(session);
                      }}
                      className={cn(
                        "relative flex items-center justify-center w-9 h-8 rounded-md transition-colors shrink-0",
                        isActive
                          ? "bg-nd-accent/15 ring-1 ring-nd-accent"
                          : isSelected
                            ? "bg-nd-surface/80 ring-1 ring-nd-border"
                            : "hover:bg-nd-surface opacity-60 hover:opacity-100",
                      )}
                    >
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white/90"
                        style={{ backgroundColor: session.color || "#71717a" }}
                      >
                        {session.name.charAt(0).toUpperCase()}
                      </div>

                      {isConnected && (
                        <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-success border border-nd-bg-secondary" />
                      )}
                      {isConnecting && (
                        <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-warning border border-nd-bg-secondary animate-pulse" />
                      )}
                      {isError && (
                        <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-error border border-nd-bg-secondary" />
                      )}
                    </button>
                  </Tooltip>
                );
              })}

            {/* Open standalone database tab avatars — databases panel only */}
            {sidebarPanel === "databases" &&
              tabs
                .filter((t) => t.type === "database")
                .map((dbTab) => {
                  const isActive = dbTab.id === activeTabId;
                  const isDbConnected = dbTab.status === "connected";
                  const isDbConnecting = dbTab.status === "connecting";
                  return (
                    <Tooltip
                      key={dbTab.id}
                      content={dbTab.sessionName || "Database"}
                      side="right"
                    >
                      <button
                        onClick={() => {
                          setActiveTab(dbTab.id);
                          setSelectedSessionId(null);
                        }}
                        className={cn(
                          "relative flex items-center justify-center w-9 h-8 rounded-md transition-colors shrink-0",
                          isActive
                            ? "bg-nd-accent/15 ring-1 ring-nd-accent"
                            : "hover:bg-nd-surface opacity-60 hover:opacity-100",
                        )}
                      >
                        <div className="w-6 h-6 rounded flex items-center justify-center bg-indigo-600">
                          <Database size={12} className="text-white/90" />
                        </div>
                        {isDbConnected && (
                          <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-success border border-nd-bg-secondary" />
                        )}
                        {isDbConnecting && (
                          <span className="absolute bottom-0.5 right-1 w-2 h-2 rounded-full bg-nd-warning border border-nd-bg-secondary animate-pulse" />
                        )}
                      </button>
                    </Tooltip>
                  );
                })}

            {/* Saved-but-not-open database avatars — databases panel only */}
            {sidebarPanel === "databases" &&
              savedDBsNotOpenCollapsed.map((db) => {
                const label =
                  db.connectionName ||
                  `${db.type.toUpperCase()} · ${db.database || db.host}`;
                return (
                  <Tooltip key={db.sessionId} content={label} side="right">
                    <button
                      onClick={() => onOpenSavedDatabase(db.sessionId, label)}
                      className="relative flex items-center justify-center w-9 h-8 rounded-md transition-colors shrink-0 opacity-50 hover:opacity-100 hover:bg-nd-surface"
                    >
                      <div className="w-6 h-6 rounded flex items-center justify-center bg-indigo-600/50">
                        <Database size={12} className="text-white/70" />
                      </div>
                    </button>
                  </Tooltip>
                );
              })}
          </div>

          {/* Bottom utility icons */}
          <div className="flex flex-col items-center gap-1 py-2 shrink-0 border-t border-nd-border w-full">
            <Tooltip content="Client Key Manager" side="right">
              <button
                onClick={toggleClientKeyManager}
                className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <KeyRound size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Host Key Manager" side="right">
              <button
                onClick={toggleHostKeyManager}
                className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Shield size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Settings" side="right">
              <button
                onClick={toggleSettings}
                className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Settings size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Session form — rendered at sidebar level so it works when collapsed */}
      {collapsedFormOpen && (
        <SessionForm
          open={collapsedFormOpen}
          onClose={() => setCollapsedFormOpen(false)}
          groups={[
            ...new Set(
              sessions.map((s) => s.group).filter(Boolean) as string[],
            ),
          ]}
          onSave={handleCollapsedFormSave}
        />
      )}

      {/* Import / Export dialogs */}
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
      />
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onComplete={() => {
          reloadSessions();
          // Invalidate saved-DBs cache so DatabasesPanel picks up imported standalone DB configs
          localStorage.removeItem("sql-saved-dbs");
        }}
      />
    </aside>
  );
}
