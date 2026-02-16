import { QueueEvents } from 'bullmq';
import { connection } from './connection.js';

// listen to state changes on the worker 
export const locationDoneEvents = new QueueEvents(
  'naukri-location-done',
  { connection }
);
