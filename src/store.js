// -----------------------------------------------------------------------------
// Persistence under /data, the only writable path of the container.
//
//   - devices.json: last cloud device list (names, UIIDs, devicekeys), so the
//     LAN control keeps working when the cloud is down or its quota exhausted;
//   - quota.json: API calls of the current month (the free App ID allows
//     50,000 per month and per region).
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const FREE_QUOTA_PER_MONTH = 50_000;

export class JsonStore {
  /** @param {string} [directory] - Data directory. */
  constructor(directory = process.env.DATA_DIR ?? '/data') {
    this.directory = directory;
  }

  async read(name, fallback) {
    try {
      return JSON.parse(await readFile(join(this.directory, name), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger.warn(`Cannot read ${name}: ${error?.message ?? error}`);
      }
      return fallback;
    }
  }

  /** Write through a temporary file: a crash never leaves a truncated file. */
  async write(name, value) {
    try {
      await mkdir(this.directory, { recursive: true });
      const path = join(this.directory, name);
      await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } catch (error) {
      logger.warn(`Cannot write ${name}: ${error?.message ?? error}`);
    }
  }
}

const monthOf = (date) => date.toISOString().slice(0, 7);

/** Monthly API call counter, saved at most every 30 s. */
export class QuotaCounter {
  constructor(store, { now = () => new Date() } = {}) {
    this.store = store;
    this.now = now;
    this.state = { month: monthOf(now()), calls: 0 };
    this.saveTimer = null;
  }

  async load() {
    const saved = await this.store.read('quota.json', null);
    if (saved && saved.month === monthOf(this.now()) && Number.isFinite(saved.calls)) {
      this.state = saved;
    }
  }

  count() {
    const month = monthOf(this.now());
    if (month !== this.state.month) {
      this.state = { month, calls: 0 };
    }
    this.state.calls += 1;
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.store.write('quota.json', this.state);
      }, 30_000);
      this.saveTimer.unref?.();
    }
  }

  get calls() {
    return this.state.month === monthOf(this.now()) ? this.state.calls : 0;
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.store.write('quota.json', this.state);
  }
}
