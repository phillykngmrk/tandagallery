import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  varchar,
  primaryKey,
  uniqueIndex,
  index,
  bigint,
  smallint,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// =============================================================================
// INGESTION TABLES
// =============================================================================

/**
 * Sources: External platforms/sites we aggregate content from
 */
export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  baseUrl: varchar('base_url', { length: 2048 }).notNull(),
  // Mode: 'scrape' for HTML parsing, 'api' for REST APIs
  mode: varchar('mode', { length: 50 }).notNull().default('scrape'),
  // Rate limit config: { requestsPerMinute: 30, burstSize: 5, crawlDelay: 2000 }
  rateLimitConfig: jsonb('rate_limit_config').notNull().default({ requestsPerMinute: 30 }),
  // Scraper configuration: { selectors: {...}, urlPattern: {...} }
  scraperConfig: jsonb('scraper_config'),
  // User agent and contact for identification
  userAgent: varchar('user_agent', { length: 512 }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/**
 * Threads: Specific feeds/channels within a source to monitor
 * For forums: specific boards or threads
 * For image boards: specific tags or galleries
 */
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'restrict' }),
  // External identifier on the source (board name, tag, gallery ID)
  externalId: varchar('external_id', { length: 512 }).notNull(),
  url: varchar('url', { length: 2048 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  enabled: boolean('enabled').notNull().default(true),
  // Higher priority = checked more frequently
  priority: smallint('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('threads_source_external_idx').on(table.sourceId, table.externalId),
  index('threads_source_enabled_idx').on(table.sourceId, table.enabled),
]);

/**
 * Checkpoints: Cursor state for incremental ingestion per thread
 */
export const checkpoints = pgTable('checkpoints', {
  threadId: uuid('thread_id').primaryKey().references(() => threads.id, { onDelete: 'cascade' }),
  // Primary: stable external ID from source
  lastSeenItemId: varchar('last_seen_item_id', { length: 512 }),
  // Fallback: content fingerprint hash
  lastSeenFingerprint: varchar('last_seen_fingerprint', { length: 128 }),
  // Optimization: last known page number
  lastSeenPage: integer('last_seen_page'),
  // Timestamp for time-based comparison
  lastSeenTimestamp: timestamp('last_seen_timestamp', { withTimezone: true }),
  // Catch-up cursor for partial runs: { currentPage, startedAt, itemsIngested }
  catchUpCursor: jsonb('catch_up_cursor'),
  // Metadata
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Media Items: Individual pieces of content from sources
 */
export const mediaItems = pgTable('media_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'restrict' }),
  // Source's unique identifier for this item
  externalItemId: varchar('external_item_id', { length: 512 }).notNull(),
  // Content fingerprint for deduplication
  fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
  // Link back to original content
  permalink: varchar('permalink', { length: 2048 }).notNull(),
  // When originally posted on source
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  // Author info
  author: varchar('author', { length: 255 }),
  authorUrl: varchar('author_url', { length: 2048 }),
  // Content
  title: varchar('title', { length: 1024 }),
  caption: text('caption'),
  // Type: 'image', 'gif', 'video'
  mediaType: varchar('media_type', { length: 50 }).notNull(),
  // Primary media URLs: { original, thumbnail?, preview? }
  mediaUrls: jsonb('media_urls').notNull(),
  // Video/GIF duration in milliseconds (max 30000)
  durationMs: integer('duration_ms'),
  // Dimensions
  width: integer('width'),
  height: integer('height'),
  // Engagement counts (denormalized for performance)
  likeCount: integer('like_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  favoriteCount: integer('favorite_count').notNull().default(0),
  viewCount: integer('view_count').notNull().default(0),
  // Moderation flags
  isHidden: boolean('is_hidden').notNull().default(false),
  hiddenReason: varchar('hidden_reason', { length: 255 }),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenBy: uuid('hidden_by'),
  commentsLocked: boolean('comments_locked').notNull().default(false),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: uuid('locked_by'),
  // Content warning
  isNsfw: boolean('is_nsfw').notNull().default(false),
  contentWarning: varchar('content_warning', { length: 255 }),
  // Tags (stored as array for flexibility)
  tags: jsonb('tags').default([]),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // Idempotency: prevent duplicate items per thread
  uniqueIndex('media_items_thread_external_idx').on(table.threadId, table.externalItemId),
  uniqueIndex('media_items_thread_fingerprint_idx').on(table.threadId, table.fingerprint),
  // Feed queries
  index('media_items_feed_idx').on(table.postedAt),
  index('media_items_popular_idx').on(table.likeCount, table.postedAt),
  index('media_items_views_idx').on(table.viewCount, table.postedAt),
  // Thread listing
  index('media_items_thread_posted_idx').on(table.threadId, table.postedAt),
  // Feed by ingestion date
  index('media_items_created_idx').on(table.createdAt),
  // Fingerprint lookup
  index('media_items_fingerprint_idx').on(table.fingerprint),
]);

/**
 * Media Assets: Individual files (images, videos) within a media item
 * Supports gallery posts with multiple assets
 */
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  mediaItemId: uuid('media_item_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  // Original URL from source
  assetUrl: varchar('asset_url', { length: 2048 }).notNull(),
  // Type: 'image', 'video', 'gif', 'thumbnail'
  assetType: varchar('asset_type', { length: 50 }).notNull(),
  // Duration for video/audio
  durationMs: integer('duration_ms'),
  // Dimensions
  width: integer('width'),
  height: integer('height'),
  // File metadata
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 255 }),
  // Storage: 'remote' (hotlink), 'cached' (CDN), 'archived'
  storageMode: varchar('storage_mode', { length: 50 }).notNull().default('remote'),
  // CDN URL if cached
  cdnUrl: varchar('cdn_url', { length: 2048 }),
  // Blurhash for placeholder
  blurhash: varchar('blurhash', { length: 100 }),
  // Order in gallery
  position: smallint('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('media_assets_item_url_idx').on(table.mediaItemId, table.assetUrl),
  index('media_assets_item_idx').on(table.mediaItemId, table.position),
]);

/**
 * Ingest Runs: Audit log of ingestion job executions
 */
export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'restrict' }),
  threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // Status: 'running', 'completed', 'failed', 'cancelled', 'partial'
  status: varchar('status', { length: 50 }).notNull().default('running'),
  // Metrics
  pagesScanned: integer('pages_scanned').notNull().default(0),
  itemsFound: integer('items_found').notNull().default(0),
  itemsNew: integer('items_new').notNull().default(0),
  itemsUpdated: integer('items_updated').notNull().default(0),
  itemsDuplicate: integer('items_duplicate').notNull().default(0),
  itemsFailed: integer('items_failed').notNull().default(0),
  // Error details
  errorSummary: text('error_summary'),
  errorDetails: jsonb('error_details'),
  // Checkpoint state at start/end
  checkpointBefore: jsonb('checkpoint_before'),
  checkpointAfter: jsonb('checkpoint_after'),
}, (table) => [
  index('ingest_runs_status_idx').on(table.status, table.startedAt),
  index('ingest_runs_source_idx').on(table.sourceId, table.startedAt),
]);

