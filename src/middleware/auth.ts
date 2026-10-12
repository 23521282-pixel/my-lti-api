import type { Request, RequestHandler } from "express";
import { forbidden, unauthorized } from "../lib/errors.js";
import type { AuthenticatedUser } from "../types/quiz.js";

/**
 * Reads the identity established by `requireLtiSession` (a verified LTI 1.3
 * launch). User IDs are never taken from the request body.
 */
export function getAuthenticatedUser(req: Request): AuthenticatedUser {
  const session = req.ltiSession;
  if (!session) {
    throw unauthorized("An active LTI session is required.");
  }

  return {
    id: session.user.id,
    issuer: session.platform.issuer,
    name: session.user.name,
    email: session.user.email,
    roles: session.user.roles ?? [],
    isInstructor: session.isInstructor,
    isAdmin: session.isAdmin,
    isStudent: session.isStudent,
  };
}

/**
 * Authoring question banks, questions, and quizzes requires an instructor or
 * administrator role from the verified launch. Learners get 403.
 */
export function assertInstructor(user: AuthenticatedUser): void {
  if (!user.isInstructor && !user.isAdmin) {
    throw forbidden(
      "This action requires an instructor or administrator role."
    );
  }
}

/** Express middleware form of `assertInstructor`. */
export const requireInstructor: RequestHandler = (req, _res, next) => {
  try {
    assertInstructor(getAuthenticatedUser(req));
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Row-level access rule for attempts: the owner may read/modify their own
 * attempt, administrators may access any. Everyone else is treated as if the
 * attempt does not exist so we do not confirm other users' attempt IDs.
 */
export function canAccessAttempt(
  user: AuthenticatedUser,
  ownerId: string
): boolean {
  return user.id === ownerId || user.isAdmin;
}
