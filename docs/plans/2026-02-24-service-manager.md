# Service Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Service Manager sub-tab to SSH connections that lets users view, control, and inspect systemd services on remote servers.

**Architecture:** New sub-tab within ConnectionView following the exact Monitor tab pattern. Backend service executes `systemctl` and `journalctl` commands over SSH. Zustand store with per-connection state. Real-time polling for service status with manual refresh.

**Tech Stack:** React + TypeScript + Tailwind CSS + Zustand + xterm.js (for log viewer) + ssh2 (command execution)

---

## Feature Scope

### What We're Building
1. **Service List** — All systemd services with status indicators (running/stopped/failed/etc.)
2. **Service Actions** — Start / Stop / Restart / Enable / Disable buttons
3. **Service Logs** — View recent logs via `journalctl -u <service>`
4. **Service Details** — Unit file path, description, dependencies, resource usage
5. **Config Quick-Edit** — Show config file path with link to open in SFTP editor
6. **Search & Filter** — Filter by name, status, type
7. **Bulk Actions** — Select multiple services for batch operations

### What We're NOT Building
- Package installation/removal
- Distro detection or package management
- Config file editing (we link to SFTP editor)
- Non-systemd init systems (Phase 1 is systemd-only)

---

## Task 1: Types & Interfaces

**Files:**
- Create: `src/types/serviceManager.ts`

Define all TypeScript types for the Service Manager feature:

```typescript
/** Systemd unit info from systemctl list-units */
export interface SystemdService {
  unit: string           // e.g. "nginx.service"
  load: 'loaded' | 'not-found' | 'masked' | 'error' | string
  active: 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | string
  sub: 'running' | 'dead' | 'exited' | 'failed' | 'waiting' | 'listening' | string
  description: string
}

/** Extended service details from systemctl show */
export interface ServiceDetails {
  unit: string
  description: string
  loadState: string
  activeState: string
  subState: string
  unitFileState: string      // enabled, disabled, static, masked
  fragmentPath: string       // path to the unit file
  mainPID: number
  execMainStartTimestamp: string
  activeEnterTimestamp: string
  inactiveEnterTimestamp: string
  memoryCurrentBytes?: number
  cpuUsageNSec?: number
  tasksCurrent?: number
  restartCount?: number
  type?: string              // simple, forking, oneshot, etc.
  requires?: string[]
  wantedBy?: string[]
  after?: string[]
  before?: string[]
}

/** A single log entry from journalctl */
export interface ServiceLogEntry {
  timestamp: string
  priority: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | string
  message: string
  unit?: string
}

/** Service action types */
export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable' | 'mask' | 'unmask'

/** Service Manager connection status */
export type ServiceManagerStatus = 'idle' | 'loading' | 'active' | 'error' | 'unsupported'

/** Filter/sort state for the service list */
export interface ServiceFilter {
  search: string
  activeFilter: 'all' | 'active' | 'inactive' | 'failed'
  loadFilter: 'all' | 'loaded' | 'not-found' | 'masked'
  sortBy: 'name' | 'active' | 'sub' | 'description'
  sortDir: 'asc' | 'desc'
}
```

---

## Task 2: Backend Service

**Files:**
- Create: `electron/services/ServiceManagerService.ts`

Build the main process service that executes systemctl/journalctl commands over SSH. Follow `MonitorService.ts` patterns exactly.

**Key methods:**
- `listServices(conn)` — `systemctl list-units --type=service --all --no-pager --no-legend --plain`
- `getServiceDetails(conn, unit)` — `systemctl show <unit> --no-pager`
- `performAction(conn, unit, action)` — `sudo systemctl <action> <unit>`
- `getLogs(conn, unit, lines?, since?)` — `journalctl -u <unit> --no-pager -n <lines> --output=json`
- `probe(conn)` — `systemctl --version` to check systemd availability

**Pattern:** Use `conn._client.exec(script, callback)` for SSH command execution, exactly like MonitorService.

**Important:** All commands must handle:
- Permission errors (non-root for start/stop → suggest sudo)
- Service not found errors
- Timeout handling (5s default)
- Parse errors (fallback gracefully)

---

## Task 3: IPC Handler

**Files:**
- Create: `electron/ipc/servicemanager.ipc.ts`
- Modify: `electron/main.ts` (add registration)

Register IPC channels following the `monitor.ipc.ts` pattern:

| Channel | Args | Returns |
|---------|------|---------|
| `services:list` | `connectionId` | `{ success, data?: SystemdService[], error? }` |
| `services:details` | `connectionId, unit` | `{ success, data?: ServiceDetails, error? }` |
| `services:action` | `connectionId, unit, action` | `{ success, error? }` |
| `services:logs` | `connectionId, unit, lines?, since?` | `{ success, data?: ServiceLogEntry[], error? }` |
| `services:probe` | `connectionId` | `{ success, systemdVersion?, error? }` |

Export `registerServiceManagerIPC()` and `getServiceManagerService()`.

---

## Task 4: Preload Bridge

**Files:**
- Modify: `electron/preload.ts`

Add `services` namespace to `window.novadeck`:

