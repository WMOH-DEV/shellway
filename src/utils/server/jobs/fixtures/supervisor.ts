export const SHOP_CONF = `[program:shop-queue]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/shop/current/artisan queue:work redis --sleep=3 --tries=3
directory=/var/www/shop/current
user=deploy
numprocs=2
autostart=true ; start on boot
stdout_logfile=/var/www/shop/worker.log
environment=A="1",
    B="2"

[group:everything]
programs=shop-queue
`

export const SUPERVISOR_STDOUT = [
  '@@service redis-server loaded inactive',
  '@@service redis not-found inactive',
  '@@service mysql loaded active',
  '@@service mariadb not-found inactive',
  '@@service postgresql not-found inactive',
  '@@status',
  'horizon                          FATAL     Exited too quickly (process log may have details)',
  'shop-queue:shop-queue_00         RUNNING   pid 1201, uptime 2 days, 3:04:05',
  'shop-queue:shop-queue_01         BACKOFF   Exited too quickly (process log may have details)',
  'legacy                           STOPPED   Not started',
  '@@file /etc/supervisor/conf.d/shop.conf 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  SHOP_CONF,
  '@@end',
  '@@file /etc/supervisor/conf.d/shellway-horizon.conf aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '[program:horizon]',
  'command=php artisan horizon',
  'directory=/var/www/api/current',
  'user=deploy',
  '',
  '@@end',
  '@@env redis mysql /var/www/shop/current',
  '@@env - - /var/www/api/current',
  ''
].join('\n')
