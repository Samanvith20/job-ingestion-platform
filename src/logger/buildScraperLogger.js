import { createLogger, format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { BACKEND_NODE_ENV } from '../utils/constants.js';
import fs from 'fs';



const { combine, timestamp, printf, splat, label } = format;

const scraperFormat = printf(
  ({ level, message, timestamp, label, ...meta }) => {
    const metaString =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

    return `${timestamp} ${label} [${level}]: ${message}${metaString}`;
  }
);

export function buildScraperLogger(scraperName) {
  // ⛔ In dev → return console-based logger
  if (BACKEND_NODE_ENV !== 'production') {
    return console;
  }

  const folder = `logs/scrapers/${scraperName}`;
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  return createLogger({
    level: 'info',
    format: combine(
      splat(),
      label({ label: scraperName }),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      scraperFormat
    ),
    transports: [
      new DailyRotateFile({
        dirname: folder,
        filename: `${scraperName}-log-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        level: 'info',
        maxSize: '20m',
        maxFiles: '14d',
      }),

      new DailyRotateFile({
        dirname: folder,
        filename: `${scraperName}-error-log-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
      }),
    ],
  });
}