// =============================================================================
// USER TABLES
// =============================================================================

/**
 * Users: User accounts with auth and profile
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Auth
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: varchar('password_hash', { length: 255 }),
  // Profile
  username: varchar('username', { length: 50 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }),
  avatarUrl: varchar('avatar_url', { length: 2048 }),
  bio: text('bio'),
  // Preferences (theme, notifications, etc.)
  preferences: jsonb('preferences').notNull().default({}),
  // Role: 'user', 'moderator', 'admin'
  role: varchar('role', { length: 50 }).notNull().default('user'),
  // Status
  isActive: boolean('is_active').notNull().default(true),
  isBanned: boolean('is_banned').notNull().default(false),
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  bannedReason: varchar('banned_reason', { length: 500 }),
  bannedUntil: timestamp('banned_until', { withTimezone: true }),
  bannedBy: uuid('banned_by'),
  // Activity tracking
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  loginCount: integer('login_count').notNull().default(0),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('users_email_idx').on(table.email),
  index('users_username_idx').on(table.username),
  index('users_role_idx').on(table.role),
]);

/**
 * Sessions: User session management
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: varchar('revoked_reason', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('sessions_user_idx').on(table.userId),
  index('sessions_token_idx').on(table.refreshTokenHash),
]);

// =============================================================================
// INTERACTION TABLES
// =============================================================================

/**
 * Likes: User likes on media items (idempotent via composite PK)
 */
