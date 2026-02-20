import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Plus, Edit2, Trash2, Tag, Terminal, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useSnippetStore } from '@/stores/snippetStore'
import { v4 as uuid } from 'uuid'
import type { Snippet } from '@/types/snippet'

interface SnippetManagerProps {
  open: boolean
  onClose: () => void
  onInsert: (command: string) => void
}

export function SnippetManager({ open, onClose, onInsert }: SnippetManagerProps) {
  const {
    snippets, categories, searchQuery, selectedCategory,
    loadSnippets, addSnippet, updateSnippet, removeSnippet,
    setSearchQuery, setSelectedCategory
  } = useSnippetStore()

  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formCommand, setFormCommand] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formNewCategory, setFormNewCategory] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [useNewCategory, setUseNewCategory] = useState(false)

  useEffect(() => {
    if (open) {
      loadSnippets()
    }
  }, [open, loadSnippets])

  const filteredSnippets = useMemo(() => {
    let filtered = snippets
    if (selectedCategory) {
      filtered = filtered.filter((s) => s.category === selectedCategory)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      )
    }
    return filtered
  }, [snippets, selectedCategory, searchQuery])

  const openNewForm = useCallback(() => {
    setEditingSnippet(null)
    setFormName('')
    setFormCommand('')
    setFormCategory(categories[0] || '')
    setFormNewCategory('')
    setFormDescription('')
    setUseNewCategory(categories.length === 0)
    setIsFormOpen(true)
  }, [categories])

  const openEditForm = useCallback((snippet: Snippet) => {
    setEditingSnippet(snippet)
    setFormName(snippet.name)
    setFormCommand(snippet.command)
    setFormCategory(snippet.category)
    setFormNewCategory('')
    setFormDescription(snippet.description || '')
    setUseNewCategory(false)
    setIsFormOpen(true)
  }, [])

  const handleSave = useCallback(async () => {
    const category = useNewCategory ? formNewCategory.trim() : formCategory
    if (!formName.trim() || !formCommand.trim() || !category) return

    if (editingSnippet) {
      await updateSnippet(editingSnippet.id, {
        name: formName.trim(),
        command: formCommand.trim(),
        category,
        description: formDescription.trim() || undefined
      })
    } else {
      const now = Date.now()
      await addSnippet({
        id: uuid(),
        name: formName.trim(),
        command: formCommand.trim(),
        category,
        description: formDescription.trim() || undefined,
        createdAt: now,
        updatedAt: now
      })
    }
    setIsFormOpen(false)
  }, [editingSnippet, formName, formCommand, formCategory, formNewCategory, formDescription, useNewCategory, updateSnippet, addSnippet])

  const handleDelete = useCallback(async (id: string) => {
    await removeSnippet(id)
  }, [removeSnippet])

  const handleInsert = useCallback((command: string) => {
    onInsert(command)
    onClose()
  }, [onInsert, onClose])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Command Snippets"
      maxWidth="max-w-3xl"
    >
      <div className="flex gap-4 h-[420px] -mx-5 -my-4 px-5 py-4">
        {/* Left sidebar — categories */}
        <div className="w-44 shrink-0 flex flex-col gap-1 border-r border-nd-border pr-3 overflow-y-auto">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`text-left text-xs px-2.5 py-1.5 rounded transition-colors ${
              selectedCategory === null
                ? 'bg-nd-accent text-white'
                : 'text-nd-text-secondary hover:bg-nd-surface hover:text-nd-text-primary'
            }`}
          >
            All Snippets
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`text-left text-xs px-2.5 py-1.5 rounded transition-colors truncate ${
                selectedCategory === cat
                  ? 'bg-nd-accent text-white'
                  : 'text-nd-text-secondary hover:bg-nd-surface hover:text-nd-text-primary'
              }`}
            >
              <Tag size={10} className="inline mr-1.5 -mt-0.5" />
              {cat}
            </button>
          ))}
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar: search + new */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search snippets..."
                className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
              />
            </div>
            <Button variant="primary" size="sm" onClick={openNewForm}>
              <Plus size={13} />
              New
            </Button>
          </div>

          {/* Snippet list or form */}
          {isFormOpen ? (
            <div className="flex-1 overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-nd-text-primary">
                  {editingSnippet ? 'Edit Snippet' : 'New Snippet'}
                </h3>
                <button onClick={() => setIsFormOpen(false)} className="text-nd-text-muted hover:text-nd-text-primary transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] text-nd-text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Restart Nginx"
                    className="w-full h-7 px-2.5 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-nd-text-muted mb-1">Command</label>
                  <textarea
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    placeholder="sudo systemctl restart nginx"
                    rows={3}
                    className="w-full px-2.5 py-1.5 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors font-mono resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-nd-text-muted mb-1">Category</label>
                  {useNewCategory ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={formNewCategory}
                        onChange={(e) => setFormNewCategory(e.target.value)}
                        placeholder="New category name"
                        className="flex-1 h-7 px-2.5 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
                      />
                      {categories.length > 0 && (
                        <button
                          onClick={() => setUseNewCategory(false)}
                          className="text-[11px] text-nd-accent hover:underline"
                        >
                          Existing
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value)}
                        className="flex-1 h-7 px-2 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary focus:outline-none focus:border-nd-accent transition-colors"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setUseNewCategory(true)}
                        className="text-[11px] text-nd-accent hover:underline whitespace-nowrap"
                      >
                        + New
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] text-nd-text-muted mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Brief description..."
                    className="w-full h-7 px-2.5 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={!formName.trim() || !formCommand.trim() || (!useNewCategory ? !formCategory : !formNewCategory.trim())}
                >
                  {editingSnippet ? 'Update' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {filteredSnippets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-nd-text-muted">
                  <Terminal size={28} className="mb-2 opacity-40" />
                  <p className="text-xs">
                    {snippets.length === 0 ? 'No snippets yet. Create one!' : 'No matching snippets.'}
                  </p>
                </div>
              ) : (
                filteredSnippets.map((snippet) => (
                  <div
                    key={snippet.id}
                    className="group flex items-start gap-3 p-2.5 rounded-md border border-nd-border bg-nd-bg-primary hover:border-nd-accent/40 transition-colors cursor-pointer"
                    onClick={() => handleInsert(snippet.command)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-nd-text-primary truncate">
                          {snippet.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-nd-surface text-nd-text-muted border border-nd-border shrink-0">
                          {snippet.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-nd-text-muted font-mono truncate">
                        {snippet.command}
                      </p>
                      {snippet.description && (
                        <p className="text-[10px] text-nd-text-muted mt-0.5 truncate">
                          {snippet.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openEditForm(snippet)
                        }}
                        className="p-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(snippet.id)
                        }}
                        className="p-1 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-surface transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
