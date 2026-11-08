import type { CreateSiteInput, LaravelJobs, ServerTools } from '@/types/createSite'
import { EXIT_REFUSED } from '../ssl/originCa/exitCodes'
import { heredoc } from '../ssl/originCa/heredoc'
import { pinPhpVersion } from './php'
import { assertFolder, assertOwner, assertSiteName } from './validate'

type JobFacts = Pick<CreateSiteInput, 'siteName' | 'folder' | 'owner' | 'phpVersion' | 'server'>

export interface JobFiles {
  cronFile: string | null
  unitFile: string | null
}

export const ALL_JOBS: LaravelJobs = { scheduler: true, queueWorker: true }

export const NO_JOBS: LaravelJobs = { scheduler: false, queueWorker: false }

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const fileStem = (siteName: string): string => `shellway-${assertSiteName(siteName).replace(/\./g, '-')}`

export const queueUnitName = (siteName: string): string => `${fileStem(siteName)}-queue.service`

export function jobFiles(siteName: string, jobs: LaravelJobs): JobFiles {
  return {
    cronFile: jobs.scheduler ? `/etc/cron.d/${fileStem(siteName)}` : null,
    unitFile: jobs.queueWorker ? `/etc/systemd/system/${queueUnitName(siteName)}` : null
  }
}

export function availableJobs(tools: Pick<ServerTools, 'cron' | 'systemd'>, wanted: LaravelJobs): LaravelJobs {
  return { scheduler: wanted.scheduler && tools.cron, queueWorker: wanted.queueWorker && tools.systemd }
}

const isRhel = ({ server }: Pick<CreateSiteInput, 'server'>): boolean => server.kind === 'apache' && server.layout === 'rhel'

const artisan = (facts: JobFacts): string => (isRhel(facts) ? 'php artisan' : pinPhpVersion('php artisan', facts.phpVersion))

export const cronText = (facts: JobFacts): string =>
  `* * * * * ${assertOwner(facts.owner)} cd ${assertFolder(facts.folder)} && ${artisan(facts)} schedule:run >> /dev/null 2>&1\n`

export function unitText(facts: JobFacts): string {
  return [
    '[Unit]',
    `Description=Laravel queue worker for ${assertSiteName(facts.siteName)}`,
    'After=network.target',
    '',
    '[Service]',
    `User=${assertOwner(facts.owner)}`,
    `WorkingDirectory=${assertFolder(facts.folder)}`,
    `ExecStart=/usr/bin/env ${artisan(facts)} queue:work --sleep=3 --tries=3 --max-time=3600`,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    ''
  ].join('\n')
}

const refuseIfOther = (path: string, text: string): string[] => [
  `if [ -e ${quote(path)} ] && ! cmp -s ${quote(path)} - ${heredoc(text).trimEnd()}`,
  `then echo ${quote(`${path} already exists. Nothing was changed.`)} >&2; exit ${EXIT_REFUSED}; fi`
]

const writeFile = (path: string, text: string): string => `cat > ${quote(path)} ${heredoc(text).trimEnd()}`

export function createJobsScript(facts: JobFacts, jobs: LaravelJobs): string {
  const { cronFile, unitFile } = jobFiles(facts.siteName, jobs)
  const cron = cronText(facts)
  const unit = unitText(facts)
  return [
    'set -e',
    ...(cronFile ? refuseIfOther(cronFile, cron) : []),
    ...(unitFile ? refuseIfOther(unitFile, unit) : []),
    ...(cronFile ? [writeFile(cronFile, cron), `chmod 644 ${quote(cronFile)}`] : []),
    ...(unitFile ? [writeFile(unitFile, unit), 'systemctl daemon-reload', `systemctl enable --now ${quote(queueUnitName(facts.siteName))}`] : []),
    ''
  ].join('\n')
}

export function removeJobsScript(siteName: string, files: JobFiles): string {
  const unit = queueUnitName(siteName)
  return [
    'set -e',
    ...(files.unitFile
      ? [
          `if [ -e ${quote(files.unitFile)} ]; then`,
          `  systemctl disable --now ${quote(unit)} || true`,
          `  rm -f ${quote(files.unitFile)}`,
          '  systemctl daemon-reload',
          'fi'
        ]
      : []),
    ...(files.cronFile ? [`rm -f ${quote(files.cronFile)}`] : []),
    ''
  ].join('\n')
}