export const likes = pgTable('likes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaItemId: uuid('media_item_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.mediaItemId] }),
  index('likes_item_idx').on(table.mediaItemId),
  index('likes_user_idx').on(table.userId, table.createdAt),
]);

/**
 * Favorites: User bookmarks (separate from likes)
 */
export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaItemId: uuid('media_item_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  // Optional collection/folder name
  collectionName: varchar('collection_name', { length: 100 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.mediaItemId] }),
  index('favorites_user_idx').on(table.userId, table.createdAt),
  index('favorites_item_idx').on(table.mediaItemId),
]);

/**
 * Comments: User comments with 1-level threading
 * parent_id NULL = top-level comment
 * parent_id set = reply (only 1 level deep)
 */
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  mediaItemId: uuid('media_item_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // NULL for top-level, parent ID for replies
  parentId: uuid('parent_id'),
  body: text('body').notNull(),
  // Rendered HTML if supporting markdown
  bodyHtml: text('body_html'),
  // Engagement
  likeCount: integer('like_count').notNull().default(0),
  replyCount: integer('reply_count').notNull().default(0),
  // Moderation
  status: varchar('status', { length: 50 }).notNull().default('active'),
  isHidden: boolean('is_hidden').notNull().default(false),
  hiddenReason: varchar('hidden_reason', { length: 255 }),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenBy: uuid('hidden_by'),
  // Edit tracking
  isEdited: boolean('is_edited').notNull().default(false),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('comments_item_toplevel_idx').on(table.mediaItemId, table.createdAt),
  index('comments_parent_idx').on(table.parentId, table.createdAt),
  index('comments_user_idx').on(table.userId, table.createdAt),
]);

/**
 * Comment Likes: Likes on comments
 */
export const commentLikes = pgTable('comment_likes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  commentId: uuid('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.commentId] }),
  index('comment_likes_comment_idx').on(table.commentId),
]);

/**
 * Follows: User following relationships
 */
export const follows = pgTable('follows', {
  id: uuid('id').primaryKey().defaultRandom(),
  followerId: uuid('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Polymorphic: 'user', 'thread', 'source'
  followeeType: varchar('followee_type', { length: 50 }).notNull(),
  followeeId: uuid('followee_id').notNull(),
  notify: boolean('notify').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('follows_unique_idx').on(table.followerId, table.followeeType, table.followeeId),
  index('follows_follower_idx').on(table.followerId, table.followeeType),
  index('follows_followee_idx').on(table.followeeType, table.followeeId),
]);

/**
 * Reports: User-submitted content reports
 */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Polymorphic target: 'media_item', 'comment', 'user'
  targetType: varchar('target_type', { length: 50 }).notNull(),
  targetId: uuid('target_id').notNull(),
  // Reason: 'spam', 'harassment', 'hate_speech', 'violence', etc.
  reason: varchar('reason', { length: 100 }).notNull(),
  description: text('description'),
  // Status: 'pending', 'reviewing', 'resolved_valid', 'resolved_invalid', 'dismissed'
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('reports_pending_idx').on(table.status, table.createdAt),
  index('reports_target_idx').on(table.targetType, table.targetId),
  index('reports_reporter_idx').on(table.reporterId),
]);

// =============================================================================
// MODERATION TABLES
// =============================================================================

