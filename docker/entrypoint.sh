#!/bin/sh
# Prepares the data folder and starts nginx in the foreground.
set -eu

# nginx only creates the last directory of its temp paths, and /tmp may be a fresh tmpfs (compose) or a plain
# container layer (other platforms), so make sure the parents exist.
mkdir -p /tmp/nginx /run
chmod 1777 /tmp

data="${TESSERA_FS_ROOT:-/data}"
mkdir -p "$data"
# The folder is usually a bind mount or a volume that belongs to root; the workers run as `tessera`.
# Some platforms mount volumes where chown is not allowed; then the volume must already be writable.
chown -R tessera:tessera "$data" || echo "warning: cannot chown $data; it must be writable by user 'tessera'" >&2

if [ -z "${ADMIN_USER:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
    echo "warning: ADMIN_USER and ADMIN_PASSWORD are not both set; the admin page is disabled" >&2
fi

exec /opt/nginx/sbin/nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
