ALTER TABLE `stream` RENAME COLUMN `game` TO `category`;--> statement-breakpoint
ALTER TABLE `stream` ADD `stream_id` text NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stream` (
	`id` text PRIMARY KEY,
	`stream_id` text NOT NULL UNIQUE,
	`channel_name` text NOT NULL,
	`started_at` integer NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`duration_seconds` integer,
	`vod_id` text UNIQUE
);
--> statement-breakpoint
INSERT INTO `__new_stream`(`id`, `channel_name`, `started_at`, `title`, `category`, `duration_seconds`, `vod_id`) SELECT `id`, `channel_name`, `started_at`, `title`, `category`, `duration_seconds`, `vod_id` FROM `stream`;--> statement-breakpoint
DROP TABLE `stream`;--> statement-breakpoint
ALTER TABLE `__new_stream` RENAME TO `stream`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_download` (
	`id` text PRIMARY KEY,
	`stream_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` real,
	`storage_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_download`(`id`, `stream_id`, `status`, `progress`, `storage_path`, `created_at`) SELECT `id`, `stream_id`, `status`, `progress`, `storage_path`, `created_at` FROM `download`;--> statement-breakpoint
DROP TABLE `download`;--> statement-breakpoint
ALTER TABLE `__new_download` RENAME TO `download`;--> statement-breakpoint
PRAGMA foreign_keys=ON;