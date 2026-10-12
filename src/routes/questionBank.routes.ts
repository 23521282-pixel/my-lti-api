import { Router } from "express";
import { requireInstructor } from "../middleware/auth.js";
import {
  createQuestion,
  createQuestionBank,
  deleteQuestion,
  deleteQuestionBank,
  getQuestion,
  getQuestionBank,
  listQuestionBanks,
  listQuestions,
  updateQuestion,
  updateQuestionBank,
} from "../services/questionBank.service.js";
import {
  bankIdParamSchema,
  createQuestionBankSchema,
  createQuestionSchema,
  idParamSchema,
  parseOrThrow,
  updateQuestionBankSchema,
  updateQuestionSchema,
} from "../validation/quiz.schemas.js";

/**
 * Question bank + question authoring. Every route requires an instructor or
 * administrator, because responses include correct answers and explanations.
 */
export const questionBankRouter = Router();
questionBankRouter.use(requireInstructor);

/** GET /api/question-banks - list banks with question/quiz counts. */
questionBankRouter.get("/", async (_req, res) => {
  res.json(await listQuestionBanks());
});

/** POST /api/question-banks - create a bank. */
questionBankRouter.post("/", async (req, res) => {
  const input = parseOrThrow(createQuestionBankSchema, req.body);
  res.status(201).json(await createQuestionBank(input));
});

/** GET /api/question-banks/:id - one bank. */
questionBankRouter.get("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getQuestionBank(id));
});

/** PATCH /api/question-banks/:id - rename/redescribe a bank. */
questionBankRouter.patch("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const input = parseOrThrow(updateQuestionBankSchema, req.body);
  res.json(await updateQuestionBank(id, input));
});

/** DELETE /api/question-banks/:id - blocked while a quiz references the bank. */
questionBankRouter.delete("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  await deleteQuestionBank(id);
  res.status(204).end();
});

/** POST /api/question-banks/:bankId/questions - add a question to a bank. */
questionBankRouter.post("/:bankId/questions", async (req, res) => {
  const { bankId } = parseOrThrow(bankIdParamSchema, req.params);
  const input = parseOrThrow(createQuestionSchema, req.body);
  res.status(201).json(await createQuestion(bankId, input));
});

/** GET /api/question-banks/:bankId/questions - list a bank's questions. */
questionBankRouter.get("/:bankId/questions", async (req, res) => {
  const { bankId } = parseOrThrow(bankIdParamSchema, req.params);
  res.json(await listQuestions(bankId));
});

/** Router for /api/questions/:id - single-question authoring. */
export const questionRouter = Router();
questionRouter.use(requireInstructor);

/** GET /api/questions/:id - one question, including its answer key. */
questionRouter.get("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  res.json(await getQuestion(id));
});

/** PATCH /api/questions/:id - edit text, options, answer, or points. */
questionRouter.patch("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const input = parseOrThrow(updateQuestionSchema, req.body);
  res.json(await updateQuestion(id, input));
});

/**
 * DELETE /api/questions/:id - removes the question. Existing attempts keep
 * their snapshot, so historical results are unaffected.
 */
questionRouter.delete("/:id", async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  await deleteQuestion(id);
  res.status(204).end();
});
