import { useEffect, useRef, type MutableRefObject } from 'react'

export function useMounted(): MutableRefObject<boolean> {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}
