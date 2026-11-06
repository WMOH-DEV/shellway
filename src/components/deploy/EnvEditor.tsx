import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/components/ui/Toast'
import '@/components/sftp/monacoViewer'
import { MONACO_THEME, syncMonacoTheme } from '@/components/ui/tokenThemes'
import { deployApi } from './useDeploySites'

interface EnvEditorProps {
  connectionId: string
  site: string
  canApply: boolean
  onApply: () => void
}

const EDITOR_OPTIONS = {
  fontSize: 12,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  renderWhitespace: 'trailing' as const,
  automaticLayout: true
}

export function EnvEditor({ connectionId, site, canApply, onApply }: EnvEditorProps) {
  const [path, setPath] = useState('')
  const [original, setOriginal] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saveRef = useRef<() => void>(() => {})

  useEffect(() => {
    setOriginal(null)
    setError(null)
    void deployApi().readEnv(connectionId, site).then((result) => {
      if (!result.success || !result.data) {
        setError(result.error ?? 'Could not read the env file')
        return
      }
      setPath(result.data.path)
      setOriginal(result.data.content)
      setContent(result.data.content)
    })
  }, [connectionId, site])

  const dirty = original !== null && content !== original

  const save = async (thenApply: boolean) => {
    setSaving(true)
    const result = await deployApi().writeEnv(connectionId, site, content)
    setSaving(false)
    if (!result.success) {
      toast.error('Could not save the env file', result.error)
      return
    }
    setOriginal(content)
    toast.success('Env file saved', 'The previous version was backed up on the server')
    if (thenApply) onApply()
  }

  saveRef.current = () => { if (dirty && !saving) void save(false) }

  const handleMount: OnMount = (editor, monaco) => {
    syncMonacoTheme(monaco)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
  }

  if (error) return <div className="p-4 text-xs text-nd-error-fg">{error}</div>
  if (original === null) return <div className="p-4 text-xs text-nd-text-muted">Loading…</div>

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-2xs text-nd-text-muted">{path}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save(false)}>Save</Button>
          {canApply && (
            <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save(true)}>Save and apply</Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-nd-border">
        <Editor
          language="ini"
          theme={MONACO_THEME}
          value={content}
          onChange={(value) => setContent(value ?? '')}
          onMount={handleMount}
          options={EDITOR_OPTIONS}
          loading={<Spinner />}
        />
      </div>
      <div className="text-2xs text-nd-text-muted">
        Save and apply runs this site's after-going-live commands (like config:cache) on the live code, so the change takes effect without a new deploy.
      </div>
    </div>
  )
}
