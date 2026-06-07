// ---- Logger ----

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  toExternal(msg: string): void;
}

// ---- Network abstractions ----

export type ApiGet = (url: string) => Promise<LinkdingResponse>;
export type DownloadFile = (url: string, dest: string) => Promise<void>;

// ---- Linkding API shapes ----

export interface LinkdingBookmark {
  id: number;
  title: string;
  url?: string;
  tag_names?: string[];
  unread?: boolean;
}

export interface LinkdingAsset {
  id: number;
  asset_type: string;
  created_at?: string;
}

export interface LinkdingResponse {
  results: (LinkdingBookmark | LinkdingAsset)[];
  next: string | null;
  count: number;
}

// ---- Sync / Clean ----

export interface SyncLogEntryOk {
  status: "ok";
  title: string;
  filename: string;
  size: number;
  bookmarkId: number;
  tags: string[];
  bookmarkUrl: string;
  articleUrl: string;
  unread: boolean;
}

export interface SyncLogEntrySkip {
  status: "skip";
  title: string;
  reason: string;
  filename?: string;
  bookmarkId?: number;
  tags?: string[];
  bookmarkUrl?: string;
  articleUrl?: string;
  unread?: boolean;
}

export interface SyncLogEntryError {
  status: "error";
  title: string;
  error: string;
}

export type SyncLogEntry = SyncLogEntryOk | SyncLogEntrySkip | SyncLogEntryError;

export interface MetaEntry {
  id: number;
  tags: string[];
  url: string;
  articleUrl: string;
  unread: boolean;
}

export type MetaRecord = Record<string, MetaEntry>;

export interface SyncOptions {
  base: string;
  snapshotDir: string;
  apiGet: ApiGet;
  downloadFile: DownloadFile;
  tag?: string;
  log: Logger;
  delay?: number;
}

export interface CleanOptions {
  base: string;
  snapshotDir: string;
  apiGet: ApiGet;
  tag?: string;
  log: Logger;
}

// ---- App / Server ----

export type SyncFn = () => Promise<SyncLogEntry[]>;

export interface ZipCache {
  buffer: Buffer;
  hash: string;
  count: number;
}

export interface CreateAppOptions {
  snapshotDir: string;
  syncFn: SyncFn;
  tag?: string;
  logger: Logger;
}

// ---- Express augmentation ----

declare global {
  namespace Express {
    interface Request {
      isTrusted?: boolean;
    }
  }
}
