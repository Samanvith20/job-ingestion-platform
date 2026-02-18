


import crypto from 'crypto';
import { connectDB } from '../db/connection.js';
import { Worker } from 'bullmq';

import { connection } from '../queue/connection.js';

import { Cleanerfunction } from '../cleaner/index.js';

import logger from '../logger/logger.js';
import Sentry from '../sentry.js';
import { setScraperContext } from '../utils/sentryContext.js';

import { RawJob } from '../db/rawJobmodel.js';
import { Job } from '../db/jobmodel.js';
import { JOB_CLEANER_WORKER } from '../utils/constants.js';

/**
 * Initialize and run the worker that processes raw job documents from the queue.
 *
 * Connects to MongoDB, starts a BullMQ worker for 'raw-job-queue', processes incoming jobs by
 * cleaning and saving results to the `jobs` collection, updates `RawJobs` statuses, registers
 * lifecycle event handlers (completed, failed, error), and installs a SIGINT handler for graceful shutdown.
 */
async function startWorker() {
setScraperContext(JOB_CLEANER_WORKER);

  try {
    // Wait for MongoDB connection
    await connectDB();
    logger.info('✅ Connected to MongoDB');

    const worker = new Worker(
      'raw-job-queue',
      async (job) => {
        logger.info(`🚀 Worker started processing job ID: ${job.id}`);

        try {
          const { id } = job.data

          // Find the raw document
          const rawDoc = await RawJob.findById(id);
          if (!rawDoc) {
            logger.error(`❌ Raw document not found for ID: ${id}`);
            return { error: 'Document not found' };
          }

          if (rawDoc.status !== 'queued') {
            logger.warn(`⚠️ Raw document ${id} already processed with status: ${rawDoc.status}`);
            return { error: 'Already processed' };
          }
          const site = rawDoc.source;
          logger.debug(`Site: ${site}`);

          if (!rawDoc.externalId) {
            logger.error(`❌ Missing externalId for rawDoc: ${id}`);
            await RawJob.findByIdAndUpdate(id, {
              status: 'failed',
              error: 'Missing externalId',
            });
            return { error: 'Missing externalId' };
          }

          // Hash with site + externalId
          const _id = crypto
            .createHash('sha256')
            .update(rawDoc.source + rawDoc.externalId)
            .digest('hex');

          logger.debug(`Generated job hash ID: ${_id}`);

          // Avoid duplicates
          const existingJob = await Job.findById(_id);
          if (existingJob) {
            logger.warn(`⚠️ Duplicate job detected: ${_id} — skipping.`);
            return;
          }

          // Call the cleaner function
          const result = await Cleanerfunction(rawDoc.rawData, site);
          
          if (!result) {
            logger.warn(`⚠️ Cleaner returned no result for rawDoc ID: ${id}`);
            await RawJob.findByIdAndUpdate(id, {
              status: 'failed',
              error: 'No result from cleaner',
            });
            return { error: 'No result from cleaner' };
          }

          // Save the cleaned data
          const savedDoc = await Job.create({
            _id,
            ...result,
          });

          // Update raw data status
          await RawJob.findByIdAndUpdate(id, { status: 'completed' });

          logger.info(`✅ Successfully saved processed job: ${savedDoc._id}`);
          return { savedId: savedDoc._id };
        } catch (error) {
          Sentry.captureException(error);
          logger.error(`❌ Error processing job: ${job.id}`, {
            error: error.message,
          });

          // Update status to failed
          if (job.data.id) {
            await RawJob.findByIdAndUpdate(job.data.id, {
              status: 'failed',
              error: error.message,
            }).catch((err) =>
              
              logger.error('Failed to update status after error', {
                error: err.message,
              })
              
            );
          }

          throw error; // Re-throw to mark job as failed in BullMQ
        }
      },
      {
        connection,
        // concurrency: 5, // You can control parallelism here
      }
    );

    // Worker lifecycle logs
    worker.on('completed', (job) => {
      logger.info(`🎉 Job ${job.id} has been completed successfully!`);
    });

    worker.on('failed', (job, err) => {
      logger.error(`❌ Job ${job.id} failed`, { error: err});
    });

    worker.on('error', (err) => {
      logger.error('🚨 Worker error occurred', { error: err });
    });

    logger.info('🚀 Worker is running and waiting for jobs...');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.warn('⚠️ Shutting down worker...');
      await worker.close();
      process.exit(0);
    });
  } catch (error) {
      Sentry.captureException(error);
    logger.error('❌ Failed to start worker', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the worker
startWorker();
