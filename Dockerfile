# syntax=docker/dockerfile:1.7
#
# Builds the Tessera website: the Tessera compiler, nginx with the Tessera module, and the site as a shared library.
#
# The Tessera language repository is a named build context called `tessera`:
#   docker compose build                                   (uses GitHub, see docker-compose.yml)
#   TESSERA_SRC=../Tessera-language docker compose build   (uses a local checkout)
#   docker build --build-context tessera=../Tessera-language -t tessera-website .

ARG RUST_IMAGE=rust:1-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

# ---------------------------------------------------------------------------------------------------------------
FROM ${RUST_IMAGE} AS build
ARG NGINX_VERSION=1.30.6

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 1. The compiler. The language repository holds a generated Rust seed of the stage 1 compiler (written in Tessera).
#    rustc turns the seed into a compiler, and that compiler builds the current stage 1 source into `tessera1`.
COPY --from=tessera / /tessera
RUN find /tessera -name '*.tes' -exec sed -i 's/\r$//' {} + \
 && rustc --edition 2021 -C opt-level=2 -o /usr/local/bin/tessera-seed /tessera/bootstrap/tessera1.rs \
 && cd /tessera \
 && tessera-seed build stage1/main.tes -o /usr/local/bin/tessera1

# 2. nginx with the Tessera module, built the way hosts/test/run_server_tests.sh builds it (with thread support),
#    plus gzip for the static assets.
RUN curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" | tar xz -C /tmp \
 && cd "/tmp/nginx-${NGINX_VERSION}" \
 && ./configure \
      --prefix=/opt/nginx \
      --without-http_rewrite_module \
      --http-client-body-temp-path=/tmp/nginx/client_body \
      --http-proxy-temp-path=/tmp/nginx/proxy \
      --http-fastcgi-temp-path=/tmp/nginx/fastcgi \
      --http-uwsgi-temp-path=/tmp/nginx/uwsgi \
      --http-scgi-temp-path=/tmp/nginx/scgi \
      --with-threads --with-cc-opt=-O2 \
      --add-module=/tessera/hosts/nginx \
 && make -j"$(nproc)" \
 && make install

# 3. The site: check it, run its tests, and build it as a shared library for the nginx module.
COPY site /src/site
RUN find /src/site -name '*.tes' -exec sed -i 's/\r$//' {} + \
 && cd /src \
 && tessera1 check site/main.tes \
 && tessera1 test site/main.tes -o /tmp/site-tests \
 && mkdir -p /opt/tessera \
 && tessera1 build site/main.tes --library -o /opt/tessera/libsite.so

# ---------------------------------------------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE}

# The Tessera runtime talks to SQLite through the sqlite3 command-line program.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin tessera \
 && mkdir -p /data /etc/nginx /opt/tessera

COPY --from=build /opt/nginx /opt/nginx
COPY --from=build /opt/tessera/libsite.so /opt/tessera/libsite.so
COPY wwwroot /opt/tessera/wwwroot
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh /etc/nginx/nginx.conf && chmod 0755 /entrypoint.sh

# Everything that must survive a restart lives in /data (the SQLite file). Mount a folder or a volume there.
ENV TESSERA_FS_ROOT=/data \
    SITE_DB=site.db \
    TESSERA_SQLITE3=/usr/bin/sqlite3
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
