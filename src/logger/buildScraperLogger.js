import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { BACKEND_NODE_ENV } from '../utils/constants.js';
import fs from 'fs';

const { combine, timestamp, printf, splat, label, colorize } = format;

const getISTTime = () => {
  const options = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('en-IN', options);
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  const second = parts.find(p => p.type === 'second').value;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const scraperFormat = printf(
  ({ level, message, timestamp, label, ...meta }) => {
    const metaString =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

    return `${timestamp} ${label} [${level}]: ${message}${metaString}`;
  }
);

export function buildScraperLogger(scraperName) {
  const winstonTransports = [];

  // In production, log to daily rotating files
  if (BACKEND_NODE_ENV === 'production') {
    const folder = `logs/scrapers/${scraperName}`;
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    winstonTransports.push(
      new DailyRotateFile({
        dirname: folder,
        filename: `${scraperName}-log-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        level: 'info',
        maxSize: '20m',
        maxFiles: '14d',
        format: combine(
          splat(),
          label({ label: scraperName }),
          timestamp({ format: getISTTime }),
          scraperFormat
        ),
      }),

      new DailyRotateFile({
        dirname: folder,
        filename: `${scraperName}-error-log-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        format: combine(
          splat(),
          label({ label: scraperName }),
          timestamp({ format: getISTTime }),
          scraperFormat
        ),
      })
    );
  }

  // Console transport in both dev and production
  winstonTransports.push(
    new transports.Console({
      level: BACKEND_NODE_ENV === 'production' ? 'info' : 'debug',
      format: combine(
        colorize(),
        splat(),
        label({ label: scraperName }),
        timestamp({ format: getISTTime }),
        scraperFormat
      ),
    })
  );

  return createLogger({
    transports: winstonTransports,
  });
}
