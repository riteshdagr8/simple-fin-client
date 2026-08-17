// Safety guard against destructive operations on the production database.
//
// The app's real data lives in the repo-root `finapp.db`. Test/dev scripts and
// ad-hoc one-off scripts (seed, cleanup, repro) frequently want to point at a
// scratch DB via `DB_PATH`, and a missing env var silently falls back to the
// real file — which is how real data got wiped once. This helper makes that
// failure loud.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_DB = path.resolve(path.join(__dirname, '..', 'finapp.db'));

// Resolve the DB path that would be used, without opening anything.
export function resolveDbPath() {
  return process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : PROD_DB;
}

// True if the given path (or the current DB_PATH / default) points at the
// production database file.
export function isProductionDb(targetPath) {
  const t = targetPath ? path.resolve(targetPath) : resolveDbPath();
  return t.toLowerCase() === PROD_DB.toLowerCase();
}

// Throws if the operation would target the production DB. Destructive/test
// scripts call this before running. `action` is a short description for the
// error message (e.g. "truncate all tables").
export function guardNotProduction(action = 'modify') {
  if (isProductionDb()) {
    throw new Error(
      `REFUSED: attempted to ${action} the production database (${PROD_DB}).\n` +
      `This operation is only allowed against a scratch DB. Set DB_PATH to an ` +
      `explicit temp/test database path and re-run.`
    );
  }
}

// For scripts that build their own DB_PATH, guard an explicit target.
export function guardPathNotProduction(targetPath, action = 'modify') {
  if (isProductionDb(targetPath)) {
    throw new Error(
      `REFUSED: attempted to ${action} the production database (${PROD_DB}).\n` +
      `Refusing to touch the real finapp.db. Set DB_PATH to a scratch database.`
    );
  }
}
