# Proof of Concept: Implementing an SQL Client in Shellway

Adding an SQL client (similar to TablePlus or DBeaver) to Shellway is a **highly feasible but moderately complex** undertaking.

Because Shellway already has robust SSH connection management and port forwarding capabilities, the hardest part of building a secure database client—connecting to databases behind firewalls via SSH tunnels—is already solved!

## Is it Easy or Complicated?

**The Backend (Easy to Moderate):**
Connecting to databases from Node.js is straightforward. We can use established libraries like `pg` (PostgreSQL), `mysql2` (MySQL/MariaDB), and `sqlite3` (SQLite). Since we already have SSH tunnels, we just need to route the database connection through a local forwarded port.

**The Frontend (Moderate to Complicated):**
Building a high-quality database UI is the most challenging part. It requires:

1. **A robust Data Grid:** Rendering thousands of rows efficiently without freezing the app (requires virtualization, e.g., `ag-grid` or `react-data-grid`).
2. **A powerful SQL Editor:** Syntax highlighting, auto-completion, and error checking (e.g., using `Monaco Editor` which powers VS Code).
3. **Schema Introspection:** Fetching and displaying tables, views, columns, and indexes in a sidebar tree.

---

## Architecture POC

Here is a high-level Proof of Concept for how we would implement this in Shellway's architecture.

### 1. Backend Service (`electron/services/SQLService.ts`)

We would create a service to manage database connections and execute queries.

```typescript
import { createConnection, Connection } from "mysql2/promise";
import { Client } from "pg";

export class SQLService {
  private connections: Map<string, any> = new Map();

  // Connect to a database (potentially through an SSH tunnel we already established)
  async connect(sessionId: string, config: DBConfig) {
    try {
      if (config.type === "mysql") {
        const conn = await createConnection({
          host: config.host, // e.g., 127.0.0.1 if tunneled
          port: config.port,
          user: config.user,
          password: config.password,
          database: config.database,
        });
        this.connections.set(sessionId, { type: "mysql", conn });
      } else if (config.type === "postgres") {
        const client = new Client(config);
        await client.connect();
        this.connections.set(sessionId, { type: "postgres", conn: client });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Execute a query and return results
  async executeQuery(sessionId: string, query: string) {
    const db = this.connections.get(sessionId);
    if (!db) throw new Error("Not connected");

    try {
      if (db.type === "mysql") {
        const [rows, fields] = await db.conn.execute(query);
        return { rows, fields: fields.map((f) => f.name) };
      } else if (db.type === "postgres") {
        const result = await db.conn.query(query);
        return { rows: result.rows, fields: result.fields.map((f) => f.name) };
      }
    } catch (error) {
      return { error: error.message };
    }
  }
}
```

### 2. IPC Bridge (`electron/ipc/sql.ipc.ts`)

We expose these methods to the React frontend via Electron's IPC.

```typescript
import { ipcMain } from "electron";
import { SQLService } from "../services/SQLService";

export function registerSQLIPC(sqlService: SQLService) {
  ipcMain.handle("sql:connect", async (_, sessionId, config) => {
    return await sqlService.connect(sessionId, config);
  });

  ipcMain.handle("sql:query", async (_, sessionId, query) => {
    return await sqlService.executeQuery(sessionId, query);
  });
}
```

### 3. Frontend UI (`src/components/sql/SQLView.tsx`)

The React frontend would use a split view: a sidebar for tables, a top pane for the SQL editor, and a bottom pane for the data grid.

```tsx
import React, { useState } from "react";
import Editor from "@monaco-editor/react"; // For SQL editing
import DataGrid from "react-data-grid"; // For rendering results

export function SQLView({ sessionId }) {
  const [query, setQuery] = useState("SELECT * FROM users LIMIT 100;");
  const [results, setResults] = useState({ columns: [], rows: [] });
  const [loading, setLoading] = useState(false);

  const runQuery = async () => {
    setLoading(true);
    try {
      // Call the Electron backend
      const response = await window.electron.ipcRenderer.invoke(
        "sql:query",
        sessionId,
        query,
      );
      if (response.error) {
        alert("Query Error: " + response.error);
      } else {
        // Format columns for the data grid
        const columns = response.fields.map((f) => ({ key: f, name: f }));
        setResults({ columns, rows: response.rows });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* SQL Editor Pane */}
      <div className="h-1/2 border-b border-gray-700">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme="vs-dark"
          value={query}
          onChange={(val) => setQuery(val || "")}
        />
        <button
          onClick={runQuery}
          disabled={loading}
          className="absolute top-2 right-2 bg-blue-600 px-4 py-1 rounded"
        >
          {loading ? "Running..." : "Run Query"}
        </button>
      </div>

      {/* Results Data Grid Pane */}
      <div className="h-1/2 bg-gray-900">
        {results.columns.length > 0 ? (
          <DataGrid
            columns={results.columns}
            rows={results.rows}
            className="h-full rdg-dark"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No results
          </div>
        )}
      </div>
    </div>
  );
}
```

## Summary

**Pros of adding it to Shellway:**

- **Killer Feature:** Combining SSH, SFTP, and SQL in one app makes it a true "Swiss Army Knife" for developers.
- **Shared Infrastructure:** We already have the SSH tunneling logic, which is usually the hardest part of building a secure SQL client.
- **Unified UI:** Users don't need to switch between Shellway and TablePlus.

**Challenges to consider:**

- **Bundle Size:** Adding database drivers (`pg`, `mysql2`) and heavy UI libraries (`monaco-editor`, `ag-grid`) will increase the app size.
- **Native Dependencies:** Some database drivers use native C++ bindings (like `sqlite3`), which require recompilation for different platforms (macOS, Windows, Linux) during the Electron build process. Pure JavaScript drivers (like `mysql2` and `pg`) are preferred to avoid this.
- **Data Types:** Handling complex SQL data types (BLOBs, JSON, Dates, Geometries) correctly in the UI requires careful parsing.

**Conclusion:**
It is **very doable** and would be an incredible addition to the app. The best approach would be to start with a single database type (e.g., MySQL or PostgreSQL) using a pure JS driver, build a basic query runner, and iteratively add schema browsing and inline editing later.
