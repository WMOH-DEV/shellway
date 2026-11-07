import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parseBackups } from './backups'
import { cronContent, parseCron, SCHEDULED_SCRIPT } from './backupScripts'
import { mysqlProbe, parseMysql, summarizeGrants } from './mysql'
import { parsePostgres, postgresProbe } from './postgres'
import { parseRedis, redisProbe } from './redis'
import { parseSiteEnvs, siteEnvProbe } from './siteEnv'
import { backupsProbe } from './backups'

const MYSQL_OK = [
  '@@version',
  '8.0.39-0ubuntu0.24.04.2',
  '@@listen',
  '127.0.0.1:3306',
  '127.0.0.1:33060',
  '@@databases',
  'information_schema\t0\t79',
  'mysql\t2637824\t38',
  'shop_prod\t1932735283\t64',
  'shop_staging\t100663296\t64',
  '@@users',
  'readonly\t10.0.0.%\tcaching_sha2_password',
  'root\tlocalhost\tauth_socket',
  'shop\tlocalhost\tcaching_sha2_password',
  "@@grants 'readonly'@'10.0.0.%'",
  'GRANT SELECT ON *.* TO `readonly`@`10.0.0.%`',
  "@@grants 'root'@'localhost'",
  'GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION',
  "@@grants 'shop'@'localhost'",
  'GRANT USAGE ON *.* TO `shop`@`localhost`',
  'GRANT ALL PRIVILEGES ON `shop_prod`.* TO `shop`@`localhost`',
  'GRANT ALL PRIVILEGES ON `shop\\_staging`.* TO `shop`@`localhost`',
  ''
].join('\n')

describe('parseMysql', () => {
  it('reads version, listen addresses, databases and users', () => {
    const facts = parseMysql(MYSQL_OK)
    expect(facts).toMatchObject({ status: 'ok', flavor: 'mysql', version: '8.0.39', listen: ['127.0.0.1:3306', '127.0.0.1:33060'] })
    expect(facts.databases.find((database) => database.name === 'shop_prod')).toEqual({ name: 'shop_prod', sizeBytes: 1932735283, tables: 64, owner: null, system: false })
    expect(facts.databases.find((database) => database.name === 'mysql')?.system).toBe(true)
    expect(facts.users).toEqual([
      { name: 'readonly', host: '10.0.0.%', grants: ['SELECT on *.*'], socketLogin: false, superuser: false },
      { name: 'root', host: 'localhost', grants: ['ALL on *.*'], socketLogin: true, superuser: true },
      { name: 'shop', host: 'localhost', grants: ['ALL on shop_prod, shop_staging'], socketLogin: false, superuser: false }
    ])
  })

  it('detects MariaDB and its unix_socket root', () => {
    const facts = parseMysql(
      [
        '@@version',
        '10.11.6-MariaDB-0+deb12u1',
        '@@users',
        'root\tlocalhost\tmysql_native_password',
        "@@grants 'root'@'localhost'",
        "GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` IDENTIFIED VIA mysql_native_password USING 'invalid' OR unix_socket WITH GRANT OPTION"
      ].join('\n')
    )
    expect(facts.flavor).toBe('mariadb')
    expect(facts.version).toBe('10.11.6')
    expect(facts.users[0].socketLogin).toBe(true)
  })

  it('reports missing, stopped and no socket access', () => {
    expect(parseMysql('@@missing\n').status).toBe('missing')
    expect(parseMysql("@@failed\nERROR 2002 (HY000): Can't connect to local MySQL server through socket '/var/run/mysqld/mysqld.sock' (2)\n").status).toBe('stopped')
    const denied = parseMysql("@@failed\nERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)\n")
    expect(denied.status).toBe('no-access')
    expect(denied.reason).toMatch(/socket login/)
  })
})

describe('summarizeGrants', () => {
  it('counts long privilege lists instead of listing them', () => {
    expect(summarizeGrants(['GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON `app`.* TO `app`@`%`'])).toEqual(['5 privileges on app'])
  })

  it('reads MySQL 8 root grants that list every privilege as ALL', () => {
    const privileges = Array.from({ length: 30 }, (_, index) => `PRIV_${index}`).join(',')
    expect(summarizeGrants([`GRANT ${privileges} ON *.* TO \`root\`@\`localhost\` WITH GRANT OPTION`, "GRANT PROXY ON ``@`` TO `root`@`localhost` WITH GRANT OPTION"])).toEqual(['ALL on *.*'])
  })

  it('ignores role grants and USAGE', () => {
    expect(summarizeGrants(['GRANT USAGE ON *.* TO `a`@`%`', 'GRANT `admin`@`%` TO `a`@`%`'])).toEqual([])
  })
})

describe('parsePostgres', () => {
  it('reads databases with owners and roles', () => {
    const facts = parsePostgres(
      [
        '@@version',
        '16.4 (Ubuntu 16.4-0ubuntu0.24.04.2)',
        '@@listen',
        '127.0.0.1:5432',
        '@@databases',
        'api_prod\tapi\t440401920',
        'postgres\tpostgres\t7631663',
        '@@users',
        'api\tf\tt',
        'postgres\tt\tt',
        'reporting\tf\tf'
      ].join('\n')
    )
    expect(facts).toMatchObject({ status: 'ok', version: '16.4' })
    expect(facts.databases[0]).toEqual({ name: 'api_prod', sizeBytes: 440401920, tables: null, owner: 'api', system: false })
    expect(facts.users).toEqual([
      { name: 'api', host: null, grants: ['owns api_prod'], socketLogin: false, superuser: false },
      { name: 'postgres', host: null, grants: ['superuser'], socketLogin: true, superuser: true },
      { name: 'reporting', host: null, grants: ['cannot sign in'], socketLogin: false, superuser: false }
    ])
  })

  it('reports a stopped server and missing peer access', () => {
    expect(parsePostgres('@@failed\npsql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\n').status).toBe('stopped')
    expect(parsePostgres('@@failed\npsql: error: FATAL:  Peer authentication failed for user "postgres"\n').status).toBe('no-access')
  })
})

