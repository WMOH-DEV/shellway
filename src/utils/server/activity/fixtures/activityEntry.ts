import type { ActivityEntry } from '@/types/server/core'

export function activityEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'a1',
    sessionKey: 's1',
    at: new Date(2026, 10, 7, 9, 12).getTime(),
    area: 'software',
    source: 'action',
    type: 'software.php-ini',
    title: 'Changed PHP 8.3 memory_limit',
    who: 'you',
    durationMs: 2000,
    status: 'done',
    steps: [
      { label: 'Back up php.ini', display: 'sudo -n cp /etc/php/8.3/fpm/php.ini /home/deploy/.shellway/backups/php.ini', output: '', exitCode: 0, status: 'done' },
      { label: 'Test the config', display: 'sudo -n php-fpm8.3 -t', output: 'NOTICE: configuration file test is successful\n', exitCode: 0, status: 'done' }
    ],
    failure: null,
    ...overrides
  }
}
