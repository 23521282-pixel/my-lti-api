import type { AttemptStatus, QuestionType } from "../generated/prisma/enums.js";

export type { AttemptStatus, QuestionType };

/**
 * A single selectable answer choice. `id` is what gets submitted and stored.
 *
 * Declared as a type alias (not an interface) so it stays assignable to
 * Prisma's `InputJsonValue` for the `options` JSON column without a cast.
 */
export type QuestionOption = {
  id: string;
  text: string;
};

export interface QuestionBankDto {
  id: string;
  name: string;
  description: string | null;
  questionCount: number;
  quizCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Authoring view of a question. Includes `correctAnswer` and `explanation`
 * because only instructors/administrators can reach these endpoints.
 */
export interface QuestionDto {
  id: string;
  questionBankId: string;
  text: string;
  type: QuestionType;
  options: QuestionOption[];
  correctAnswer: string;
  explanation: string | null;
  points: number;
  createdAt: string;
  updatedAt: string;
}

/** Question as shown to a quiz taker: no answer key, no explanation. */
export interface PublicQuestionDto {
  id: string;
  text: string;
  type: QuestionType;
  options: QuestionOption[];
  points: number;
}

export interface QuizDto {
  id: string;
  title: string;
  description: string | null;
  questionBankId: string;
  questionBankName: string;
  questionCount: number;
  availableQuestionCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One question inside an attempt, without any answer key information. */
export interface AttemptQuestionDto {
  attemptQuestionId: string;
  questionId: string | null;
  order: number;
  questionText: string;
  type: QuestionType;
  options: QuestionOption[];
  maxPoints: number;
  selectedAnswer: string | null;
}

/** Attempt state returned while a quiz is in progress (never contains answers). */
export interface AttemptDto {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  status: AttemptStatus;
  score: number;
  maxScore: number;
  percentage: number;
  startedAt: string;
  submittedAt: string | null;
  questions: AttemptQuestionDto[];
}

/** Score-only view used by submit responses and attempt listings. */
export interface AttemptSummaryDto {
  attemptId: string;
  quizId: string;
  status: AttemptStatus;
  score: number;
  maxScore: number;
  percentage: number;
  startedAt: string;
  submittedAt: string | null;
}

/** One graded question in the post-submission review. */
export interface AttemptReviewQuestionDto extends AttemptQuestionDto {
  correctAnswer: string;
  isCorrect: boolean;
  pointsEarned: number;
  explanation: string | null;
}

export interface AttemptReviewDto {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  status: AttemptStatus;
  score: number;
  maxScore: number;
  percentage: number;
  startedAt: string;
  submittedAt: string | null;
  questions: AttemptReviewQuestionDto[];
}

/** Identity of the authenticated user, derived from the verified LTI session. */
export interface AuthenticatedUser {
  id: string;
  issuer: string;
  name?: string;
  email?: string;
  roles: string[];
  isInstructor: boolean;
  isAdmin: boolean;
  isStudent: boolean;
}
