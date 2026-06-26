import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const { combine, timestamp, label, printf, splat, colorize } = format;

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

const prodFormat = printf(({ level, message, label, timestamp, ...meta }) => {
  const metaString =
    Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

  return `${timestamp} ${label} [${level}]: ${message}${metaString}`;
});

const productionLogger = () => {
  return createLogger({
    level: 'info',
    transports: [
      new DailyRotateFile({
        dirname: 'logs/main',
        filename: 'main-logs-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'info',
        maxSize: "20m",
        maxFiles: "30d",
        format: combine(
          splat(),
          label({ label: 'prod' }),
          timestamp({ format: getISTTime }),
          prodFormat
        )
      }),

      new DailyRotateFile({
        dirname: 'logs/main',
        filename: 'main-error-logs-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: "20m",
        maxFiles: "30d",
        format: combine(
          splat(),
          label({ label: 'prod' }),
          timestamp({ format: getISTTime }),
          prodFormat
        )
      }),

      new transports.File({ 
        filename: 'error.log', 
        level: 'error',
        format: combine(
          splat(),
          label({ label: 'prod' }),
          timestamp({ format: getISTTime }),
          prodFormat
        )
      }),
      new transports.File({ 
        filename: 'combined.log', 
        level: 'info',
        format: combine(
          splat(),
          label({ label: 'prod' }),
          timestamp({ format: getISTTime }),
          prodFormat
        )
      }),
      new transports.Console({
        format: combine(
          colorize(),
          splat(),
          label({ label: 'prod' }),
          timestamp({ format: getISTTime }),
          prodFormat
        )
      }),
    ],
  });
};

export default productionLogger;
