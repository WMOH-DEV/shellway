export const NGINX_CONF = `user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log;
include /etc/nginx/modules-enabled/*.conf;

events {
\tworker_connections 768;
\t# multi_accept on;
}

http {

\t##
\t# Basic Settings
\t##

\tsendfile on;
\ttcp_nopush on;
\ttypes_hash_max_size 2048;
\t# server_tokens off;

\t# server_names_hash_bucket_size 64;
\t# server_name_in_redirect off;

\tkeepalive_timeout 65;

\tinclude /etc/nginx/mime.types;
\tdefault_type application/octet-stream;

\tlog_format main '$remote_addr "$request" {$status}';
\taccess_log /var/log/nginx/access.log;

\tgzip on;

\t# gzip_vary on;
\t# gzip_proxied any;

\tserver {
\t\tlisten 8080;
\t\tclient_max_body_size 50m;
\t\tkeepalive_timeout 10;
\t\tgzip off;
\t\t# server_tokens off;
\t\tlocation /upload {
\t\t\tclient_max_body_size 2g;
\t\t}
\t}

\tinclude /etc/nginx/conf.d/*.conf;
\tinclude /etc/nginx/sites-enabled/*;
}

#mail {
#\tserver {
#\t\tlisten 110;
#\t}
#}
`
