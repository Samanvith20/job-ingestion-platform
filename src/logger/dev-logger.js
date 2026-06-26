import { createLogger, format, transports } from "winston";

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

const myFormat = printf(({ level, message, label, timestamp, ...meta }) => {
  const metaString =
    Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

  return `${timestamp} ${label} [${level}]: ${message}${metaString}`;
});

const devLogger = () => {
  return createLogger({
    level: "debug",
    transports: [
      new transports.Console({
        format: combine(
          colorize(),
          splat(),
          label({ label: "dev" }),
          timestamp({ format: getISTTime }),
          myFormat
        )
      })
    ],
  });
};

export default devLogger;