/**
 * Blocked Media: Prevents re-ingestion of admin-deleted media items
 */
export const blockedMedia = pgTable('blocked_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  externalItemId: varchar('external_item_id', { length: 512 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 128 }),
  reason: varchar('reason', { length: 255 }),
  blockedBy: uuid('blocked_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('blocked_media_thread_external_idx').on(table.threadId, table.externalItemId),
  index('blocked_media_thread_idx').on(table.threadId),
]);

/**
 * Moderation Actions: Immutable audit log for all moderation activities
 */
export const moderationActions = pgTable('moderation_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  moderatorId: uuid('moderator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  // Target: 'media_item', 'comment', 'user', 'thread', 'source'
  targetType: varchar('target_type', { length: 50 }).notNull(),
  targetId: uuid('target_id').notNull(),
  // Action: 'hide', 'unhide', 'lock_comments', 'remove', 'ban_user', etc.
  action: varchar('action', { length: 100 }).notNull(),
  reason: text('reason'),
  // State snapshots
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  // Related report (if action resulted from a report)
  reportId: uuid('report_id'),
  // Metadata
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('mod_actions_moderator_idx').on(table.moderatorId, table.createdAt),
  index('mod_actions_target_idx').on(table.targetType, table.targetId),
  index('mod_actions_recent_idx').on(table.createdAt),
]);

// =============================================================================
// RELATIONS
// =============================================================================

export const sourcesRelations = relations(sources, ({ many }) => ({
  threads: many(threads),
  ingestRuns: many(ingestRuns),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  source: one(sources, { fields: [threads.sourceId], references: [sources.id] }),
  mediaItems: many(mediaItems),
  checkpoint: one(checkpoints, { fields: [threads.id], references: [checkpoints.threadId] }),
}));

export const mediaItemsRelations = relations(mediaItems, ({ one, many }) => ({
  thread: one(threads, { fields: [mediaItems.threadId], references: [threads.id] }),
  assets: many(mediaAssets),
  likes: many(likes),
  favorites: many(favorites),
  comments: many(comments),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  mediaItem: one(mediaItems, { fields: [mediaAssets.mediaItemId], references: [mediaItems.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  likes: many(likes),
  favorites: many(favorites),
  comments: many(comments),
  follows: many(follows),
  reports: many(reports),
  moderationActions: many(moderationActions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.id] }),
  mediaItem: one(mediaItems, { fields: [likes.mediaItemId], references: [mediaItems.id] }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
  mediaItem: one(mediaItems, { fields: [favorites.mediaItemId], references: [mediaItems.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  user: one(users, { fields: [comments.userId], references: [users.id] }),
  mediaItem: one(mediaItems, { fields: [comments.mediaItemId], references: [mediaItems.id] }),
  parent: one(comments, { fields: [comments.parentId], references: [comments.id], relationName: 'replies' }),
  replies: many(comments, { relationName: 'replies' }),
  likes: many(commentLikes),
}));

export const commentLikesRelations = relations(commentLikes, ({ one }) => ({
  user: one(users, { fields: [commentLikes.userId], references: [users.id] }),
  comment: one(comments, { fields: [commentLikes.commentId], references: [comments.id] }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, { fields: [follows.followerId], references: [users.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterId], references: [users.id] }),
}));

export const moderationActionsRelations = relations(moderationActions, ({ one }) => ({
  moderator: one(users, { fields: [moderationActions.moderatorId], references: [users.id] }),
}));

export const blockedMediaRelations = relations(blockedMedia, ({ one }) => ({
  thread: one(threads, { fields: [blockedMedia.threadId], references: [threads.id] }),
  blocker: one(users, { fields: [blockedMedia.blockedBy], references: [users.id] }),
}));

export const ingestRunsRelations = relations(ingestRuns, ({ one }) => ({
  source: one(sources, { fields: [ingestRuns.sourceId], references: [sources.id] }),
  thread: one(threads, { fields: [ingestRuns.threadId], references: [threads.id] }),
}));
