import { createLogger, format, transports } from "winston";
const { combine, timestamp, json, colorize } = format;

const consoleLogFormat = format.combine(
  format.colorize(),
  format.printf(({ level, message, timestamp }) => {
    return `${level}: ${message}`;
  })
);

const consoleTransport = new transports.Console({
  format: consoleLogFormat,
});

const logger = createLogger({
  level: "info",
  format: combine(colorize(), timestamp(), json()),
  transports: [
    consoleTransport,
    // Capped at 5 × 10 MB; the oldest file is dropped once the limit is reached.
    new transports.File({ filename: "app.log", maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true }),
  ],
});

/* When the terminal that started the server goes away, every console write fails with
   EPIPE. Unhandled, that became an uncaught exception which was logged to the console,
   failed again and looped, writing ~100 GB to app.log. Drop the console transport once
   stdout/stderr is gone and keep logging to the file only. */
export const isBrokenPipe = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "EPIPE";

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (!isBrokenPipe(err)) throw err;
    if (logger.transports.includes(consoleTransport)) logger.remove(consoleTransport);
  });
}

export default logger;
