import { z } from "zod";

// ---- Logger ----

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  toExternal(msg: string): void;
}

// ---- Network abstractions ----

export type ApiGet = (url: string) => Promise<unknown>;
export type DownloadFile = (url: string, dest: string) => Promise<void>;
export type ArchiveBookmark = (bookmarkId: number) => Promise<void>;

// ---- Linkding API shapes ----

export const LinkdingBookmarkSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string().optional(),
  tag_names: z.array(z.string()).optional(),
  unread: z.boolean().optional(),
});

export type LinkdingBookmark = z.infer<typeof LinkdingBookmarkSchema>;

export const LinkdingAssetSchema = z.object({
  id: z.number(),
  asset_type: z.string(),
  created_at: z.string().optional(),
});

export type LinkdingAsset = z.infer<typeof LinkdingAssetSchema>;

export const BookmarkListResponseSchema = z.object({
  results: z.array(LinkdingBookmarkSchema),
  next: z.string().nullable(),
  count: z.number(),
});

export const AssetListResponseSchema = z.object({
  results: z.array(LinkdingAssetSchema),
  next: z.string().nullable(),
  count: z.number(),
});

// ---- Sync / Clean ----

export const SyncLogEntryOkSchema = z.object({
  status: z.literal("ok"),
  title: z.string(),
  filename: z.string(),
  size: z.number(),
  bookmarkId: z.number(),
  tags: z.array(z.string()),
  bookmarkUrl: z.string(),
  articleUrl: z.string(),
  unread: z.boolean(),
});

export type SyncLogEntryOk = z.infer<typeof SyncLogEntryOkSchema>;

export const SyncLogEntrySkipSchema = z.object({
  status: z.literal("skip"),
  title: z.string(),
  reason: z.string(),
  filename: z.string().optional(),
  bookmarkId: z.number().optional(),
  tags: z.array(z.string()).optional(),
  bookmarkUrl: z.string().optional(),
  articleUrl: z.string().optional(),
  unread: z.boolean().optional(),
});

export type SyncLogEntrySkip = z.infer<typeof SyncLogEntrySkipSchema>;

export const SyncLogEntryErrorSchema = z.object({
  status: z.literal("error"),
  title: z.string(),
  error: z.string(),
});

export type SyncLogEntryError = z.infer<typeof SyncLogEntryErrorSchema>;

export const SyncLogEntrySchema = z.discriminatedUnion("status", [
  SyncLogEntryOkSchema,
  SyncLogEntrySkipSchema,
  SyncLogEntryErrorSchema,
]);

export type SyncLogEntry = z.infer<typeof SyncLogEntrySchema>;

export const MetaEntrySchema = z.object({
  id: z.number(),
  tags: z.array(z.string()),
  url: z.string(),
  articleUrl: z.string().optional(),
  unread: z.boolean().optional(),
});

export type MetaEntry = z.infer<typeof MetaEntrySchema>;

export const MetaRecordSchema = z.record(z.string(), MetaEntrySchema);

export type MetaRecord = z.infer<typeof MetaRecordSchema>;

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
  archiveBookmark?: ArchiveBookmark;
}

// ---- Express augmentation ----

declare global {
  namespace Express {
    interface Request {
      isTrusted?: boolean;
    }
  }
}
