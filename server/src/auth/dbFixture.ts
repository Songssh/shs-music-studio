// Single-owner service tests explicitly install the same ownership schema used
// at startup. HTTP security itself is exercised by http/ownership integration tests.
import { initDb as initialize, getDb, closeDb } from '../db/database.js';
import { prepareTestOwner } from './testSupport.js';
import { config } from '../config.js';
export {getDb,closeDb};
export function initDb(){initialize();prepareTestOwner(getDb(),config.data.dir);}
