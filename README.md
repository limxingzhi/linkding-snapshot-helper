# linkding-snapshot-helper

A tiny web server that syncs [SingleFile](https://github.com/gildas-lormeau/SingleFile) snapshots from your [Linkding](https://github.com/sissbruecker/linkding) bookmarks and serves them as static files.

Built for offline reading: tag bookmarks in Linkding, let this pull the snapshots, then browse them from your phone or laptop without internet.

## Quick start

```bash
cp .env.example .env
# edit .env with your Linkding URL and API token
npm start
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

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Directory listing of all downloaded snapshots |
| `GET /<filename>` | Serve a specific snapshot (`.html` only) |
| `GET /sync` | Re-sync from Linkding (skips already-downloaded files) |

## How it works

1. On startup (unless `SYNC_ON_START=false`), queries the Linkding API for all bookmarks tagged `#Offline`
2. For each bookmark, fetches its assets and filters for `asset_type == "snapshot"` (SingleFile uploads)
3. When multiple snapshots exist, selects the newest one by `created_at`
4. Downloads each snapshot as `<title>.html`, skipping files that already exist
5. Serves the downloaded files via Express

Syncs are idempotent: running `/sync` again only downloads new snapshots.

## Requirements

- A Linkding instance with the [SingleFile extension](https://github.com/gildas-lormeau/SingleFile) configured to upload snapshots
- Node.js 18+
- Install dependencies: `npm install`

## License

MIT
