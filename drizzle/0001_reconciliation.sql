CREATE TABLE `issue_states` (
	`workspace_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `issue_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `kind` text DEFAULT 'sales' NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `fee_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `fee_fixed_halalas` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `lag_days` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `fee_halalas` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `branch` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_workspace_fingerprint_unique` ON `transactions` (`workspace_id`,`fingerprint`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `sector` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `tolerance_halalas` integer DEFAULT 100 NOT NULL;