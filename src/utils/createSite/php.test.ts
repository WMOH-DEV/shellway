import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installComposerScript, installPhpScript, installableVersions, newestFirst, phpNeed, pinPhpVersion } from './php'

const syntaxOk = (script: string) => expect(spawnSync('sh', ['-n'], { input: script }).status).toBe(0)

const PHP = { installed: ['8.4', '8.3'], installable: ['8.5', '8.2'], missingPackages: { '8.4': [], '8.3': ['php8.3-zip'] }, drivers: {} }

describe('PHP versions', () => {
  it('sorts by number, not text, and drops anything that is not a version', () => {
    expect(newestFirst(['8.10', '8.4', '8.4', '7.4', 'x', '9'])).toEqual(['8.10', '8.4', '7.4'])
  })

  it('offers only versions that are not installed and still get security fixes', () => {
    expect(installableVersions(['5.6', '8.1', '8.2', '8.4', '8.5'], ['8.4'])).toEqual(['8.5', '8.2'])
  })

  it('says what a chosen version needs', () => {
    expect(phpNeed(PHP, '8.4')).toEqual({ kind: 'none' })
    expect(phpNeed(PHP, '8.3')).toEqual({ kind: 'add', packages: ['php8.3-zip'] })
    expect(phpNeed(PHP, '8.5').kind).toBe('install')
    expect(phpNeed(PHP, '8.6')).toEqual({ kind: 'unavailable' })
    expect(phpNeed(PHP, '')).toEqual({ kind: 'unavailable' })
  })

  it('adds the database driver the site needs when the version lacks it', () => {
    const php = { ...PHP, drivers: { '8.4': ['sqlite3'] } }
    expect(phpNeed(php, '8.4', 'mysql')).toEqual({ kind: 'add', packages: ['php8.4-mysql'] })
    expect(phpNeed(php, '8.4', 'postgresql')).toEqual({ kind: 'add', packages: ['php8.4-pgsql'] })
    expect(phpNeed(php, '8.4', 'sqlite')).toEqual({ kind: 'none' })
    expect(phpNeed(php, '8.4', null)).toEqual({ kind: 'none' })
  })

  it('does not guess a driver package when the server could not say which drivers it has', () => {
    expect(phpNeed(PHP, '8.4', 'mysql')).toEqual({ kind: 'none' })
  })
})

describe('installPhpScript', () => {
  it('installs only php packages of the chosen version, from apt, and starts FPM', () => {
    const script = installPhpScript('8.5', ['php8.5-fpm', 'php8.5-cli', 'php8.4-fpm', 'evil; rm -rf /'])
    syntaxOk(script)
    expect(script).toContain('apt-get -o DPkg::Lock::Timeout=120 install -y --no-remove php8.5-fpm php8.5-cli\n')
    expect(script).toContain('systemctl enable --now php8.5-fpm')
    expect(script).not.toMatch(/add-apt-repository|evil/)
  })

  it('refuses a version that is not a version', () => {
    expect(() => installPhpScript('8.5; reboot', [])).toThrow()
  })
})

describe('installComposerScript', () => {
  const script = installComposerScript('8.4')

  it('is valid sh that checks the installer checksum before running it', () => {
    syntaxOk(script)
    expect(script.indexOf('hash_file')).toBeLessThan(script.indexOf('composer-setup.php" --quiet'))
    expect(script).toContain('--install-dir=/usr/local/bin --filename=composer')
  })

  it('does nothing when composer is already there', () => {
    const result = spawnSync('sh', ['-s'], { input: `composer() { :; }\n${script}`, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('composer is already installed.')
  })

  it('does not run the installer when the checksum does not match', () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-php-'))
    const fakePhp = [
      '#!/bin/sh',
      'case "$2" in',
      '  *installer.sig*) echo expected ;;',
      '  *hash_file*) echo different ;;',
      '  *copy*) : ;;',
      'esac',
      '[ "$1" = -r ] || echo RAN-INSTALLER',
      ''
    ].join('\n')
    writeFileSync(join(bin, 'php8.4'), fakePhp, { mode: 0o755 })
    const result = spawnSync('sh', ['-s'], { input: script, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin` } })
    rmSync(bin, { recursive: true, force: true })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('did not match its published checksum')
    expect(result.stdout).not.toContain('RAN-INSTALLER')
  })
})

describe('pinPhpVersion', () => {
  it('pins leading php and composer commands and leaves others alone', () => {
    expect(pinPhpVersion('php artisan migrate --force', '8.4')).toBe('php8.4 artisan migrate --force')
    expect(pinPhpVersion('composer install --no-dev', '8.4')).toBe('php8.4 "$(command -v composer)" install --no-dev')
    expect(pinPhpVersion('npm ci', '8.4')).toBe('npm ci')
  })
})
