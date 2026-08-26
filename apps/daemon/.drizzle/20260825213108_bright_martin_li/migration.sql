ALTER TABLE `download` ADD `resolved_via` text;--> statement-breakpoint
ALTER TABLE `download` ADD `host` text;--> statement-breakpoint
ALTER TABLE `download` ADD `base_url` text;--> statement-breakpoint
ALTER TABLE `download` ADD `segments` text;--> statement-breakpoint
ALTER TABLE `download` ADD `segment_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `download` ADD `byte_offset` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `download` ADD `lease_until` integer;