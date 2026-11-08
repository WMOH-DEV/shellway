import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import { readArchive, safeArchivePath, writeArchive, writeFiles } from './projectArchive'

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sw-archive-'))
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

function tarOf(dir: string): Buffer {
  return execFileSync('tar', ['-C', dir, '--format=ustar', '-czf', '-', '.'])
}

function header(name: string, type: string, size = 0): Buffer {
  const block = Buffer.alloc(512)
  block.write(name, 0)
  block.write('0000644\0', 100)
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  block.write(type, 156)
  block.write('ustar\0', 257)
  return block
}

describe('readArchive and writeArchive', () => {
  it('copies files and folders, keeping scripts executable', async () => {
    const source = join(base, 'source')
    mkdirSync(join(source, 'app', 'Http'), { recursive: true })
    writeFileSync(join(source, 'artisan'), '#!/usr/bin/env php\n', { mode: 0o755 })
    writeFileSync(join(source, 'app', 'Http', 'Kernel.php'), '<?php\n')
    const target = join(base, 'target')
    mkdirSync(target)
    await writeArchive(target, readArchive(tarOf(source)))
    expect(readFileSync(join(target, 'app', 'Http', 'Kernel.php'), 'utf8')).toBe('<?php\n')
    expect(statSync(join(target, 'artisan')).mode & 0o111).not.toBe(0)
  })

  it('refuses links, so nothing can be written outside the project', () => {
    const source = join(base, 'source')
    mkdirSync(source)
    symlinkSync('/etc', join(source, 'escape'))
    expect(() => readArchive(tarOf(source))).toThrow(/link or special file/)
  })

  it('refuses a path that climbs out of the project', () => {
    const archive = gzipSync(Buffer.concat([header('../evil.txt', '0'), Buffer.alloc(1024)]))
    expect(() => readArchive(archive)).toThrow(/unsafe path/)
  })

  it('refuses an archive that is cut short', () => {
    const archive = gzipSync(Buffer.concat([header('big.txt', '0', 4096), Buffer.alloc(512)]))
    expect(() => readArchive(archive)).toThrow(/cut short/)
  })
})

describe('safeArchivePath', () => {
  it.each(['/etc/passwd', 'a/../../b', 'a/./b', 'a\\b', ''])('refuses %j', (path) => {
    expect(() => safeArchivePath(path)).toThrow(/unsafe path/)
  })

  it('accepts a normal relative path', () => {
    expect(safeArchivePath('./resources/views/welcome.blade.php')).toBe('resources/views/welcome.blade.php')
  })
})

describe('writeFiles', () => {
  it('never replaces a file that is already there', async () => {
    writeFileSync(join(base, 'index.html'), 'mine')
    await expect(writeFiles(base, { 'index.html': 'new' })).rejects.toThrow()
    expect(readFileSync(join(base, 'index.html'), 'utf8')).toBe('mine')
  })
})
