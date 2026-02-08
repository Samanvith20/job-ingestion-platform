import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const { combine, timestamp, label, printf,splat } = format;

const prodFormat = printf(({ level, message, label, timestamp, ...meta }) => {
  const metaString =
    Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

  return `${timestamp} ${label} [${level}]: ${message}${metaString}`;
});

const productionLogger = () => {
  return createLogger({
    level: 'info',
    format: combine(
      format.colorize(),
      label({ label: 'prod' }),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      prodFormat
    ),

    transports: [
      new DailyRotateFile({
        dirname: 'logs/main',
        filename: 'main-logs-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'info',
         maxSize: "20m",
        maxFiles: "30d",
      }),

      new DailyRotateFile({
        dirname: 'logs/main',
        filename: 'main-error-logs-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: "20m",
        maxFiles: "30d",
      }),

      new transports.File({ filename: 'error.log', level: 'error' }), // Only logs 'error' level to this file
      new transports.File({ filename: 'combined.log', level: 'info' }), // Logs 'info', 'warn', 'error' to this file
      new transports.Console(),
    ],
  });
};

export default productionLogger;
