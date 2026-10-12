import { Router } from "express";
import { getAuthenticatedUser, requireInstructor } from "../middleware/auth.js";
import { listMyAttempts, startAttempt } from "../services/attempt.service.js";
import {
  createQuiz,
  deleteQuiz,
  getQuiz,
  listQuizzes,
  updateQuiz,
} from "../services/quiz.service.js";
import {
  createQuizSchema,
  idParamSchema,
  parseOrThrow,
  updateQuizSchema,
} from "../validation/quiz.schemas.js";

/**
 * Quiz definitions plus the learner entry point for starting an attempt.
 * Reading quizzes is open to any authenticated launch; creating, editing, and
 * deleting requires an instructor or administrator.
 */
export const quizRouter = Router();

/** GET /api/quizzes - list quizzes (no questions, no answers). */
quizRouter.get("/", async (_req, res) => {
  res.json(await listQuizzes());
});

/** POST /api/quizzes - create a quiz from a bank + question count. */
quizRouter.post("/", requireInstructor, async (req, res) => {
  const input = parseOrThrow(createQuizSchema, req.body);
  res.status(201).json(await createQuiz(input));
});

/** GET /api/quizzes/:id - quiz metadata and availability. */
quizRouter.get("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getQuiz(id));
});

/** PATCH /api/quizzes/:id - update title, description, bank, or count. */
quizRouter.patch("/:id", requireInstructor, async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const input = parseOrThrow(updateQuizSchema, req.body);
  res.json(await updateQuiz(id, input));
});

/** DELETE /api/quizzes/:id - blocked once the quiz has attempts. */
quizRouter.delete("/:id", requireInstructor, async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  await deleteQuiz(id);
  res.status(204).end();
});

/**
 * POST /api/quizzes/:id/attempts - start an attempt. Draws a fresh random
 * selection for the caller and snapshots it for the life of the attempt.
 */
quizRouter.post("/:id/attempts", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = getAuthenticatedUser(req);
  res.status(201).json(await startAttempt(id, user));
});

/** GET /api/quizzes/:id/attempts/me - the caller's attempts for this quiz. */
quizRouter.get("/:id/attempts/me", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = getAuthenticatedUser(req);
  res.json(await listMyAttempts(id, user));
});
