import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudConfigured, DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('an empty configuration gets the defaults: local only', () => {
  const config = normalizeConfig();
  assert.equal(config.cloud_mode, 'none');
  assert.equal(config.local_enabled, true);
  assert.equal(config.scan_interval, DEFAULT_CONFIG.scan_interval);
  assert.equal(config.GLADYS_PREFER_LOCAL, true);
  assert.deepEqual(config.localDevices, []);
  assert.equal(config.session, null);
});

test('values from the form are typed and bounded', () => {
  const config = normalizeConfig({
    scan_interval: '5',
    poll_interval: '99999',
    region: 'mars',
    country_code: '0033 ',
    app_id: '  id  ',
    GLADYS_PREFER_LOCAL: false,
  });
  assert.equal(config.scan_interval, 20);
  assert.equal(config.poll_interval, 600);
  assert.equal(config.region, 'eu');
  assert.equal(config.country_code, '+33');
  assert.equal(config.app_id, 'id');
  assert.equal(config.GLADYS_PREFER_LOCAL, false);
});

test('the off-schema keys are parsed, invalid entries dropped', () => {
  const config = normalizeConfig({
    ewelink_session: JSON.stringify({ at: 'x' }),
    local_devices: JSON.stringify([{ deviceid: '1000aabbcc' }, { deviceid: 'bad' }, null]),
  });
  assert.deepEqual(config.session, { at: 'x' });
  assert.deepEqual(config.localDevices, [{ deviceid: '1000aabbcc' }]);
  assert.equal(normalizeConfig({ ewelink_session: '{oops' }).session, null);
});

test('the cloud needs an App ID and an App Secret, plus the account in password mode', () => {
  const base = { app_id: 'a', app_secret: 'b' };
  assert.equal(cloudConfigured(normalizeConfig({ cloud_mode: 'none', ...base })), false);
  assert.equal(cloudConfigured(normalizeConfig({ cloud_mode: 'oauth', app_id: 'a' })), false);
  assert.equal(cloudConfigured(normalizeConfig({ cloud_mode: 'oauth', ...base })), true);
  assert.equal(cloudConfigured(normalizeConfig({ cloud_mode: 'password', ...base })), false);
  assert.equal(
    cloudConfigured(
      normalizeConfig({ cloud_mode: 'password', ...base, account: 'me@x.fr', password: 'p' }),
    ),
    true,
  );
});
