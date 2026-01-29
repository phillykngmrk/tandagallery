import { createDb } from '@aggragif/db';
import { config } from '../config/index.js';

export const db = createDb(config.DATABASE_URL);
