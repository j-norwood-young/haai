DROP INDEX IF EXISTS `idx_backends_host_provider`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_backends_host_name` ON `backends` (`host_name`);
