import { badRequest } from "../lib/errors.js";
import type { QuestionOption, QuestionType } from "../types/quiz.js";

/** True/false questions always expose the same two fixed choices. */
export const TRUE_FALSE_OPTIONS: QuestionOption[] = [
  { id: "true", text: "True" },
  { id: "false", text: "False" },
];

export interface ResolvedQuestionContent {
  text: string;
  type: QuestionType;
  options: QuestionOption[];
  correctAnswer: string;
  explanation: string | null;
  points: number;
}

interface QuestionContentInput {
  text?: string;
  type?: QuestionType;
  options?: QuestionOption[];
  correctAnswer?: string;
  explanation?: string | null;
  points?: number;
}

/**
 * Applies type-specific rules to a question payload, merging it over the
 * existing row for updates. This is the single place that decides what a valid
 * question looks like, so create and update cannot drift apart:
 *
 * - SINGLE_CHOICE needs at least two options with unique ids, and the correct
 *   answer must reference one of them.
 * - TRUE_FALSE uses the fixed True/False options and a boolean answer.
 */
export function resolveQuestionContent(
  input: QuestionContentInput,
  existing?: {
    text: string;
    type: QuestionType;
    options: QuestionOption[];
    correctAnswer: string;
    explanation: string | null;
    points: number;
  }
): ResolvedQuestionContent {
  const type = input.type ?? existing?.type;
  if (!type) {
    throw badRequest("A question type is required.");
  }

  const text = input.text ?? existing?.text;
  if (!text) {
    throw badRequest("Question text is required.");
  }

  const points = input.points ?? existing?.points ?? 1;
  const explanation =
    input.explanation === undefined
      ? existing?.explanation ?? null
      : input.explanation;

  if (type === "TRUE_FALSE") {
    const raw = (input.correctAnswer ?? existing?.correctAnswer ?? "")
      .trim()
      .toLowerCase();
    if (raw !== "true" && raw !== "false") {
      throw badRequest(
        'For TRUE_FALSE questions, correctAnswer must be "true" or "false".'
      );
    }
    return {
      text,
      type,
      options: TRUE_FALSE_OPTIONS,
      correctAnswer: raw,
      explanation,
      points,
    };
  }

  const options = input.options ?? existing?.options;
  if (!options || options.length < 2) {
    throw badRequest(
      "SINGLE_CHOICE questions require at least two options."
    );
  }

  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.id)) {
      throw badRequest(`Duplicate option id "${option.id}".`);
    }
    seen.add(option.id);
  }

  const rawCorrect = (input.correctAnswer ?? existing?.correctAnswer ?? "").trim();
  const match =
    options.find((option) => option.id === rawCorrect) ??
    options.find(
      (option) => option.id.toLowerCase() === rawCorrect.toLowerCase()
    );

  if (!match) {
    throw badRequest(
      `correctAnswer "${rawCorrect}" does not match any option id (${options
        .map((option) => option.id)
        .join(", ")}).`
    );
  }

  return {
    text,
    type,
    options,
    correctAnswer: match.id,
    explanation,
    points,
  };
}
