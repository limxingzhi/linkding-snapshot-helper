# linkding-snapshot-helper

A tiny web server that syncs [SingleFile](https://github.com/gildas-lormeau/SingleFile) snapshots from your [Linkding](https://github.com/sissbruecker/linkding) bookmarks and serves them as static files.

Built for offline reading: tag bookmarks in Linkding, let this pull the snapshots, then browse them from your phone or laptop without internet.

![Screenshot](docs/screenshot.png)

## Features

The index page is the main interface. Each row is one downloaded snapshot, with its Linkding ID, title, domain, and remaining tags.

| Feature | What it does |
|---|---|
| **Open snapshot** | Clicking the title opens the local SingleFile copy in a new tab, so it works without internet |
| **Quick link to Linkding entry** | The green `#id` link opens that bookmark's detail view in Linkding (`/bookmarks?details=<id>`) |
| **Quick link to original site** | The Domain column links to the article's original URL in a new tab |
| **Archive button** | For admin/trusted clients, the leading status dot is an archive button: hover shows `A`, click confirms and archives the bookmark in Linkding, opens its detail view in a new tab, marks it read locally, and re-runs sync so the list reflects the result. Hold <kbd>Alt</kbd>/<kbd>Option</kbd> to skip the confirmation. Archived bookmarks leave the sync query but their snapshot stays on disk |
| **Read state** | Untrusted clients see a plain dot instead: gray for unread, green for read, with read rows dimmed |
| **Sync** | Pulls new snapshots from Linkding on demand (skips files already downloaded). Admin-only |
| **Download ZIP** | Bundles every snapshot plus an index into a single ZIP for offline use |
| **Delete** | Removes snapshots that have no Linkding metadata (unlinked files). Admin-only |

Admin-only controls are hidden from untrusted clients and their routes return `403 Forbidden`. See [Endpoints](#endpoints) for the trust rules.

## Quick start

```bash
cp .env.example .env
# edit .env with your Linkding URL and API token
bun install
bun start
```

Open `http://localhost:8080` to browse your snapshots.

## Docker

```yaml
services:
  linkding-snapshot-helper:
    image: ghcr.io/limxingzhi/linkding-snapshot-helper:latest
    ports:
      - "8080:8080"
    environment:
      - LINKDING_URL=https://linkd.example.com
      - LINKDING_TOKEN=your-api-token-here
      - LINKDING_TAG=Offline
    volumes:
      - snapshots:/snapshots
      - logs:/logs

volumes:
  snapshots:
  logs:
```

## Configuration

All config is via environment variables (set them in `.env`):

| Variable | Default | Description |
|---|---|---|
| `LINKDING_URL` | (required) | Your Linkding instance URL |
| `LINKDING_TOKEN` | (required) | Linkding API token |
| `LINKDING_TAG` | `Offline` | Bookmark tag to sync |
| `PORT` | `8080` | Port to listen on |
| `SYNC_ON_START` | `true` | Sync snapshots on startup |
| `SNAPSHOT_DIR` | `/snapshots` | Directory to store snapshots |
| `ADMIN_SUBNET` | (empty — allow all) | Comma-separated CIDR ranges trusted as admin (e.g. `100.64.0.0/10` for Tailscale). When unset, every IP is trusted; delete + sync are restricted to it when set. Localhost is always trusted |
| `BASE_PATH` | (empty) | Serve the app under a path prefix, e.g. `BASE_PATH=/snapd` → `http://host:8080/snapd/` |
| `LINKDING_DISPLAY_URL` | (empty) | Public URL for Linkding, used for the `#id` links in the index instead of the internal `LINKDING_URL` host. The link becomes `<display>/bookmarks?details=<id>` |
| `APP_VERSION` | `dev` | Version shown in the page footer. The Docker build sets it from the image tag; override it for local runs |

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Directory listing of all downloaded snapshots |
| `GET /<filename>` | Serve a specific snapshot (`.html` only) |
| `GET /download.zip` | Download all snapshots as a ZIP archive |
| `GET /sync` | Re-sync from Linkding (skips already-downloaded files). Admin-only |
| `POST /archive` | Archive a bookmark in Linkding and mark it read. Admin-only |
| `POST /delete` | Delete an unlinked snapshot. Admin-only |

All endpoints are served under `BASE_PATH` when set (e.g. `GET /snapd/`, `GET /snapd/sync`). The Sync, archive, and delete controls are only shown to admin IPs; those routes return `403 Forbidden` to everyone else. The admin check runs against the client IP seen by the server (`X-Forwarded-For` is honored, since the app trusts proxies) — when running behind a reverse proxy, set `ADMIN_SUBNET` to your proxy's real client subnet.

## How it works

1. On startup (unless `SYNC_ON_START=false`), queries the Linkding API for all bookmarks tagged `#Offline`
2. For each bookmark, fetches its assets and filters for `asset_type == "snapshot"` (SingleFile uploads)
3. When multiple snapshots exist, selects the newest one by `created_at`
4. Downloads each snapshot as `<title>.html`, skipping files that already exist
5. Serves the downloaded files via Express

Syncs are idempotent: running `/sync` again only downloads new snapshots.

## Display URL overrides

The Domain column in the index links to the URL stored in Linkding. To point a snapshot at a different URL for display only, create `overrides.json` in the snapshot directory, keyed by bookmark ID:

```json
{ "42": "https://example.com/actual-article" }
```

Overrides are only used for display/linking in the index; Linkding is never modified and the file survives syncs.

## Requirements

- A Linkding instance with the [SingleFile extension](https://github.com/gildas-lormeau/SingleFile) configured to upload snapshots
- Bun 1.2+
- Install dependencies: `bun install`

## License

MIT
