# AGENTS.md

Express 5 server that syncs SingleFile snapshots from Linkding bookmarks and serves them as static HTML.

## Commands

- `npm start` — `tsx server.ts` (TS via tsx, no compile step needed)
- `npm test` — `vitest` (watch); `npm run test:run` — single run
- `npm run typecheck` — `tsc --noEmit`
- CommonJS output (`"type": "commonjs"`). tsconfig has `outDir: "dist"` but no explicit build script.

## Architecture

```
server.ts    → Express app + CLI entry point. Exports `createApp` for testing.
sync.ts      → `sync()` and `clean()` — exports both for testing.
sanitize.ts  → `sanitize(title)` → safe filename
logger.ts    → `createLogger(logDir)` → rotating file logger
types.ts     → Shared TypeScript types (Logger, ApiGet, LinkdingBookmark, etc.)
```

**Control flow**: `main()` reads env, creates logger + `apiGet`/`downloadFile` via raw `http`/`https`, optionally runs `sync()` on start, then `createApp()` starts Express.

**DI for testing**: `createApp({ snapshotDir, syncFn, tag, logger })` and `sync({ base, snapshotDir, apiGet, downloadFile, tag, log })` — inject mocks instead of mocking network modules.

## Key patterns

- **Static files gated by extension**: middleware only serves `.html`; `meta.json` lives in the same dir but is never exposed.
- **Sync skips first**: bookmarks whose `{title}-{id}.html` already exists are skipped before any asset API call; asset lookups only happen for missing files. Politeness `delay` throttles real downloads only, not skips.
- **Filename convention**: `{sanitizedTitle}-{bookmarkId}.html`. `clean()` regexes out the ID to detect orphans.
- **meta.json**: written on every sync — full overwrite from current sync log, no incremental merge. Git-ignored. Fields: `id`, `tags`, `url`, `articleUrl`, `unread`, `assetId` (asset id of the downloaded snapshot; lets `sync()` skip re-downloads when a bookmark is renamed but its newest snapshot is unchanged).
- **Linkding API**: `Authorization: Token {token}`. Paginated via `next` links (`?q=%23{tag}&limit=100`).
- **Helmet** with CSP disabled (snapshots load external resources).
- **ZIP cache**: in-memory, keyed on filename+mtime hash. Invalidated after sync or delete.
- **30s timeout** on API requests; **120s socket idle timeout** on snapshot downloads.
- **Transient error retry**: `sync()` retries apiGet/download calls on `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/`ECONNREFUSED`/`ECONNABORTED`/`socket hang up` with exponential backoff (`retries`=2, `retryDelay`=1000ms base, both injectable via `SyncOptions`). No `Connection: close` header; error paths drain the socket so keep-alive connections stay reusable.

## Testing

- **Vitest** with `globals: true`, `environment: 'node'`. Supertest for HTTP.
- Inject fake `apiGet`/`downloadFile`/`syncFn`. Use `{ info:()=>{}, warn:()=>{}, error:()=>{}, toExternal:()=>{} }` for silent logging.
- Per-test temp dirs under `__tests__/__fixtures__/` (e.g. `sync_tmp`, `snapshots`, `zip_tmp`), cleaned up in `afterEach`/`afterAll`.

## Gotchas

- **Express 5** handles async rejections automatically — error middleware gets `(err, req, res, next)` but doesn't need `next(err)`.
- **Sync mutex**: boolean `syncing` flag; concurrent `/sync` redirects to `/`.
- **`unread` defaults to `true`** when absent from the API response.
- **`clean()` also updates `unread`** on surviving entries by re-fetching bookmark data.
- **Delete** only works for files **without** a meta entry (unlinked snapshots). Blocks `/` and `..`.
- **Archive**: for trusted clients the read-dot renders as an archive button (hover shows "A"); `POST /archive` calls linkding's `POST /api/bookmarks/{id}/archive/` via injected `archiveBookmark`, flips `unread` to `false` in meta.json, and redirects to `/sync` so the page refreshes with post-archive state. Archived bookmarks leave the sync query (`is_archived=false` filter), so the follow-up sync/clean removes the snapshot.
- **`sanitize()`** strips `<>:"/\|?*`, collapses whitespace, trims dots/spaces, truncates to 200, defaults to `"untitled"`.
- CSP is **intentionally disabled** — don't re-enable it.
