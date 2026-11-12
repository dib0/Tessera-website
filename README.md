# Tessera-website

The website for the [Tessera Language](https://github.com/dib0/Tessera-language), **written in Tessera itself**.

It is a Tessera web application (`fn handle(request: http.Request) -> http.Response`), compiled to a shared library and
loaded straight into nginx by the Tessera nginx module. Texts and page structure live in SQLite, page views are counted
in the same database, and the admin pages (behind a login with optional TOTP two-factor authentication) show the
statistics and edit the pages, their content and the site settings.

The sources follow draft 0.20 of the [language design](https://github.com/dib0/Tessera-language/blob/main/language-design.md).
The image build runs `tessera1 check` and `tessera1 test` before it builds the library, so a mistake shows up as a
compiler diagnostic with a line number, not as a broken site.

## Run it

```sh
cp .env.example .env          # choose ADMIN_USER and ADMIN_PASSWORD
docker compose up -d --build
```

- Site: <http://localhost:8080/>
- Admin: <http://localhost:8080/admin> (log in with `ADMIN_USER` / `ADMIN_PASSWORD`)
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
| `ADMIN_USER`, `ADMIN_PASSWORD` | `docker-compose.yml` (values from `.env`) | The admin account. Compose refuses to start without them; the application disables the admin pages if either is empty. |
| `DATA_DIR` | `.env` | Host folder mounted at `/data` (default `./data`). |
| `PORT` | `.env` | Host port (default `8080`). |
| `SITE_DB` | image default `site.db` | SQLite file, relative to `TESSERA_FS_ROOT`. |
| `TESSERA_FS_ROOT` | image default `/data` | The only folder the Tessera runtime may touch. |

### Persistent storage

Everything that must survive is one file: `/data/site.db`. The compose file mounts `./data` (or `DATA_DIR`) there, so the
database, including the statistics, the content edits, the admin sessions and the 2FA secret, survives `docker compose down`, rebuilds and
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
  store.tes     SQLite: schema, writing content.tes into the database, queries
  content.tes   the content: settings, pages and blocks, compiled into the program
  view.tes      blocks -> HTML; everything from the database is escaped
  tracking.tes  anonymous visitor ids, bot and browser detection, referrer host (pure)
  stats.tes     the queries behind the statistics page
  admin.tes     the admin pages: login, routing, the handlers of every form
  admin_view.tes the HTML of the admin pages (pure)
  auth.tes      sessions, credentials and the TOTP state
  manage.tes    changes to pages, blocks and settings, with their validation
  totp.tes      SHA-1, HMAC-SHA-1, Base32 and TOTP (RFC 6238), pure
  qr.tes        QR codes as inline SVG (byte mode, level M, versions 1 to 10), pure
  model.tes     shared record types and the block kinds
```

Sources are in the canonical Tessera layout (no indentation, LF line endings; see `.gitattributes`).

### Content comes from the database

Tables: `settings` (name, value), `pages` (slug, title, description, nav_label, nav_order, published) and `blocks`
(page_slug, sort_order, kind, heading, body, extra). A page is its blocks in order; the menu is the pages with
`nav_order > 0`. Block kinds: `hero`, `banner`, `section`, `cards`, `steps`, `list`, `code`, `callout`, `cta`. In text a
blank line starts a paragraph, `` `code` `` is code and `[label](url)` is a link; list-like blocks keep one item per line
in `extra`, fields separated by `|`.

The first request creates the tables and writes `content.tes` into them in a single `BEGIN IMMEDIATE` transaction, so
workers that start together cannot write twice. An older file is upgraded first (version 2 added `sessions` and
`admin_state`, version 3 added `seeded`).

### Deploying new content over a database that is already running

`content.tes` is not only a first-run seed. Every request compares a fingerprint of the compiled-in content with the
one stored in the database; when they differ a new version was deployed, and it is written in field by field.

Hand edits win. The `seeded` table remembers the value `content.tes` last wrote for every field, which is what tells
the two apart:

| In the database | Seed | What happens |
|---|---|---|
| what content wrote | the same | nobody touched it: updated to the new text |
| something else | what content wrote | edited on the admin pages: left alone, for good |
| no row at all | no row | a page or block made on the admin pages: never touched |

So a page or block you add on the admin pages is safe, and so is any wording you change there. A page or block that
disappears from `content.tes` is removed only when it, and all of its blocks, are still exactly as content wrote them.
`published` is never managed, so a page you hide stays hidden.

**Once, when a version 2 database is upgraded**, there are no seeds yet to compare against, so `content.tes` is written
over every page and block it defines. Wording changed on the admin pages *before* that upgrade is replaced. Pages and
blocks you added yourself are not affected, and from then on every edit is recognised and kept.

Delete the database file to start over from the built-in content.

### The admin pages

| Page | What it does |
|---|---|
| `/admin` | Statistics (see below). |
| `/admin/pages` | All pages, published or not, and a form for a new page (it starts as a draft outside the menu). |
| `/admin/pages/<slug>` | The details of a page (title, address, description, menu label and position, published) and its blocks: edit, move up and down, delete, add. *Preview* shows a draft as it will look. `home` and `404` keep their address and cannot be unpublished or deleted. |
| `/admin/settings` | Site name, tagline, language, GitHub address, footer text and footer links. |
| `/admin/account` | Two-factor authentication on and off, and *Log out everywhere*. |

Changing the address of a page moves its blocks with it in one transaction. Block kinds are explained in the editor.

### For language models: /llms.txt and /llms-full.txt

The site publishes itself the way [llmstxt.org](https://llmstxt.org) describes, so that an agent can read about Tessera
without crawling HTML:

| Path | Where it comes from |
|---|---|
| `/llms.txt` | Built by the program from the pages in its database: the site name, the tagline, and every published page with its description. It cannot fall behind the site, because it is made of the site. |
| `/llms-full.txt` | `harness/reference/tessera.md` from the language repository, written into the image at build time with `docker/llms-full.header.md` in front of it, and served by nginx. The whole language in one file: the same text the measurement harness gives a model. |

A change to the reference in the language repository reaches the site on its next image build; nothing is copied by
hand, and the two cannot drift apart.

### Static files and the look

CSS, JavaScript and images are plain files in `wwwroot/assets/` (copied into the image, served by nginx with revalidation and gzip, so a rebuild shows up at once). The palette and the chamfered, faceted tile shape come from the logo. JavaScript is optional enhancement (theme toggle, mobile menu, reveal on scroll, a tilting tile T, Tessera syntax highlighting and copy buttons for code, and a confirmation before deleting in the admin); every page works without it. Pages carry the `std/http` Content-Security-Policy `default-src 'self'`, so scripts must be files from this site: no inline script or style, no external hosts. For a quick edit, mount a folder over `/opt/tessera/wwwroot`.

### Statistics

One row per page view (`GET` of a page or a 404; assets, health checks and the admin page are not counted): time, day,
path, status, an anonymous visitor id, the referrer *host*, a browser family and a bot flag. The visitor id is
`sha256(salt | day | address | user agent)` cut to 16 hex characters, with a salt that is generated once per installation.
It changes every day and cannot be reversed; no IP address and no full user agent is stored, and no cookie is set.
`/admin` shows today / 7 days / 30 days / all time, views per day, top pages, referrers, browsers and 404 paths. The
four totals and the bot count come from a single query. Bots
(by user-agent keywords) are counted apart.

The visitor address is taken from `X-Forwarded-For` when present, otherwise from the connection. Behind a reverse proxy
make sure it sets that header; clients can fake it, which only skews the statistics.

### Logging in and two-factor authentication

The account is `ADMIN_USER` / `ADMIN_PASSWORD`. Logging in at `/admin/login` starts a session: a random 256-bit token in
the cookie `tessera_admin` (`HttpOnly; Secure; SameSite=Strict; Path=/admin`), stored in the database only as its SHA-256.
A session lasts 12 hours; *Log out* ends it, *Log out everywhere* ends all of them.

On `/admin/account` you can turn on TOTP (RFC 6238: HMAC-SHA-1, 6 digits, 30 seconds, which every authenticator app
supports). The page shows a QR code and the key; the secret is used only after you confirm it with a valid code. With
2FA on, the password alone gives a 5-minute session that can do nothing but enter a code; a valid code replaces it by a
new full session. Five wrong codes end it. Each code works once (the last used time step is stored), with one step of
clock drift either way. Turning 2FA off needs the password and a current code.

Lost the phone? Remove the secret on the server; the next login asks only for the password:

```sh
docker compose exec --user tessera site sqlite3 /data/site.db "DELETE FROM admin_state WHERE name LIKE 'totp_%'"
```

### Security notes

- The session cookie is `Secure`, so browsers only send it over HTTPS, or to `localhost`. Terminate TLS in front of the container when the site is public; logging in over plain HTTP on another address does not work.
- A wrong password or code costs a 750 ms delay; there is no lock-out for passwords. Use a long random password, and turn on 2FA.
- Every form carries a CSRF token bound to the session, and a POST whose `Origin` is not this site is refused. Behind a reverse proxy, pass the original `Host` (or set `X-Forwarded-Host`).
- Everything from the database is escaped when it is rendered, also on the admin pages; content cannot add markup, scripts or `javascript:` links.
- Changing `ADMIN_PASSWORD` does not end existing sessions; use *Log out everywhere* (or `DELETE FROM sessions`).
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