```typescript
services: {
  list(connectionId: string): Promise<{ success: boolean; data?: unknown[]; error?: string }>
  details(connectionId: string, unit: string): Promise<{ success: boolean; data?: unknown; error?: string }>
  action(connectionId: string, unit: string, action: string): Promise<{ success: boolean; error?: string }>
  logs(connectionId: string, unit: string, lines?: number, since?: string): Promise<{ success: boolean; data?: unknown[]; error?: string }>
  probe(connectionId: string): Promise<{ success: boolean; systemdVersion?: string; error?: string }>
}
```

---

## Task 5: Zustand Store

**Files:**
- Create: `src/stores/serviceManagerStore.ts`

Per-connection state keyed by connectionId (follow `monitorStore.ts` pattern):

```typescript
interface ServiceManagerState {
  services: Map<string, SystemdService[]>           // connectionId → services
  details: Map<string, ServiceDetails | null>       // connectionId → selected service details
  logs: Map<string, ServiceLogEntry[]>              // connectionId → selected service logs
  status: Map<string, ServiceManagerStatus>         // connectionId → status
  errors: Map<string, string | null>                // connectionId → error
  selectedUnit: Map<string, string | null>          // connectionId → selected service name
  filter: Map<string, ServiceFilter>                // connectionId → filter state

  // Actions
  setServices(connectionId: string, services: SystemdService[]): void
  setDetails(connectionId: string, details: ServiceDetails | null): void
  setLogs(connectionId: string, logs: ServiceLogEntry[]): void
  setStatus(connectionId: string, status: ServiceManagerStatus): void
  setError(connectionId: string, error: string | null): void
  setSelectedUnit(connectionId: string, unit: string | null): void
  setFilter(connectionId: string, filter: Partial<ServiceFilter>): void
  clearConnection(connectionId: string): void
}
```

---

## Task 6: Service Manager UI — Main View Component

**Files:**
- Create: `src/components/services/ServiceManagerView.tsx`

The main container component. Layout: toolbar at top, service list on left (or full width), detail panel on right (when service selected).

**Sections:**
1. **Toolbar**: Search input, filter dropdowns (Active/Inactive/Failed), refresh button, status indicator
2. **Service List**: Table/grid of all services with columns: Status dot, Name, Sub-state, Description, Quick Actions
3. **Detail Panel** (slide-in or split): Selected service details, logs, config path

**Props:** `connectionId: string, sessionId: string, connectionStatus: ConnectionStatus`

**Lifecycle:**
- On mount: probe systemd → if supported, list services
- On unmount: cleanup store data
- Auto-refresh: poll every 30s when tab is active

---

## Task 7: Service List Component

**Files:**
- Create: `src/components/services/ServiceList.tsx`

Sortable, filterable table of services with:
- Status indicator (green dot = active/running, red = failed, gray = inactive, yellow = activating)
- Service name (clickable → opens detail panel)
- Sub-state badge
- Description (truncated)
- Quick action buttons: Restart, Stop/Start toggle
- Checkbox for bulk selection
- Keyboard navigation (up/down arrows, Enter to select)

**Performance:** Use virtualized list for servers with hundreds of services.

---

## Task 8: Service Detail Panel

**Files:**
- Create: `src/components/services/ServiceDetailPanel.tsx`

Shows detailed info for the selected service:

**Info section:**
- Unit name, description, type
- Status with colored badge
- PID, memory, CPU, tasks
- Uptime (calculated from timestamps)
- Unit file enabled/disabled state
- Unit file path → "Open in SFTP" button

**Dependencies section:**
- Requires, WantedBy, After, Before lists

**Actions section:**
- Start / Stop / Restart / Reload buttons
- Enable / Disable toggle
- Mask / Unmask option (in overflow menu)
- Confirmation dialog for destructive actions (stop, disable, mask)

---

## Task 9: Service Log Viewer

**Files:**
- Create: `src/components/services/ServiceLogViewer.tsx`

Displays journalctl output for the selected service:
- Color-coded by priority (red=err/crit, yellow=warning, white=info, gray=debug)
- Timestamp + message format
- "Load more" button (fetch older entries)
- "Follow" mode toggle (auto-scroll to bottom, poll for new entries)
- Copy log to clipboard button
- Line count selector (50, 100, 500, 1000)

---

## Task 10: ConnectionView Integration

**Files:**
- Modify: `src/types/session.ts` — Add `'services'` to `activeSubTab` union
- Modify: `src/components/ConnectionView.tsx` — Add sub-tab entry + render block

Add to `SUB_TABS` array:
```typescript
{ id: 'services', label: 'Services', icon: <Cog size={13} /> }
```

Add render block (conditional render like Monitor — unmounts to stop polling):
```tsx
{tab.activeSubTab === 'services' && runningSubTabs.has('services') && (
  <div className="absolute inset-0 flex flex-col">
    <Suspense fallback={...}>
      <ServiceManagerView connectionId={tab.id} sessionId={tab.sessionId} connectionStatus={tab.status} />
    </Suspense>
  </div>
)}
```

Add cleanup in `handleShutdownSubTab` for services store.

---

## Implementation Order

Tasks 1-4 (backend): Can be done in sequence (types → service → IPC → preload)
Task 5 (store): After types
Tasks 6-9 (UI): After store + preload. Task 6 first, then 7-9 can be parallel.
Task 10 (integration): Last — wires everything together.
