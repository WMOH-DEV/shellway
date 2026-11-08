const instance = (status: string, restarts: number, uptime: number) => ({
  pid: 4100,
  name: 'admin',
  pm_id: 0,
  monit: { memory: 52_000_000, cpu: 0.3 },
  pm2_env: {
    status,
    restart_time: restarts,
    pm_uptime: uptime,
    pm_cwd: '/var/www/admin/current',
    pm_exec_path: '/var/www/admin/current/dist/server.js',
    args: ['--port', '3000'],
    exec_mode: 'cluster_mode',
    APP_KEY: 'secret-value-that-must-not-leak'
  }
})

export const PM2_STDOUT = [
  '@@pm2 deploy',
  '[PM2] Spawning PM2 daemon',
  JSON.stringify([instance('online', 1, 1_793_000_000_000), instance('online', 2, 1_792_990_000_000)]),
  '',
  '@@end',
  '@@pm2 root',
  JSON.stringify([{ name: 'bot', pm2_env: { status: 'errored', restart_time: 15, pm_cwd: '/opt/bot', pm_exec_path: '/opt/bot/index.js', args: [] } }]),
  '',
  '@@end',
  '@@pm2 www-data',
  '',
  '@@end',
  ''
].join('\n')
