import pino from "pino";
import { reportLoggedError } from "./monitoring";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  hooks: {
    // Error-level lines that carry an `err` are also sent to Sentry when it is
    // configured (see lib/monitoring.ts). Child loggers, including pino-http's
    // per-request `req.log`, inherit this hook.
    logMethod(args, method, level) {
      reportLoggedError(level, args, this.bindings());
      return method.apply(this, args);
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
