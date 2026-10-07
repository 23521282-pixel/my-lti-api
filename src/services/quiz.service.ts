import { MOCK_QUIZZES } from "../data/quizzes.js";
import type {
  PublicQuiz,
  QuizAnswer,
  QuizResult,
  QuizSummary,
} from "../types/quiz.js";

/**
 * Returns a list of available quizzes with safe metadata (no questions or answers).
 */
export function getAllQuizzes(): QuizSummary[] {
  return MOCK_QUIZZES.map(({ id, title, description }) => ({
    id,
    title,
    description,
  }));
}

/**
 * Returns a specific quiz including questions and options.
 * CRITICAL: Strips `correctAnswer` so it is NEVER exposed to the client.
 */
export function getQuizById(id: string): PublicQuiz | null {
  const quiz = MOCK_QUIZZES.find((q) => q.id === id);
  if (!quiz) {
    return null;
  }

  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    questions: quiz.questions.map(({ id: qId, question, options }) => ({
      id: qId,
      question,
      options,
    })),
  };
}

/**
 * Evaluates submitted answers against the mock quiz and calculates score.
 */
export function evaluateQuizSubmission(
  quizId: string,
  answers: QuizAnswer[]
): QuizResult | null {
  const quiz = MOCK_QUIZZES.find((q) => q.id === quizId);
  if (!quiz) {
    return null;
  }

  const answerMap = new Map<string, string>();
  for (const item of answers) {
    if (
      item &&
      typeof item.questionId === "string" &&
      typeof item.answer === "string"
    ) {
      answerMap.set(item.questionId, item.answer.trim().toUpperCase());
    }
  }

  let score = 0;
  const maxScore = quiz.questions.length;

  for (const q of quiz.questions) {
    const userAns = answerMap.get(q.id);
    const correct = q.correctAnswer.trim().toUpperCase();

    if (
      userAns &&
      (userAns === correct ||
        userAns.startsWith(correct + ".") ||
        userAns.startsWith(correct + ":") ||
        userAns.startsWith(correct + " "))
    ) {
      score++;
    }
  }

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const passed = percentage >= 50;

  return {
    quizId: quiz.id,
    score,
    maxScore,
    percentage,
    passed,
  };
}
