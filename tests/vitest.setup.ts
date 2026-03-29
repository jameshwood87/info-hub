import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.join(os.tmpdir(), `info-hub-tests-${crypto.randomBytes(8).toString('hex')}`);
process.env.INFO_HUB_VAR_DIR = dir;
process.env.NODE_ENV = 'test';

