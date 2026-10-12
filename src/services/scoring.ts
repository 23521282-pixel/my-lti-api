import { Prisma } from "../generated/prisma/client.js";
import { badRequest } from "../lib/errors.js";
import type { QuestionOption, QuestionType } from "../types/quiz.js";

/**
 * Validates a client-supplied answer against the question it belongs to and
 * returns the canonical stored form, or null when the question was left blank.
 */
export function normalizeSelectedAnswer(
  raw: string | null | undefined,
  options: QuestionOption[],
  type: QuestionType
): string | null {
  if (raw === null || raw === undefined) return null;

  const value = raw.trim();
  if (value === "") return null;

  if (type === "TRUE_FALSE") {
    const lower = value.toLowerCase();
    if (lower !== "true" && lower !== "false") {
      throw badRequest('TRUE_FALSE answers must be "true" or "false".');
    }
    return lower;
  }

  const exact = options.find((option) => option.id === value);
  if (exact) return exact.id;

  const insensitive = options.find(
    (option) => option.id.toLowerCase() === value.toLowerCase()
  );
  if (insensitive) return insensitive.id;

  throw badRequest(
    `selectedAnswer "${value}" is not a valid option (${options
      .map((option) => option.id)
      .join(", ")}).`
  );
}

/** Compares a stored answer against the stored key for the question type. */
export function isAnswerCorrect(
  selected: string | null | undefined,
  correctAnswer: string,
  type: QuestionType
): boolean {
  if (selected === null || selected === undefined || selected === "") {
    return false;
  }
  if (type === "TRUE_FALSE") {
    return selected.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
  }
  return selected.trim() === correctAnswer.trim();
}

/**
 * Sums earned and available points using Decimal arithmetic so fractional
 * points never accumulate floating-point error.
 */
export function scoreQuestions(
  graded: { points: Prisma.Decimal; earned: Prisma.Decimal }[]
): { score: Prisma.Decimal; maxScore: Prisma.Decimal } {
  let score = new Prisma.Decimal(0);
  let maxScore = new Prisma.Decimal(0);

  for (const item of graded) {
    score = score.plus(item.earned);
    maxScore = maxScore.plus(item.points);
  }

  return { score, maxScore };
}
