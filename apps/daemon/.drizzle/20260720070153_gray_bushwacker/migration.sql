PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recording` (
	`id` text PRIMARY KEY,
	`stream_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`status` text NOT NULL,
	`quality` text NOT NULL,
	`storage_path` text NOT NULL,
	`bytes` integer
);
--> statement-breakpoint
INSERT INTO `__new_recording`(`id`, `stream_id`, `started_at`, `ended_at`, `status`, `quality`, `storage_path`, `bytes`) SELECT `id`, `stream_id`, `started_at`, `ended_at`, `status`, `quality`, `storage_path`, `bytes` FROM `recording`;--> statement-breakpoint
DROP TABLE `recording`;--> statement-breakpoint
ALTER TABLE `__new_recording` RENAME TO `recording`;--> statement-breakpoint
PRAGMA foreign_keys=ON;