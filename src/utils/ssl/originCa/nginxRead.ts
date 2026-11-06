import type { ServerFacts } from '../../../types/ssl'

export const isFullyRead = (facts: ServerFacts): boolean => facts.nginxParse === 'full'

export const CHANGE_NEEDS_FULL_READ = 'Shellway could not read the whole nginx configuration, so it cannot safely change this site.'

export const REMOVE_NEEDS_FULL_READ = 'Shellway could not read the whole nginx configuration, so it cannot tell whether another site still uses this certificate.'
