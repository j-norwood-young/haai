ALTER TABLE `backends` ADD `available_models` text;
--> statement-breakpoint
ALTER TABLE `vmodels` ADD `last_health_status` text;
--> statement-breakpoint
ALTER TABLE `vmodels` ADD `last_health_error` text;
--> statement-breakpoint
ALTER TABLE `vmodels` ADD `last_health_check` integer;
--> statement-breakpoint
ALTER TABLE `vmodel_backends` ADD `last_available` integer;
--> statement-breakpoint
ALTER TABLE `vmodel_backends` ADD `unavailable_reason` text;
