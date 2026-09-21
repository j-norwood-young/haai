-- plugin_bindings.scope_id has no foreign key, so bindings outlived the v-model, backend or key
-- they were scoped to. Deleting those entities now removes their bindings; clear the existing orphans.
DELETE FROM `plugin_bindings`
WHERE (`scope_type` = 'vmodel' AND `scope_id` NOT IN (SELECT `id` FROM `vmodels`))
   OR (`scope_type` = 'backend' AND `scope_id` NOT IN (SELECT `id` FROM `backends`))
   OR (`scope_type` = 'key' AND `scope_id` NOT IN (SELECT `id` FROM `api_keys`));
