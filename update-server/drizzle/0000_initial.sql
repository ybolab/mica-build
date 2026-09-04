CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`release_id` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalogs` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`envelope` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`board` text NOT NULL,
	`channel` text NOT NULL,
	`version` text NOT NULL,
	`epoch` integer NOT NULL,
	`notes` text NOT NULL,
	`status` text NOT NULL,
	`artifact` text,
	`sha256` text,
	`size` integer,
	`created_at` text NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_identity` ON `releases` (`board`,`channel`,`epoch`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
