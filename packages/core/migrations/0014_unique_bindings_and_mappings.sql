-- The same plugin could be bound to the same scope more than once (it then ran twice per request),
-- and the same backend model could be mapped to a v-model more than once. Only the API guarded
-- against the latter, and only by checking before inserting. Remove existing duplicates, keeping
-- the oldest row of each set, then make the database refuse new ones.
DELETE FROM `plugin_bindings`
WHERE EXISTS (
  SELECT 1 FROM `plugin_bindings` AS `keep`
  WHERE `keep`.`plugin_id` = `plugin_bindings`.`plugin_id`
    AND `keep`.`scope_type` = `plugin_bindings`.`scope_type`
    AND COALESCE(`keep`.`scope_id`, '') = COALESCE(`plugin_bindings`.`scope_id`, '')
    AND (`keep`.`created_at` < `plugin_bindings`.`created_at`
      OR (`keep`.`created_at` = `plugin_bindings`.`created_at` AND `keep`.`id` < `plugin_bindings`.`id`))
);
--> statement-breakpoint
-- COALESCE because global bindings have a NULL scope_id, and NULLs are all distinct in a unique index.
CREATE UNIQUE INDEX `idx_plugin_bindings_unique_scope` ON `plugin_bindings` (`plugin_id`, `scope_type`, COALESCE(`scope_id`, ''));
--> statement-breakpoint
DELETE FROM `vmodel_backends`
WHERE EXISTS (
  SELECT 1 FROM `vmodel_backends` AS `keep`
  WHERE `keep`.`vmodel_id` = `vmodel_backends`.`vmodel_id`
    AND `keep`.`backend_id` = `vmodel_backends`.`backend_id`
    AND `keep`.`backend_model_id` = `vmodel_backends`.`backend_model_id`
    AND (`keep`.`created_at` < `vmodel_backends`.`created_at`
      OR (`keep`.`created_at` = `vmodel_backends`.`created_at` AND `keep`.`id` < `vmodel_backends`.`id`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vmodel_backends_unique_model` ON `vmodel_backends` (`vmodel_id`, `backend_id`, `backend_model_id`);
