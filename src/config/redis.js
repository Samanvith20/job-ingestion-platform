import { createClient } from 'redis';
import { REDIS_HOST, REDIS_PORT } from '../utils/constants.js';

if (!REDIS_HOST || !REDIS_PORT) {
  throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
}

const redis = createClient({
  socket: {
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
  },
});

redis.on('error', (err) => console.error('Redis Client Error:', err));

try {
  await redis.connect();
  console.log('✅ Redis connected successfully');
} catch (err) {
  console.error('❌ Failed to connect to Redis:', err.message);
  process.exit(1);
}

export default redis;
