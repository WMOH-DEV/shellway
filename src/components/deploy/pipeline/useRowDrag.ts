import { useState, type DragEvent } from 'react'

const ROW_SELECTOR = '[data-step-row]'

export function useRowDrag(onMove: (from: number, to: number) => void) {
  const [from, setFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  const reset = () => {
    setFrom(null)
    setOver(null)
  }

  const start = (index: number) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    const row = e.currentTarget.closest(ROW_SELECTOR)
    if (row) e.dataTransfer.setDragImage(row, 16, 16)
    setFrom(index)
  }

  const hover = (index: number) => (e: DragEvent<HTMLElement>) => {
    if (from === null) return
    e.preventDefault()
    setOver(index)
  }

  const drop = (index: number) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    if (from !== null) onMove(from, index)
    reset()
  }

  return {
    isDropTarget: (index: number) => from !== null && over === index && from !== index,
    isDragging: (index: number) => from === index,
    handleProps: (index: number) => ({ draggable: true, onDragStart: start(index), onDragEnd: reset }),
    rowProps: (index: number) => ({ onDragOver: hover(index), onDrop: drop(index) })
  }
}

export type RowDrag = ReturnType<typeof useRowDrag>
