CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`source` text NOT NULL,
	`credentials` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_error` text,
	`last_sync_at` text,
	`synced_through` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_workspace_provider_unique` ON `integrations` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`used_at` text
);
