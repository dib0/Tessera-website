# Tessera-website

The website for the [Tessera Language](https://github.com/dib0/Tessera-language), **written in Tessera itself**.

It is a Tessera web application (`fn handle(request: http.Request) -> http.Response`), compiled to a shared library and
loaded straight into nginx by the Tessera nginx module. Texts and page structure live in SQLite, page views are counted
in the same database, and a small admin page shows the statistics.

> **Status:** the sources have been checked against the language reference and linted, but they have **not been compiled
> yet** (the machine they were written on has no Docker or Rust). The first `docker compose up --build` is the first
> real compile: the image build runs `tessera1 check` and `tessera1 test` before it builds the library, so a mistake
> shows up as a compiler diagnostic with a line number, not as a broken site.

## Run it

```sh
cp .env.example .env          # choose ADMIN_USER and ADMIN_PASSWORD
docker compose up -d --build
```

- Site: <http://localhost:8080/>
- Admin (statistics): <http://localhost:8080/admin> (HTTP Basic authentication)
- Health check: <http://localhost:8080/healthz>

The Tessera language repository is a named build context (`tessera`). By default it is cloned from GitHub; to build
against a local checkout:

```sh
TESSERA_SRC=../Tessera-language docker compose up -d --build
```

### Use the published image

GitHub Actions (`.github/workflows/docker.yml`) builds the image on every push to `main` and on `v*` tags and pushes it to
`ghcr.io/dib0/tessera-website` (tags: `latest`, `sha-<commit>`, and the version for tags). Pull requests only build.
The image is linux/amd64.

```sh
docker pull ghcr.io/dib0/tessera-website:latest

# or with compose, without building anything:
IMAGE=ghcr.io/dib0/tessera-website:latest docker compose up -d --no-build
```

A new ghcr.io package is **private** until you change it: GitHub > your profile > Packages > tessera-website > Package settings >
Change visibility > Public. Until then `docker login ghcr.io` with a token that has `read:packages` is needed to pull.
The build uses the `main` branch of the language repository; run the workflow manually to pick another ref.

### Configuration

| Variable | Where | Meaning |
|---|---|---|
| `ADMIN_USER`, `ADMIN_PASSWORD` | `docker-compose.yml` (values from `.env`) | Credentials of `/admin`. Compose refuses to start without them; the application disables the admin page if either is empty. |
| `DATA_DIR` | `.env` | Host folder mounted at `/data` (default `./data`). |
| `PORT` | `.env` | Host port (default `8080`). |
| `SITE_DB` | image default `site.db` | SQLite file, relative to `TESSERA_FS_ROOT`. |
| `TESSERA_FS_ROOT` | image default `/data` | The only folder the Tessera runtime may touch. |

### Persistent storage

Everything that must survive is one file: `/data/site.db`. The compose file mounts `./data` (or `DATA_DIR`) there, so the
database, including the statistics and any edits you make to the content, survives `docker compose down`, rebuilds and
upgrades. To use a named volume instead, replace the mount with `site-data:/data` and uncomment the `volumes:` section.
The entrypoint hands the folder to the unprivileged `tessera` user that the nginx workers run as.

## How it is built

```
Dockerfile
  stage "build"   rustc -> tessera-seed (from the language repo's Rust seed) -> tessera1 (the compiler, itself written in Tessera)
                  nginx + hosts/nginx (the Tessera module), built with thread support
                  tessera1 check / test / build --library  site/main.tes  ->  libsite.so
  stage runtime   debian-slim + sqlite3 (the runtime talks to SQLite through the sqlite3 program) + nginx + libsite.so
```

nginx loads `libsite.so` into its workers (`docker/nginx.conf`) and passes `ADMIN_USER`, `ADMIN_PASSWORD`, `SITE_DB` and
`TESSERA_FS_ROOT` on to them with `env`.

## The site

```
wwwroot/assets/   static files, served by nginx at /assets/ (css/site.css, js/theme.js, js/site.js, img/*.svg)
site/
  main.tes      handle(): routing, hit recording, and the tests (`tessera1 test site/main.tes`)
  store.tes     SQLite: schema, first-run seeding in one transaction, queries
  content.tes   the initial content: settings, pages and blocks (used only when the database is empty)
  view.tes      blocks -> HTML; everything from the database is escaped
  tracking.tes  anonymous visitor ids, bot and browser detection, referrer host (pure)
  stats.tes     the queries behind the admin page
  admin.tes     Basic authentication and the statistics page
  model.tes     shared record types
```

Sources are in the canonical Tessera layout (no indentation, LF line endings; see `.gitattributes`).

### Content comes from the database

Tables: `settings` (name, value), `pages` (slug, title, description, nav_label, nav_order, published) and `blocks`
(page_slug, sort_order, kind, heading, body, extra). A page is its blocks in order; the menu is the pages with
`nav_order > 0`. Block kinds: `hero`, `banner`, `section`, `cards`, `steps`, `list`, `code`, `callout`, `cta`. In text a
blank line starts a paragraph, `` `code` `` is code and `[label](url)` is a link; list-like blocks keep one item per line
in `extra`, fields separated by `|`.

When the database is empty (`PRAGMA user_version` is 0 and there are no pages), the first request creates the tables and
writes `content.tes` into them in a single `BEGIN IMMEDIATE` transaction, so workers that start together cannot seed twice.
After that the database is the only source: edit rows with the `sqlite3` program on `data/site.db` and reload the page.
Delete the file to start over from the built-in content.

### Static files and the look

CSS, JavaScript and images are plain files in `wwwroot/assets/` (copied into the image, served by nginx with revalidation, so a rebuild shows up at once). The palette and the chamfered, faceted tile shape come from the logo. JavaScript is optional enhancement (theme toggle, mobile menu, reveal on scroll, a tilting tile T, Tessera syntax highlighting and copy buttons for code); every page works without it. Pages carry the `std/http` Content-Security-Policy `default-src 'self'`, so scripts must be files from this site: no inline script or style, no external hosts. For a quick edit, mount a folder over `/opt/tessera/wwwroot`.

### Statistics

One row per page view (`GET` of a page or a 404; assets, health checks and the admin page are not counted): time, day,
path, status, an anonymous visitor id, the referrer *host*, a browser family and a bot flag. The visitor id is
`sha256(salt | day | address | user agent)` cut to 16 hex characters, with a salt that is generated once per installation.
It changes every day and cannot be reversed; no IP address and no full user agent is stored, and no cookie is set.
`/admin` shows today / 7 days / 30 days / all time, views per day, top pages, referrers, browsers and 404 paths. Bots
(by user-agent keywords) are counted apart.

The visitor address is taken from `X-Forwarded-For` when present, otherwise from the connection. Behind a reverse proxy
make sure it sets that header; clients can fake it, which only skews the statistics.

### Security notes

- HTTP Basic authentication sends the password on every request: terminate TLS in front of the container when the site is public.
- A wrong login costs a 750 ms delay; there is no lock-out. Use a long random password.
- Pages are sent with the `std/http` defaults: a restrictive Content-Security-Policy (`default-src 'self'`), no framing, `nosniff`.
- The container runs read-only, with all capabilities dropped except those nginx needs to start as root and drop to `tessera`.
  If your platform rejects that set, remove `cap_drop`/`cap_add` in `docker-compose.yml`.

## Development

```sh
tessera1 check site/main.tes
tessera1 test site/main.tes
tessera1 build site/main.tes -o site-app        # then: ./site-app serve --port 8080   (pages only: /assets/ is served by nginx, so use Docker to see the styling)
```

`tessera1` is built from the language repository (see its `bootstrap/README.md`); it needs `rustc` and, at run time,
the `sqlite3` program. 

## Related repositories

- [Tessera-language](https://github.com/dib0/Tessera-language): the language, the compiler and the nginx/Apache modules this site uses.
