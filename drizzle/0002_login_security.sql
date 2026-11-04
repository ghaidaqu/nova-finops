ALTER TABLE `users` ADD `password_iterations` integer DEFAULT 150000 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `failed_logins` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` text;