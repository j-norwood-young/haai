-- Keys saved via PATCH previously did not flip key_mode to abstraction, so the
-- encrypted key was stored but never sent upstream. Repair those rows.
UPDATE `backends`
SET `key_mode` = 'abstraction'
WHERE `encrypted_api_key` IS NOT NULL
  AND `encrypted_api_key` != ''
  AND `key_mode` = 'passthrough';
