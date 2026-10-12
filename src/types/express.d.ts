import type { LTISession } from "@lti-tool/core";

declare global {
  namespace Express {
    interface Request {
      cookies?: Record<string, string>;
      ltiSession?: LTISession;
    }
  }
}

export {};
