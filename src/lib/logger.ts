import pino from "pino";

/**
 * Keys whose values never reach a log line, at any depth we configure. (Secrets also never appear in messages,
 * but redaction is the safety net.)
 */
export const REDACT_PATHS = [
  "password",
  "apiKey",
  "api_key",
  "accessUrl",
  "access_url",
  "token",
  "secret",
  "authorization",
  "cookie",
  "*.password",
  "*.apiKey",
  "*.api_key",
  "*.accessUrl",
  "*.access_url",
  "*.token",
  "*.secret",
  "*.authorization",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
];

const CREDENTIAL_URL = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;
const KEY_LIKE = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})\b/g;

/** Removes credentials that sneak into free text (URLs with user:pass@, API-key-looking tokens). */
export function scrub(text: string): string {
  return text.replace(CREDENTIAL_URL, "$1[redacted]@").replace(KEY_LIKE, "[redacted]");
}

export function createLogger(opts: { level?: string; destination?: pino.DestinationStream } = {}) {
  return pino(
    {
      level: opts.level ?? process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
      base: { app: "simplebudget" },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      timestamp: pino.stdTimeFunctions.isoTime,
      hooks: {
        // String arguments (the message and any %s values) are scrubbed too.
        logMethod(args, method) {
          method.apply(this, args.map((a) => (typeof a === "string" ? scrub(a) : a)) as Parameters<typeof method>);
        },
      },
      serializers: {
        err: (e: unknown) => {
          const s = pino.stdSerializers.err(e as Error);
          return { ...s, message: scrub(s.message ?? ""), stack: s.stack ? scrub(s.stack) : undefined };
        },
      },
    },
    opts.destination,
  );
}

export const logger = createLogger();