describe('parseRedis', () => {
  it('reads server, memory and keyspace', () => {
    const facts = parseRedis(
      ['@@info', '# Server\r', 'redis_version:7.2.4\r', 'tcp_port:6379\r', 'uptime_in_seconds:3600\r', '# Clients\r', 'connected_clients:3\r', '# Memory\r', 'used_memory_human:1.52M\r', 'maxmemory_human:0B\r', '# Keyspace\r', 'db0:keys=120,expires=4,avg_ttl=0\r'].join('\n')
    )
    expect(facts).toEqual({ status: 'ok', reason: '', version: '7.2.4', port: 6379, uptimeSeconds: 3600, usedMemory: '1.52M', maxMemory: '0B', clients: 3, keyspace: [{ db: 'db0', keys: 120, expires: 4 }] })
  })

  it('says when a password is needed or the server is down', () => {
    expect(parseRedis('@@info\nNOAUTH Authentication required.\n').status).toBe('needs-password')
    expect(parseRedis('@@info\nCould not connect to Redis at 127.0.0.1:6379: Connection refused\n').status).toBe('stopped')
    expect(parseRedis('@@missing\n').status).toBe('missing')
  })
})

describe('parseBackups', () => {
  it('reads the schedule, last result and files', () => {
    const facts = parseBackups(
      [
        '@@cron',
        'abc123',
        '# Shellway database backups',
        '30 3 * * * root /usr/local/lib/shellway/db-backup.sh 7 >/dev/null 2>&1',
        '@@script',
        'def456',
        '@@last',
        'status=failed',
        'at=1762480800',
        'saved=2',
        'failed=1',
        'note=mysql:legacy_old',
        '@@files',
        '1762480800.5\t432013312\t/var/backups/shellway/db/mysql/shop_prod-20251107-030000.sql.gz',
        '1762480000.1\t1000\t/var/backups/shellway/db/mysql/evil;rm-20251107-030000.sql.gz'
      ].join('\n')
    )
    expect(facts.schedule).toEqual({ hour: 3, minute: 30, keepDays: 7 })
    expect(facts.cronSha256).toBe('abc123')
    expect(facts.scriptSha256).toBe('def456')
    expect(facts.last).toEqual({ ok: false, at: 1762480800000, saved: 2, failed: 1, note: 'mysql:legacy_old' })
    expect(facts.files).toEqual([{ path: '/var/backups/shellway/db/mysql/shop_prod-20251107-030000.sql.gz', engine: 'mysql', database: 'shop_prod', sizeBytes: 432013312, modifiedAt: 1762480800500 }])
  })

  it('reads an unscheduled server', () => {
    expect(parseBackups('@@cron\n@@script\n@@last\n@@files\n')).toEqual({ schedule: null, cronContent: null, cronSha256: null, scriptSha256: null, last: null, files: [] })
  })

  it('round-trips the cron line', () => {
    expect(parseCron(cronContent({ hour: 2, minute: 5, keepDays: 14 }))).toEqual({ hour: 2, minute: 5, keepDays: 14 })
  })
})

describe('parseSiteEnvs', () => {
  it('decodes env files and reads their database settings', () => {
    const env = 'APP_NAME=Shop\nDB_CONNECTION=mysql\nDB_DATABASE="shop_prod"\nDB_USERNAME=shop\nDB_PASSWORD=secret\n'
    const encoded = Buffer.from(env).toString('base64')
    const facts = parseSiteEnvs(['@@site shop', '/var/www/shop-deploy/shared/.env', 'deploy:deploy 640', 'sha', `b64:${encoded}`, '@@site api', '/var/www/api/.env'].join('\n'))
    expect(facts.deployInstalled).toBe(true)
    expect(facts.sites[0]).toMatchObject({ site: 'shop', path: '/var/www/shop-deploy/shared/.env', readable: true, owner: 'deploy:deploy', mode: '640', sha256: 'sha', content: env })
    expect(facts.sites[0].db).toEqual({ connection: 'mysql', database: 'shop_prod', username: 'shop' })
    expect(facts.sites[1]).toMatchObject({ site: 'api', readable: false, content: '' })
  })

  it('handles a server without the deploy runner', () => {
    expect(parseSiteEnvs('@@nodeploy\n')).toEqual({ deployInstalled: false, sites: [] })
  })
})

describe('probe scripts', () => {
  it.each([mysqlProbe, postgresProbe, redisProbe, backupsProbe, siteEnvProbe].map((probe) => [probe.id, probe.script]))('%s is valid sh', (_id, script) => {
    expect(() => execFileSync('sh', ['-n'], { input: script })).not.toThrow()
  })

  it('the scheduled backup script is valid sh', () => {
    expect(() => execFileSync('sh', ['-n'], { input: SCHEDULED_SCRIPT })).not.toThrow()
  })
})
