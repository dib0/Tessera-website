#!/bin/sh
# Prepares the data folder and starts nginx in the foreground.
set -eu

data="${TESSERA_FS_ROOT:-/data}"
mkdir -p "$data"
# The folder is usually a bind mount or a volume that belongs to root; the workers run as `tessera`.
chown -R tessera:tessera "$data"

if [ -z "${ADMIN_USER:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
    echo "warning: ADMIN_USER and ADMIN_PASSWORD are not both set; the admin page is disabled" >&2
fi

exec /opt/nginx/sbin/nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
