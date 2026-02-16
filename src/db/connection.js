import mongoose from 'mongoose';
import { MONGODB_URL } from '../utils/constants.js';
import logger from '../logger/logger.js';
export const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URL);

    logger.info('✅ Connected to MongoDB');
  } catch (error) {
    logger.error('MongoDB Connection Error:', error);
  }
};
