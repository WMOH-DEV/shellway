import React, { useCallback, useRef, useState } from 'react'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  classifyBatch,
  isReadOnlyBatch,
  KIND_LABEL,
  type BatchRisk
} from '@/utils/sqlStatementKind'
import type { ConnectionTag, SafeMode } from '@/types/sql'

// ── Mode catalogue ──

export interface SafeModeOption {
  value: SafeMode
  label: string
  description: string
  dotClass: string
}

export const SAFE_MODE_OPTIONS: SafeModeOption[] = [
  {
    value: 'silent',
    label: 'Silent Mode',
    description: 'Send queries to the server without any warnings',
    dotClass: 'bg-nd-text-muted'
  },
  {
    value: 'warn-all',
    label: 'Alert Mode 1',
    description: 'Warn before sending any query to the server',
    dotClass: 'bg-amber-400'
  },
  {
    value: 'warn-writes',
    label: 'Alert Mode 2',
    description: 'Warn before sending queries, except SELECT / EXPLAIN / SHOW',
    dotClass: 'bg-amber-400'
  },
  {
    value: 'password-all',
    label: 'Safe Mode 1',
    description: 'Ask for confirmation credentials before sending any query',
    dotClass: 'bg-red-500'
  },
  {
    value: 'password-writes',
    label: 'Safe Mode 2',
    description:
      'Ask for confirmation credentials, except SELECT / EXPLAIN / SHOW',
    dotClass: 'bg-red-500'
  }
]

export function resolveDefaultSafeMode(
  tag?: ConnectionTag,
  isProduction?: boolean
): SafeMode {
  return tag === 'production' || isProduction ? 'warn-writes' : 'silent'
}

// ── Gate hook ──

export interface SafeModeGateOptions {
  mode: SafeMode
  password?: string
  databaseName: string
}

interface GateRequest {
  sql: string
  risk: BatchRisk
  requiresSecret: boolean
}

const PREVIEW_LINES = 12

function previewOf(sql: string): string {
  const lines = sql.trim().split('\n')
  if (lines.length <= PREVIEW_LINES) return lines.join('\n')
  return `${lines.slice(0, PREVIEW_LINES).join('\n')}\n…`
}

export function useSafeModeGate({
  mode,
  password,
  databaseName
}: SafeModeGateOptions) {
  const [request, setRequest] = useState<GateRequest | null>(null)
  const [entry, setEntry] = useState('')
  const [entryError, setEntryError] = useState<string | null>(null)
  const resolverRef = useRef<((approved: boolean) => void) | null>(null)

  const usesPassword = !!password && password.length > 0
  const expectedSecret = usesPassword ? password : databaseName

  const requestApproval = useCallback(
    (sql: string): Promise<boolean> => {
      if (mode === 'silent') return Promise.resolve(true)

      const risk = classifyBatch(sql)
      if (risk.statementCount === 0) return Promise.resolve(true)

      const skipsReads = mode === 'warn-writes' || mode === 'password-writes'
      if (skipsReads && isReadOnlyBatch(risk)) return Promise.resolve(true)

      const requiresSecret =
        mode === 'password-all' || mode === 'password-writes'

      setEntry('')
      setEntryError(null)

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
        setRequest({ sql, risk, requiresSecret })
      })
    },
    [mode]
  )

  const settle = useCallback((approved: boolean) => {
    resolverRef.current?.(approved)
    resolverRef.current = null
    setRequest(null)
    setEntry('')
    setEntryError(null)
  }, [])

  const handleCancel = useCallback(() => settle(false), [settle])

  const handleConfirm = useCallback(() => {
    if (request?.requiresSecret && entry !== expectedSecret) {
      setEntryError(
        usesPassword
          ? 'That does not match this connection'
          : `Type the database name (${databaseName}) to confirm`
      )
      return
    }
    settle(true)
  }, [request, entry, expectedSecret, usesPassword, databaseName, settle])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleConfirm()
    },
    [handleConfirm]
  )

  const risk = request?.risk
  const danger = risk?.highest === 'schema' || (risk?.unboundedCount ?? 0) > 0

  const gateDialog = (
    <Modal
      open={!!request}
      onClose={handleCancel}
      title="Confirm before running"
      maxWidth="max-w-xl"
    >
      {request && risk && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div
              className={
                danger
                  ? 'p-2 rounded-full bg-nd-error/10'
                  : 'p-2 rounded-full bg-amber-500/10'
              }
            >
              <ShieldAlert
                size={20}
                className={danger ? 'text-nd-error' : 'text-amber-400'}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-nd-text-primary">
                {risk.statementCount === 1
                  ? '1 statement will run on this connection'
                  : `${risk.statementCount} statements will run on this connection`}
              </p>
              <p className="text-xs text-nd-text-muted">
                Highest risk: {KIND_LABEL[risk.highest]} · Database:{' '}
                {databaseName || 'none selected'}
              </p>
            </div>
          </div>

          {risk.unboundedCount > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-nd-error/10 border border-nd-error/30">
              <TriangleAlert size={14} className="text-nd-error mt-0.5 shrink-0" />
              <p className="text-xs text-nd-error">
                {risk.unboundedCount === 1
                  ? '1 statement has no WHERE clause and will affect every row in the table.'
                  : `${risk.unboundedCount} statements have no WHERE clause and will affect every row in their tables.`}
              </p>
            </div>
          )}

          <pre className="max-h-52 overflow-auto rounded-md bg-nd-surface border border-nd-border p-3 text-xs font-mono text-nd-text-secondary whitespace-pre-wrap break-all">
            {previewOf(request.sql)}
          </pre>

          {request.requiresSecret && (
            <Input
              autoFocus
              type={usesPassword ? 'password' : 'text'}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={handleKeyDown}
              error={entryError ?? undefined}
              label={
                usesPassword
                  ? 'Connection password'
                  : `Database name (${databaseName})`
              }
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={danger ? 'danger' : 'primary'}
              onClick={handleConfirm}
            >
              Run query
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )

  return { requestApproval, gateDialog }
}
