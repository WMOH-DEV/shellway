import { useState, useCallback, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Loader2 } from 'lucide-react'

interface CreateDatabaseDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  dbType: 'mysql' | 'postgres'
  /** Called after successful creation with the new database name */
  onCreated: (dbName: string) => void
}

const DB_NAME_REGEX = /^[a-zA-Z0-9_]+$/

const PG_ENCODINGS = [
  { value: 'UTF8', label: 'UTF8' },
  { value: 'LATIN1', label: 'LATIN1' },
  { value: 'SQL_ASCII', label: 'SQL_ASCII' },
  { value: 'WIN1252', label: 'WIN1252' },
]

const PG_TEMPLATES = [
  { value: 'template0', label: 'template0' },
  { value: 'template1', label: 'template1' },
]

export function CreateDatabaseDialog({
  open,
  onClose,
  sqlSessionId,
  dbType,
  onCreated,
}: CreateDatabaseDialogProps) {
  const [dbName, setDbName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // MySQL-specific
  const [charsets, setCharsets] = useState<{ name: string; defaultCollation: string }[]>([])
  const [charset, setCharset] = useState('utf8mb4')
  const [collations, setCollations] = useState<string[]>([])
  const [collation, setCollation] = useState('')
  const [isLoadingCharsets, setIsLoadingCharsets] = useState(false)
  const [isLoadingCollations, setIsLoadingCollations] = useState(false)

  // PostgreSQL-specific
  const [encoding, setEncoding] = useState('UTF8')
  const [template, setTemplate] = useState('template1')

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return
    setDbName('')
    setNameError(null)
    setError(null)
    setIsCreating(false)
    setCharset('utf8mb4')
    setCollation('')
    setCollations([])
    setEncoding('UTF8')
    setTemplate('template1')
  }, [open])

  // Fetch charsets for MySQL when dialog opens
  useEffect(() => {
    if (!open || dbType !== 'mysql' || !sqlSessionId) return

    setIsLoadingCharsets(true)
    ;(async () => {
      try {
        const result = await window.novadeck.sql.getCharsets(sqlSessionId)
        if (result.success && result.data) {
          setCharsets(result.data)
        }
      } catch {
        // Ignore — will use default
      } finally {
        setIsLoadingCharsets(false)
      }
    })()
  }, [open, dbType, sqlSessionId])

  // Fetch collations when charset changes (MySQL only)
  useEffect(() => {
    if (!open || dbType !== 'mysql' || !sqlSessionId || !charset) return

    setIsLoadingCollations(true)
    ;(async () => {
      try {
        const result = await window.novadeck.sql.getCollations(sqlSessionId, charset)
        if (result.success && result.data) {
          setCollations(result.data)
          // Default to first collation, or the charset's default collation
          const charsetInfo = charsets.find((c) => c.name === charset)
          if (charsetInfo?.defaultCollation && result.data.includes(charsetInfo.defaultCollation)) {
            setCollation(charsetInfo.defaultCollation)
          } else if (result.data.length > 0) {
            setCollation(result.data[0])
          } else {
            setCollation('')
          }
        }
      } catch {
        setCollations([])
        setCollation('')
      } finally {
        setIsLoadingCollations(false)
      }
    })()
  }, [open, dbType, sqlSessionId, charset, charsets])

  const validateName = useCallback((name: string) => {
    if (!name.trim()) {
      setNameError(null)
      return
    }
    if (!DB_NAME_REGEX.test(name)) {
      setNameError('Only letters, numbers, and underscores allowed')
    } else {
      setNameError(null)
    }
  }, [])

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDbName(e.target.value)
      // Clear error on change if current value is valid
      if (nameError && DB_NAME_REGEX.test(e.target.value)) {
        setNameError(null)
      }
    },
    [nameError]
  )

  const handleNameBlur = useCallback(() => {
    validateName(dbName)
  }, [dbName, validateName])

  const handleCreate = useCallback(async () => {
    const trimmed = dbName.trim()
    if (!trimmed) return

    if (!DB_NAME_REGEX.test(trimmed)) {
      setNameError('Only letters, numbers, and underscores allowed')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const options: Record<string, string> = { name: trimmed }

      if (dbType === 'mysql') {
        if (charset) options.charset = charset
        if (collation) options.collation = collation
      } else {
        if (encoding) options.encoding = encoding
        if (template) options.template = template
      }

      const result = await window.novadeck.sql.createDatabase(sqlSessionId, options)
      if (result.success) {
        onCreated(trimmed)
      } else {
        setError(result.error ?? 'Failed to create database')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || 'Failed to create database')
    } finally {
      setIsCreating(false)
    }
  }, [dbName, dbType, charset, collation, encoding, template, sqlSessionId, onCreated])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      handleCreate()
    },
    [handleCreate]
  )

  const charsetOptions = charsets.map((c) => ({ value: c.name, label: c.name }))
  const collationOptions = collations.map((c) => ({ value: c, label: c }))

  const isLoading = isLoadingCharsets || isLoadingCollations
  const canCreate = dbName.trim().length > 0 && !nameError && !isCreating

  return (
    <Modal open={open} onClose={onClose} title="Create Database" maxWidth="max-w-sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Database name */}
        <Input
          label="Database Name"
          value={dbName}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          placeholder="my_database"
          error={nameError ?? undefined}
          autoFocus
        />

        {/* MySQL options */}
        {dbType === 'mysql' && (
          <div className="flex flex-col gap-3">
            <Select
              label="Character Set"
              options={charsetOptions.length > 0 ? charsetOptions : [{ value: 'utf8mb4', label: 'utf8mb4' }]}
              value={charset}
              onChange={(e) => setCharset(e.target.value)}
              disabled={isLoadingCharsets}
            />
            <div className="relative">
              <Select
                label="Collation"
                options={collationOptions.length > 0 ? collationOptions : [{ value: '', label: 'Loading...' }]}
                value={collation}
                onChange={(e) => setCollation(e.target.value)}
                disabled={isLoadingCollations || collationOptions.length === 0}
              />
              {isLoadingCollations && (
                <Loader2
                  size={14}
                  className="animate-spin text-nd-text-muted absolute right-8 top-[30px]"
                />
              )}
            </div>
          </div>
        )}

        {/* PostgreSQL options */}
        {dbType === 'postgres' && (
          <div className="flex flex-col gap-3">
            <Select
              label="Encoding"
              options={PG_ENCODINGS}
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
            />
            <Select
              label="Template"
              options={PG_TEMPLATES}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md bg-nd-error/10 border border-nd-error/20 px-3 py-2">
            <p className="text-xs text-nd-error">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canCreate}>
            {isCreating && <Loader2 size={14} className="animate-spin" />}
            {isLoading ? 'Loading...' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
