// Configuration centralisée (lue depuis l'environnement, .env chargé par index.js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const PORT = Number(process.env.PORT) || 8080;
export const SESSION_SECRET = process.env.SESSION_SECRET || '';
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export const DEFAULT_ACCENT = '#E8A13C';
