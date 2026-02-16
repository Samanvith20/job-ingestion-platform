// src/utils/constants.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// This function converts a file URL to a normal file system path.
const __filename = fileURLToPath(import.meta.url);

// Get the directory name of the current file
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });


export const MONGODB_URL = process.env.MONGODB_URL;
export const NAUKRI_APP_ID = process.env.NAUKRI_APP_ID;
export const NAUKRI_CLIENT_ID = process.env.NAUKRI_CLIENT_ID;
export const NAUKRI_NK_PARAM = process.env.NAUKRI_NK_PARAM;
export const BACKEND_NODE_ENV = process.env.BACKEND_NODE_ENV || 'production';
export const SENTRY_DSN = process.env.SENTRY_DSN || '';
export const PROXY_SET = process.env.PROXY_SET || 'false';
export const PROXY_URL = process.env.PROXY_URL || '';
export const PROXY_AUTH = process.env.PROXY_AUTH || '';
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = process.env.REDIS_PORT || '6379';
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || '';
export const OPENAI_KEY = process.env.OPENROUTER_API_KEY || '';
export const BATCH_SIZE =  250;
export const JOB_EXPIRY_DAYS = 21;
export const NEO4J_URI = process.env.NEO4J_URI || '';
export const NEO4J_USER = process.env.NEO4J_USERNAME || '';
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || '';
export const JOB_CLEANER_WORKER = "JOB_CLEANER_WORKER";
