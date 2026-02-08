import { createLogger, format, transports } from "winston";

const { combine, timestamp, label, printf, splat } = format;

const myFormat = printf(({ level, message, label, timestamp, ...meta }) => {
  const metaString =
    Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

  return `${timestamp} ${label} [${level}]: ${message}${metaString}`;
});

const devLogger = () => {
  return createLogger({
    level: "debug",
    format: combine(
      splat(), // 👈 THIS is the key part
      format.colorize(),
      label({ label: "dev" }),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      myFormat
    ),
    transports: [new transports.Console()],
  });
};

export default devLogger;
