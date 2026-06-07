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
- **Filename convention**: `{sanitizedTitle}-{bookmarkId}.html`. `clean()` regexes out the ID to detect orphans.
- **meta.json**: written on every sync — full overwrite from current sync log, no incremental merge. Git-ignored. Fields: `id`, `tags`, `url`, `articleUrl`, `unread`.
- **Linkding API**: `Authorization: Token {token}`. Paginated via `next` links (`?q=%23{tag}&limit=100`).
- **Helmet** with CSP disabled (snapshots load external resources).
- **ZIP cache**: in-memory, keyed on filename+mtime hash. Invalidated after sync or delete.
- **30s timeout** on all outbound requests.

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
- **`sanitize()`** strips `<>:"/\|?*`, collapses whitespace, trims dots/spaces, truncates to 200, defaults to `"untitled"`.
- CSP is **intentionally disabled** — don't re-enable it.
