CREATE TABLE `harvest_channel` (
	`id` text PRIMARY KEY,
	`channel_name` text NOT NULL UNIQUE,
	`added_at` integer NOT NULL
);
