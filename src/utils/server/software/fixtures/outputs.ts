const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

export const UPDATES_UBUNTU = `@@upgrade
Inst openssl [3.0.13-0ubuntu3.1] (3.0.13-0ubuntu3.4 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
Inst libssh-4 [0.10.6-2build2] (0.10.6-2ubuntu0.1 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])
Inst nginx [1.24.0-2ubuntu7.1] (1.24.0-2ubuntu7.3 Ubuntu:24.04/noble-updates [amd64])
Inst php8.3-fpm [8.3.6-0ubuntu0.24.04.2] (8.3.6-0ubuntu0.24.04.3 Ubuntu:24.04/noble-updates [amd64]) []
@@held
docker-ce
@@stamp
1761000000
@@now
1762641600
@@reboot
yes
@@reboot-pkgs
linux-image-6.8.0-47-generic
linux-base
linux-image-6.8.0-47-generic
@@needrestart
NEEDRESTART-VER: 3.6
NEEDRESTART-KCUR: 6.8.0-45-generic
NEEDRESTART-KEXP: 6.8.0-47-generic
NEEDRESTART-KSTA: 3
NEEDRESTART-UCSTA: 1
NEEDRESTART-SVC: nginx.service
NEEDRESTART-SVC: php8.3-fpm.service
NEEDRESTART-SVC: nginx.service
`

export const UPDATES_DEBIAN = `@@upgrade
Inst libc6 [2.36-9+deb12u7] (2.36-9+deb12u9 Debian-Security:12/stable-security [amd64])
Inst tzdata (2024b-0+deb12u1 Debian:12.8/stable [all])
@@held
@@stamp
@@now
1762641600
@@reboot
@@reboot-pkgs
@@needrestart
missing
`

export const PACKAGES_UBUNTU = `@@dpkg
nginx\tinstall ok installed\t1.24.0-2ubuntu7.1
nginx-core\tunknown ok not-installed\t
apache2\tdeinstall ok config-files\t2.4.58-1ubuntu8
nodejs\tinstall ok installed\t20.18.0-1nodesource1
mysql-server\tinstall ok installed\t8.0.40-0ubuntu0.24.04.1
mysql-server-8.0\tinstall ok installed\t8.0.40-0ubuntu0.24.04.1
redis-server\tinstall ok installed\t5:7.0.15-1build2
docker-ce\tinstall ok installed\t5:27.3.1-1~ubuntu.24.04~noble
supervisor\tinstall ok installed\t4.2.5-1
unattended-upgrades\tinstall ok installed\t2.9.1+nmu4ubuntu1
git\tinstall ok installed\t1:2.43.0-1ubuntu7.1
curl\tinstall ok installed\t8.5.0-2ubuntu10.4
@@policy
nginx:
  Installed: 1.24.0-2ubuntu7.1
  Candidate: 1.24.0-2ubuntu7.3
nodejs:
  Installed: 20.18.0-1nodesource1
  Candidate: 20.18.0-1nodesource1
mysql-server:
  Installed: 8.0.40-0ubuntu0.24.04.1
  Candidate: (none)
@@services
nginx=active
apache2=inactive
mysql=active
redis-server=failed
docker=active
supervisor=active
@@tools
composer=2.8.1
certbot_snap=2.11.0
node=v20.18.0
node_path=/usr/bin/node
nodesource=1
nvm=
pm2=5.4.2
@@nginx-sites
default
app.example.com
api.example.com
@@apache-sites
@@listen
127.0.0.1:3306
0.0.0.0:22
[::]:22
127.0.0.1:3306
*:6379
`

export const PACKAGES_NVM = `@@dpkg
@@policy
@@services
@@tools
composer=
certbot_snap=
node=
node_path=
nodesource=0
nvm=v18.20.4 v20.18.0
@@nginx-sites
@@apache-sites
`

export const USAGE = `@@mysql
#innodb_redo
#innodb_temp
mysql
performance_schema
shop
sys
@@postgres
postgres
app
@@fpm 8.3
hits=4
last=07-Nov-2026 10:12:01
@@fpm 8.2
hits=0
last=
`

export const WWW_CONF = `[www]
user = www-data
; Choose how the process manager will control the number of child processes.
pm = dynamic
pm.max_children = 5
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
;pm.max_requests = 500
`

export const OVERRIDE_INI = 'memory_limit = 256M\n'

export const POOL_SHA = 'a'.repeat(64)

export const OVERRIDE_SHA = 'b'.repeat(64)

export const PHP_OUTPUT = `@@cli
/usr/bin/php8.3
@@installable
8.4
8.3
8.2
8.1
@@version 8.3
fpm=1
cli=1
fpm_state=active
@@modules 8.3
[PHP Modules]
bcmath
Core
curl
mbstring
pdo_mysql
xml

[Zend Modules]
Zend OPcache
@@packages 8.3
php8.3-bcmath
php8.3-cli
php8.3-curl
php8.3-fpm
php8.3-mbstring
php8.3-mysql
php8.3-xml
@@available 8.3
php8.3-bcmath
php8.3-cli
php8.3-curl
php8.3-dev
php8.3-fpm
php8.3-imagick
php8.3-mbstring
php8.3-mysql
php8.3-pgsql
php8.3-xml
@@ini 8.3
memory_limit=256M
upload_max_filesize=64M
post_max_size=64M
max_execution_time=60
max_input_vars=1000
date.timezone=
opcache.enable=1
opcache.memory_consumption=128
@@pool 8.3
sha=${POOL_SHA}
b64=${base64(WWW_CONF)}
@@override 8.3
sha=${OVERRIDE_SHA}
b64=${base64(OVERRIDE_INI)}
@@version 8.2
fpm=1
fpm_state=active
@@modules 8.2
@@packages 8.2
php8.2-fpm
@@available 8.2
@@ini 8.2
@@pool 8.2
@@override 8.2
@@sites
8.3|app.example.com|imagick mbstring pdo_mysql
8.3|api.example.com.conf|
`
