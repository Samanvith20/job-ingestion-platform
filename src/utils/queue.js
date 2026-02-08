// src/utils/constants.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// This function converts a file URL to a normal file system path.
const __filename = fileURLToPath(import.meta.url);

// Get the directory name of the current file
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

export const PORT = process.env.PORT;
export const MONGODB_URL = process.env.MONGODB_URL;
export const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY;
export const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
export const AZURE_OPENAI_MODEL = process.env.AZURE_OPENAI_MODEL;
export const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION;
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = process.env.REDIS_PORT || 6379;
export const BACKEND_NODE_ENV = process.env.BACKEND_NODE_ENV;
export const maxPages = 10;
export const PROXY_SET = process.env.PROXY_SET;
export const PROXY_URL = process.env.PROXY_URL;
export const PROXY_AUTH = process.env.PROXY_AUTH;
export const API_URL = process.env.API_URL;
export const HEADER_VALUE = process.env.HEADER_VALUE;
export const NAUKRI_APP_ID = process.env.NAUKRI_APP_ID;
export const NAUKRI_CLIENT_ID = process.env.NAUKRI_CLIENT_ID;
export const NAUKRI_NK_PARAM = process.env.NAUKRI_NK_PARAM;
export const SLACK_OAUTH = process.env.SLACK_OAUTH;
export const SLACK_CHANNEL = process.env.SLACK_CHANNEL;
export const SENTRY_DSN = process.env.SENTRY_DSN;
export const MAX_LOCK_TIME_MS = 60 * 60 * 1000; // 1 hour
export const MAX_RETRIES = 3;
export const MAX_BATCH_WAIT_MS = 24 * 60 * 60 * 1000; // 24 hours
export const BATCH_LIMIT = 1000;
export const EVERY_BATCH_LIMIT = 100;
export const NEO4J_URI = process.env.NEO4J_URI;
export const NEO4J_USER = process.env.NEO4J_USER;
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
