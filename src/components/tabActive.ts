import { createContext, useContext } from 'react'

export const TabActiveContext = createContext(true)

export const useTabActive = (): boolean => useContext(TabActiveContext)
