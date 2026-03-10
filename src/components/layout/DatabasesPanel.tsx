import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Database, Plus, Search, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useConnectionStore } from "@/stores/connectionStore";
import { getSQLConnectionState, useSQLStore } from "@/stores/sqlStore";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";

/** Minimal shape returned by SQLConfigStore for standalone DB configs */
interface SavedDBConfig {
  sessionId: string;
  connectionName?: string;
  type: "mysql" | "postgres";
  host: string;
  port: number;
  database: string;
}

interface DatabasesPanelProps {
  /** Open the SQL connect dialog to add a new standalone DB connection */
  onConnectDatabase: () => void;
  /** Re-open a previously saved (but currently closed) DB connection */
  onOpenSavedDatabase: (savedSessionId: string, name?: string) => void;
}

/**
 * Sidebar panel for standalone database connections.
 *
 * Responsibilities:
 *  - List currently-open database tabs (type === 'database')
 *  - List saved-but-not-open database configs from SQLConfigStore
 *  - Provide a search input that filters both lists
 *  - Provide a "New Connection" button to open the SQL connect dialog
 */
export function DatabasesPanel({
  onConnectDatabase,
  onOpenSavedDatabase,
}: DatabasesPanelProps) {
  const { tabs, activeTabId, setActiveTab, removeTab } = useConnectionStore();

  // ── Saved standalone DB configs ──
  const [savedDBs, setSavedDBs] = useState<SavedDBConfig[]>([]);

  // Refresh saved configs only when the count of open DB tabs changes
  // (new connection saved / tab closed)
  const dbTabCount = useMemo(
    () => tabs.filter((t) => t.type === "database").length,
    [tabs],
  );

  const loadSavedDBs = useCallback(async () => {
    try {
      const result = await window.novadeck.sql.configGetStandalone();
      if (result?.success && Array.isArray(result.data)) {
        setSavedDBs(result.data as SavedDBConfig[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSavedDBs();
  }, [loadSavedDBs, dbTabCount]);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const q = searchQuery.toLowerCase();

  // ── Derived data ──

  const openDBTabs = useMemo(
    () => tabs.filter((t) => t.type === "database"),
    [tabs],
  );

  const openSessionIds = useMemo(
    () => new Set(openDBTabs.map((t) => t.sessionId)),
    [openDBTabs],
  );

  const savedDBsNotOpen = useMemo(
    () => savedDBs.filter((db) => !openSessionIds.has(db.sessionId)),
    [savedDBs, openSessionIds],
  );

  // Filter open tabs by sessionName
  const filteredOpenTabs = useMemo(() => {
    if (!q) return openDBTabs;
    return openDBTabs.filter((t) =>
      (t.sessionName ?? "").toLowerCase().includes(q),
    );
  }, [openDBTabs, q]);

  // Filter saved-but-not-open by display label (connectionName or fallback)
  // Only match against the visible label — searching by host/database/type caused
  // false positives (e.g. all connections to a host matching the query would appear)
  const filteredSavedDBs = useMemo(() => {
    if (!q) return savedDBsNotOpen;
    return savedDBsNotOpen.filter((db) => {
      const label = (
        db.connectionName ||
        `${db.type.toUpperCase()} · ${db.database || db.host}`
      ).toLowerCase();
      return label.includes(q);
    });
  }, [savedDBsNotOpen, q]);

  const hasResults = filteredOpenTabs.length > 0 || filteredSavedDBs.length > 0;
  const isEmpty = openDBTabs.length === 0 && savedDBsNotOpen.length === 0;

  // ── Handlers ──

  const handleCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const sqlState = getSQLConnectionState(tabId);
      if (sqlState.sqlSessionId) {
        window.novadeck.sql.disconnect(sqlState.sqlSessionId).catch(() => {});
      }
      useSQLStore.getState().removeConnection(tabId);
      removeTab(tabId);
    },
    [removeTab],
  );

  const handleDeleteSaved = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      window.novadeck.sql
        .configDelete(sessionId)
        .then(() =>
          setSavedDBs((prev) => prev.filter((d) => d.sessionId !== sessionId)),
        )
        .catch(() => {});
    },
    [],
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Toolbar: New Connection + Search toggle ── */}
      <div className="px-3 pt-2 pb-2 shrink-0 flex gap-1.5">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={onConnectDatabase}
        >
          <Plus size={14} />
          New Connection
        </Button>
        <Tooltip content="Search databases" side="right">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              requestAnimationFrame(() => searchInputRef.current?.focus())
            }
            className={searchQuery ? "text-nd-accent" : ""}
          >
            <Search size={14} />
          </Button>
        </Tooltip>
      </div>

      {/* ── Search input ── */}
      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted pointer-events-none"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                searchInputRef.current?.blur();
              }
            }}
            placeholder="Search databases..."
            className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
          />
        </div>
      </div>

      {/* ── Connection list ── */}
      <div className="flex-1 overflow-y-auto px-2">
        {isEmpty ? (
          /* Empty state — no connections at all */
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-nd-surface flex items-center justify-center mb-3">
              <Database size={20} className="text-nd-text-muted" />
            </div>
            <p className="text-sm text-nd-text-secondary">No databases yet</p>
            <p className="text-2xs text-nd-text-muted mt-1">
              Add a new connection to get started
            </p>
          </div>
        ) : !hasResults ? (
          /* Search returned no results */
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-nd-surface flex items-center justify-center mb-3">
              <Search size={20} className="text-nd-text-muted" />
            </div>
            <p className="text-sm text-nd-text-secondary">
              No matching databases
            </p>
            <p className="text-2xs text-nd-text-muted mt-1">
              Try a different search term
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 pb-2">
            {/* Open database tabs */}
            {filteredOpenTabs.length > 0 && (
              <>
                <p className="text-2xs font-semibold text-nd-text-muted uppercase tracking-wider px-1 pt-1 pb-0.5">
                  Open
                </p>
                {filteredOpenTabs.map((dbTab) => {
                  const isActive = dbTab.id === activeTabId;
                  return (
                    <button
                      key={dbTab.id}
                      onClick={() => setActiveTab(dbTab.id)}
                      className={cn(
                        "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
                        isActive
                          ? "bg-nd-accent/10 text-nd-accent border border-nd-accent/30"
                          : "text-nd-text-secondary hover:bg-nd-surface",
                      )}
                    >
                      <Database
                        size={13}
                        className={
                          isActive
                            ? "text-nd-accent shrink-0"
                            : "text-nd-text-muted shrink-0"
                        }
                      />
                      <span className="truncate flex-1 text-left">
                        {dbTab.sessionName || "Database"}
                      </span>
                      <span
                        role="button"
                        onClick={(e) => handleCloseTab(dbTab.id, e)}
                        className="p-0.5 rounded text-nd-text-muted hover:text-nd-error transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        title="Close"
                      >
                        <X size={12} />
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {/* Saved but not open */}
            {filteredSavedDBs.length > 0 && (
              <>
                <p className="text-2xs font-semibold text-nd-text-muted uppercase tracking-wider px-1 pt-2 pb-0.5">
                  Saved
                </p>
                {filteredSavedDBs.map((db) => {
                  const label =
                    db.connectionName ||
                    `${db.type.toUpperCase()} · ${db.database || db.host}`;
                  return (
                    <button
                      key={db.sessionId}
                      onClick={() => onOpenSavedDatabase(db.sessionId, label)}
                      className="group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface transition-colors"
                    >
                      <Database
                        size={13}
                        className="text-nd-text-muted opacity-50 shrink-0"
                      />
                      <span className="truncate flex-1 text-left">{label}</span>
                      <span
                        role="button"
                        onClick={(e) => handleDeleteSaved(db.sessionId, e)}
                        className="p-0.5 rounded text-nd-text-muted hover:text-nd-error transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        title="Delete saved connection"
                      >
                        <X size={12} />
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
