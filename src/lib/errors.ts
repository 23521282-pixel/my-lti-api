import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/**
 * Error carrying an HTTP status code and a message that is safe to send to
 * clients. Anything that is *not* an HttpError is treated as an unexpected
 * failure and reported generically so stack traces and database errors never
 * leak out of the API.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, message, details);
}

export function unauthorized(message = "Unauthorized"): HttpError {
  return new HttpError(401, message);
}

export function forbidden(message = "Forbidden"): HttpError {
  return new HttpError(403, message);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

/** 404 handler for unmatched routes, registered after all routers. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No route matches ${req.method} ${req.path}`,
  });
};

/**
 * Central error handler. Express 5 forwards rejected promises from async
 * handlers here automatically, so routes can simply `throw`.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      message: "The request body or parameters are invalid.",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.status === 404 ? "Not Found" : "Request failed",
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
    });
    return;
  }

  // Middleware such as `express.json` raises errors carrying a status code
  // (malformed JSON, payload too large, ...). Those are client mistakes, so the
  // status is preserved but the raw message is not echoed back.
  const middlewareStatus = (err as { status?: unknown; statusCode?: unknown })
    ?.status;
  if (
    typeof middlewareStatus === "number" &&
    middlewareStatus >= 400 &&
    middlewareStatus < 500
  ) {
    res.status(middlewareStatus).json({
      error: "Request failed",
      message: "The request could not be parsed.",
    });
    return;
  }

  // Unexpected failure: log server-side, tell the client nothing specific.
  console.error("Unhandled API error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred.",
  });
};
