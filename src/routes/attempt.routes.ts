import { Router } from "express";
import { getAuthenticatedUser } from "../middleware/auth.js";
import {
  getAttempt,
  reviewAttempt,
  saveAnswers,
  submitAttempt,
} from "../services/attempt.service.js";
import {
  idParamSchema,
  parseOrThrow,
  saveAnswersSchema,
  submitAttemptSchema,
} from "../validation/quiz.schemas.js";

/**
 * Attempt endpoints. All are scoped to the authenticated launch identity: a
 * caller can only ever reach their own attempts.
 */
export const attemptRouter = Router();

/** GET /api/attempts/:id - attempt state. Answer keys are never included. */
attemptRouter.get("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getAttempt(id, getAuthenticatedUser(req)));
});

/** PUT /api/attempts/:id/answers - save/update draft answers. */
attemptRouter.put("/:id/answers", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const input = parseOrThrow(saveAnswersSchema, req.body ?? {});
  res.json(await saveAnswers(id, getAuthenticatedUser(req), input.answers));
});

/**
 * POST /api/attempts/:id/submit - grade and finalise. Answers may be sent in
 * the body; otherwise the previously saved answers are graded.
 */
attemptRouter.post("/:id/submit", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const input = parseOrThrow(submitAttemptSchema, req.body ?? {});
  res.json(
    await submitAttempt(id, getAuthenticatedUser(req), input.answers ?? [])
  );
});

/** GET /api/attempts/:id/review - full review, only after submission. */
attemptRouter.get("/:id/review", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await reviewAttempt(id, getAuthenticatedUser(req)));
});
