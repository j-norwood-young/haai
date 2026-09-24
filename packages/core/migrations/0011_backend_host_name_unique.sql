DROP INDEX IF EXISTS `idx_backends_host_provider`;
--> statement-breakpoint
-- Same dedupe as 0010, for databases that applied 0010 before it had one (duplicates across providers).
UPDATE `backends` SET `host_name` = `host_name` || '-' || `name`
WHERE EXISTS (
  SELECT 1 FROM `backends` AS `keep`
  WHERE `keep`.`host_name` = `backends`.`host_name`
    AND (`keep`.`created_at` < `backends`.`created_at`
      OR (`keep`.`created_at` = `backends`.`created_at` AND `keep`.`id` < `backends`.`id`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_backends_host_name` ON `backends` (`host_name`);
