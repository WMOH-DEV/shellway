const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const PACKAGE = /^[a-z0-9][a-z0-9+.\-]*(:[a-z0-9]+)?(=[A-Za-z0-9.+~:\-]+)?$/

export function assertPackageName(name: string): string {
  if (!PACKAGE.test(name)) throw new Error(`Invalid package name: ${name}`)
  return name
}

export const APT_ENV = 'export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=a'

export const APT_GET = 'apt-get -o DPkg::Lock::Timeout=120 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y'

export const APT_INSTALL = `${APT_GET} install --no-remove`

export function aptInstallScript(packages: string[], { update = true }: { update?: boolean } = {}): string {
  const names = packages.map(assertPackageName).map(quote).join(' ')
  return ['set -e', APT_ENV, ...(update ? [`${APT_GET} update`] : []), `${APT_INSTALL} ${names}`, ''].join('\n')
}

export function aptRemoveScript(packages: string[]): string {
  const names = packages.map(assertPackageName).map(quote).join(' ')
  return ['set -e', APT_ENV, `${APT_GET} remove ${names}`, ''].join('\n')
}
