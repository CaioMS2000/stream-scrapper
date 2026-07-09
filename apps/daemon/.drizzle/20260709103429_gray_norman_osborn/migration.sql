CREATE TABLE `channels` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL UNIQUE,
	`display_name` text NOT NULL,
	`monitored_since` integer NOT NULL,
	`auto_record` integer DEFAULT false NOT NULL,
	`quality_pref` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `download` (
	`id` text PRIMARY KEY,
	`stream_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`progress` text NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recording` (
	`id` text PRIMARY KEY,
	`stream_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`status` text NOT NULL,
	`quality` text NOT NULL,
	`storage_path` text NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stream` (
	`id` text PRIMARY KEY,
	`streamer_login` text NOT NULL,
	`started_at` integer NOT NULL,
	`title` text NOT NULL,
	`game` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`vod_id` text NOT NULL,
	`cdn_status` text NOT NULL,
	`last_probed_at` integer NOT NULL
);
