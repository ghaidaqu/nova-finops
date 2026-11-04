ALTER TABLE `connections` ADD `settles_via` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `method` text;