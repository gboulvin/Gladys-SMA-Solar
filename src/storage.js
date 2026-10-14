// -----------------------------------------------------------------------------
// Persistence of the identified devices, under /data (the only writable
// volume of the container).
//
// Many SMA inverters switch their network interface off at night: after a
// restart of Gladys in the evening, the integration could not identify them
// before the next sunrise, and their devices would disappear from the
// Discovery tab. The profiles found once are kept here instead.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'storage' });

const FILE_NAME = 'sma-devices.json';
const FORMAT_VERSION = 1;

export function createStorage(directory = process.env.SMA_DATA_DIR ?? '/data') {
  const file = join(directory, FILE_NAME);
  return {
    /** @returns {Promise<Record<string, object>>} profiles keyed by target key */
    async load() {
      try {
        const content = JSON.parse(await readFile(file, 'utf8'));
        return content.version === FORMAT_VERSION ? content.profiles : {};
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read ${file}, starting from an empty list`, err);
        }
        return {};
      }
    },

    async save(profiles) {
      try {
        await mkdir(directory, { recursive: true });
        // Write then rename: a crash mid-write never leaves a truncated file.
        const temporary = `${file}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: FORMAT_VERSION, profiles }, null, 2));
        await rename(temporary, file);
      } catch (err) {
        logger.warn(`Cannot write ${file}`, err);
      }
    },
  };
}
