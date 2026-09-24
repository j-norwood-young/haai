-- Older installs could have several backends sharing a host name. Keep the oldest one's host name and
-- suffix the rest with their (unique) backend name, so the unique index below can be created.
UPDATE `backends` SET `host_name` = `host_name` || '-' || `name`
WHERE EXISTS (
  SELECT 1 FROM `backends` AS `keep`
  WHERE `keep`.`host_name` = `backends`.`host_name`
    AND (`keep`.`created_at` < `backends`.`created_at`
      OR (`keep`.`created_at` = `backends`.`created_at` AND `keep`.`id` < `backends`.`id`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_backends_host_provider` ON `backends` (`host_name`,`provider`);
