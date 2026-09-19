ALTER TABLE `backends` ADD `model_catalog` text;
--> statement-breakpoint
ALTER TABLE `vmodels` ADD `kind` text DEFAULT 'chat' NOT NULL;
