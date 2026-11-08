export const LEFT_IN_PLACE = 'It was left in place.'

export const leftInPlace = (reason: string): string => `${reason} ${LEFT_IN_PLACE}`

export const changedByHand = (path: string): string => leftInPlace(`${path} changed after Shellway wrote it.`)
