import { Router } from "express";
import {
  getAllQuizzes,
  getQuizById,
  evaluateQuizSubmission,
} from "../services/quiz.service.js";

export const quizRouter = Router();

/**
 * GET /api/quizzes
 * Returns list of quizzes (metadata only, no questions or answers).
 */
quizRouter.get("/", (_req, res) => {
  const quizzes = getAllQuizzes();
  res.json(quizzes);
});

/**
 * GET /api/quizzes/:id
 * Returns a specific quiz with its questions and options.
 * Does NOT expose correctAnswer.
 */
quizRouter.get("/:id", (req, res) => {
  const { id } = req.params;
  const quiz = getQuizById(id);

  if (!quiz) {
    return res.status(404).json({
      error: "Quiz not found",
      message: `No quiz found with ID: ${id}`,
    });
  }

  res.json(quiz);
});

/**
 * POST /api/quizzes/:id/submit
 * Submits answers and calculates score.
 */
quizRouter.post("/:id/submit", (req, res) => {
  const { id } = req.params;
  const { answers } = req.body || {};

  if (!Array.isArray(answers)) {
    return res.status(400).json({
      error: "Invalid submission",
      message: "Request body must contain an 'answers' array.",
    });
  }

  for (const item of answers) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.questionId !== "string" ||
      typeof item.answer !== "string"
    ) {
      return res.status(400).json({
        error: "Invalid submission",
        message: "Each answer item must have 'questionId' and 'answer' as strings.",
      });
    }
  }

  const quiz = getQuizById(id);
  if (!quiz) {
    return res.status(404).json({
      error: "Quiz not found",
      message: `No quiz found with ID: ${id}`,
    });
  }

  const validQuestionIds = new Set(quiz.questions.map((q) => q.id));
  for (const item of answers) {
    if (!validQuestionIds.has(item.questionId)) {
      return res.status(400).json({
        error: "Invalid submission",
        message: `Question ID '${item.questionId}' does not belong to quiz '${id}'.`,
      });
    }
  }

  const result = evaluateQuizSubmission(id, answers);

  if (!result) {
    return res.status(404).json({
      error: "Quiz not found",
      message: `No quiz found with ID: ${id}`,
    });
  }

  res.json(result);
});
