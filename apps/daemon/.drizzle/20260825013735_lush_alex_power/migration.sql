CREATE TABLE `cdn_host` (
	`id` text PRIMARY KEY,
	`host` text NOT NULL UNIQUE,
	`discovered_at` integer NOT NULL
);
