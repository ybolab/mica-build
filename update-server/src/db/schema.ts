import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const releases = sqliteTable('releases', {
  id: text('id').primaryKey(),
  board: text('board').notNull(),
  channel: text('channel').notNull(),
  version: text('version').notNull(),
  epoch: integer('epoch').notNull(),
  notes: text('notes').notNull(),
  status: text('status', { enum: ['draft', 'published', 'withdrawn'] }).notNull(),
  artifact: text('artifact'),
  sha256: text('sha256'),
  size: integer('size'),
  createdAt: text('created_at').notNull(),
  publishedAt: text('published_at'),
}, table => [uniqueIndex('release_identity').on(table.board, table.channel, table.epoch)])

export const catalogs = sqliteTable('catalogs', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  envelope: text('envelope').notNull(),
  issuedAt: text('issued_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

export const audit = sqliteTable('audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  releaseId: text('release_id'),
  detail: text('detail').notNull(),
  createdAt: text('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  hash: text('hash').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
})

export type Release = typeof releases.$inferSelect
