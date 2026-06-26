import { createClient } from 'redis';
import { REDIS_HOST, REDIS_PORT } from '../utils/constants.js';

import logger from '../logger/logger.js';

if (!REDIS_HOST || !REDIS_PORT) {
  throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
}

const redis = createClient({
  socket: {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
  },
});

redis.on('error', (err) => logger.error('Redis Client Error:', err));

try {
  await redis.connect();
  logger.info('✅ Redis connected successfully');
} catch (err) {
  logger.error('❌ Failed to connect to Redis:', err.message);
  process.exit(1);
}

export default redis;
