ALTER TABLE `connections` ADD `system` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `origin` text DEFAULT 'file' NOT NULL;