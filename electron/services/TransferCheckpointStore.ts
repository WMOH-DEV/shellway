// electron/services/TransferCheckpointStore.ts
//
// Minimal JSON-backed checkpoint store for long-running SQL imports.
// Goal: let the user resume an import that was interrupted (crash, cancel,
// app quit) from the last checkpointed statement, so large restores don't
// have to start from zero.
//
// Each checkpoint is a single JSON file under
//   <userData>/shellway/transfers/<operationId>.checkpoint.json
// On normal completion the writer deletes the file.

import { app } from "electron";
import { mkdir, readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { HealRunMode } from "../../src/types/sql";

export interface TransferCheckpoint {
  /** Original operation ID (kept for diagnostics only — each resume gets a fresh ID). */
  operationId: string;
  /** The SQL file being imported. */
  filePath: string;
  /** Human label (filename, usually). */
  label: string;
  /** Number of successfully-processed statements recorded at checkpoint time. */
  stmtIndex: number;
  /** Bytes of the file read from disk so far. */
  processedBytes: number;
  /** Total file size in bytes (for display). */
  totalBytes: number;
  /** Database type at time of import. */
  dbType: "mysql" | "postgres";
  /** Run mode used for the original import. */
  runMode: HealRunMode;
  /** Wall clock when the checkpoint was last updated. */
  updatedAt: number;
  /** Database name (for display in resume prompt). */
  database?: string;
}

function baseDir(): string {
  const userData = app?.getPath ? app.getPath("userData") : process.cwd();
  return join(userData, "shellway", "transfers");
}

function checkpointPath(operationId: string): string {
  return join(baseDir(), `${operationId}.checkpoint.json`);
}

export async function writeCheckpoint(cp: TransferCheckpoint): Promise<void> {
  try {
    await mkdir(baseDir(), { recursive: true });
    await writeFile(checkpointPath(cp.operationId), JSON.stringify(cp), "utf-8");
  } catch {
    // Checkpoint write failures must not break the import.
  }
}

export async function deleteCheckpoint(operationId: string): Promise<void> {
  try {
    await unlink(checkpointPath(operationId));
  } catch {
    /* already gone */
  }
}

/** List all currently-resumable checkpoints, newest first. */
export async function listCheckpoints(): Promise<TransferCheckpoint[]> {
  try {
    const dir = baseDir();
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const out: TransferCheckpoint[] = [];
    for (const f of files) {
      if (!f.endsWith(".checkpoint.json")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        const cp = JSON.parse(raw) as TransferCheckpoint;
        out.push(cp);
      } catch {
        // Skip corrupt entries
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  } catch {
    return [];
  }
}
