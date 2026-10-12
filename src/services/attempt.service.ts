import { randomInt } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  decimalToNumber,
  parseOptions,
  percentageOf,
} from "../lib/serialize.js";
import { canAccessAttempt } from "../middleware/auth.js";
import type {
  AttemptDto,
  AttemptQuestionDto,
  AttemptReviewDto,
  AttemptSummaryDto,
  AuthenticatedUser,
  QuestionType,
} from "../types/quiz.js";
import type { AnswerItemInput } from "../validation/quiz.schemas.js";
import { isAnswerCorrect, normalizeSelectedAnswer, scoreQuestions } from "./scoring.js";

/**
 * Attempt lifecycle: starting a run, saving draft answers, submitting for
 * scoring, and reviewing results.
 *
 * Every attempt is created with a snapshot of the questions that were shown, so
 * editing or deleting the underlying question later cannot change a past result.
 * Repeated attempts are allowed and each one draws its own random selection.
 */

interface AttemptAnswerRow {
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  pointsEarned: Prisma.Decimal | null;
}

interface AttemptQuestionRow {
  id: string;
  questionId: string | null;
  order: number;
  questionText: string;
  type: QuestionType;
  options: unknown;
  correctAnswer: string;
  explanation: string | null;
  points: Prisma.Decimal;
  answer: AttemptAnswerRow | null;
}

interface AttemptRow {
  id: string;
  quizId: string;
  userId: string;
  status: "IN_PROGRESS" | "SUBMITTED";
  score: Prisma.Decimal;
  maxScore: Prisma.Decimal;
  startedAt: Date;
  submittedAt: Date | null;
  quiz: { id: string; title: string };
  questions: AttemptQuestionRow[];
}

const attemptInclude = {
  quiz: { select: { id: true, title: true } },
  questions: {
    orderBy: { order: "asc" },
    include: { answer: true },
  },
} as const;

/* ------------------------------------------------------------- serializing */

function toAttemptQuestionDto(row: AttemptQuestionRow): AttemptQuestionDto {
  return {
    attemptQuestionId: row.id,
    questionId: row.questionId,
    order: row.order,
    questionText: row.questionText,
    type: row.type,
    options: parseOptions(row.options),
    maxPoints: decimalToNumber(row.points),
    selectedAnswer: row.answer?.selectedAnswer ?? null,
  };
}

function toAttemptDto(row: AttemptRow): AttemptDto {
  const score = decimalToNumber(row.score);
  const maxScore = decimalToNumber(row.maxScore);

  return {
    attemptId: row.id,
    quizId: row.quizId,
    quizTitle: row.quiz.title,
    status: row.status,
    score,
    maxScore,
    // An in-progress attempt has no result yet, only the available total.
    percentage: row.status === "SUBMITTED" ? percentageOf(score, maxScore) : 0,
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    questions: row.questions.map(toAttemptQuestionDto),
  };
}

function toSummaryDto(row: AttemptRow): AttemptSummaryDto {
  const score = decimalToNumber(row.score);
  const maxScore = decimalToNumber(row.maxScore);

  return {
    attemptId: row.id,
    quizId: row.quizId,
    status: row.status,
    score,
    maxScore,
    percentage: row.status === "SUBMITTED" ? percentageOf(score, maxScore) : 0,
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
  };
}

function toReviewDto(row: AttemptRow): AttemptReviewDto {
  const summary = toSummaryDto(row);

  return {
    ...summary,
    quizTitle: row.quiz.title,
    questions: row.questions.map((question) => ({
      ...toAttemptQuestionDto(question),
      correctAnswer: question.correctAnswer,
      isCorrect: question.answer?.isCorrect ?? false,
      pointsEarned: decimalToNumber(question.answer?.pointsEarned),
      explanation: question.explanation,
    })),
  };
}

/* ---------------------------------------------------------------- helpers */

/** Fisher-Yates shuffle using a CSPRNG, so selection cannot be predicted. */
function pickRandom<T>(pool: readonly T[], count: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/**
 * Loads an attempt and enforces ownership. Non-owners get 404 (not 403) so the
 * API never confirms that another user's attempt ID exists.
 */
async function loadAccessibleAttempt(
  attemptId: string,
  user: AuthenticatedUser
): Promise<AttemptRow> {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: attemptInclude,
  });

  if (!attempt || !canAccessAttempt(user, attempt.userId)) {
    throw notFound(`No attempt found with ID: ${attemptId}`);
  }

  return attempt;
}

/**
 * Validates submitted answer items against the questions actually shown in the
 * attempt, returning canonical `{ attemptQuestionId, selectedAnswer }` pairs.
 */
function resolveAnswerItems(
  questions: AttemptQuestionRow[],
  items: AnswerItemInput[]
): { attemptQuestionId: string; selectedAnswer: string | null }[] {
  const byAttemptQuestionId = new Map(questions.map((q) => [q.id, q]));
  const byQuestionId = new Map<string, AttemptQuestionRow>();
  for (const question of questions) {
    if (question.questionId) {
      byQuestionId.set(question.questionId, question);
    }
  }

  const resolved: { attemptQuestionId: string; selectedAnswer: string | null }[] =
    [];
  const seen = new Set<string>();

  for (const item of items) {
    const target =
      item.attemptQuestionId !== undefined
        ? byAttemptQuestionId.get(item.attemptQuestionId)
        : byQuestionId.get(item.questionId ?? "");

    if (!target) {
      throw badRequest(
        "An answer references a question that is not part of this attempt."
      );
    }
    if (seen.has(target.id)) {
      throw badRequest("Each question may only be answered once.");
    }
    seen.add(target.id);

    resolved.push({
      attemptQuestionId: target.id,
      selectedAnswer: normalizeSelectedAnswer(
        item.selectedAnswer,
        parseOptions(target.options),
        target.type
      ),
    });
  }

  return resolved;
}

/* ------------------------------------------------------------ public API */

/**
 * Starts a new attempt: picks `quiz.questionCount` distinct random questions
 * from the quiz's bank and snapshots them in the order they will be shown.
 */
export async function startAttempt(
  quizId: string,
  user: AuthenticatedUser
): Promise<AttemptDto> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { bank: { select: { name: true } } },
  });
  if (!quiz) {
    throw notFound(`No quiz found with ID: ${quizId}`);
  }

  const pool = await prisma.question.findMany({
    where: { questionBankId: quiz.questionBankId },
  });

  if (pool.length < quiz.questionCount) {
    throw badRequest(
      `Question bank "${quiz.bank.name}" has ${pool.length} question(s) but the quiz requires ${quiz.questionCount}, so an attempt cannot be generated.`
    );
  }

  const selected = pickRandom(pool, quiz.questionCount);

  let maxScore = new Prisma.Decimal(0);
  for (const question of selected) {
    maxScore = maxScore.plus(question.points);
  }

  const attemptId = await prisma.$transaction(async (tx) => {
    const attempt = await tx.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: user.id,
        userIssuer: user.issuer,
        maxScore,
      },
    });

    await tx.attemptQuestion.createMany({
      data: selected.map((question, index) => ({
        attemptId: attempt.id,
        questionId: question.id,
        order: index,
        questionText: question.text,
        type: question.type,
        options: question.options as unknown as Prisma.InputJsonValue,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        points: question.points,
      })),
    });

    return attempt.id;
  });

  return getAttempt(attemptId, user);
}

/** Returns an attempt with its questions. Never includes answer keys. */
export async function getAttempt(
  attemptId: string,
  user: AuthenticatedUser
): Promise<AttemptDto> {
  const attempt = await loadAccessibleAttempt(attemptId, user);
  return toAttemptDto(attempt);
}

/**
 * Saves or replaces draft answers. The in-progress check happens inside a
 * transaction so an answer cannot be written after the attempt is submitted.
 */
export async function saveAnswers(
  attemptId: string,
  user: AuthenticatedUser,
  items: AnswerItemInput[]
): Promise<AttemptDto> {
  const attempt = await loadAccessibleAttempt(attemptId, user);
  if (attempt.status !== "IN_PROGRESS") {
    throw conflict(
      "This attempt has already been submitted; answers can no longer be changed."
    );
  }

  const updates = resolveAnswerItems(attempt.questions, items);

  await prisma.$transaction(async (tx) => {
    const current = await tx.quizAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true },
    });
    if (!current || current.status !== "IN_PROGRESS") {
      throw conflict(
        "This attempt has already been submitted; answers can no longer be changed."
      );
    }

    for (const update of updates) {
      await tx.attemptAnswer.upsert({
        where: { attemptQuestionId: update.attemptQuestionId },
        create: {
          attemptQuestionId: update.attemptQuestionId,
          selectedAnswer: update.selectedAnswer,
        },
        update: { selectedAnswer: update.selectedAnswer },
      });
    }
  });

  return getAttempt(attemptId, user);
}

/**
 * Grades and finalises an attempt. Scoring always runs on the persisted answer
 * keys from the attempt snapshot, never on client-supplied values.
 *
 * Concurrency: the final state change is a status-guarded `updateMany`, so two
 * simultaneous submissions resolve to exactly one success and one 409 conflict.
 */
export async function submitAttempt(
  attemptId: string,
  user: AuthenticatedUser,
  items: AnswerItemInput[] = []
): Promise<AttemptSummaryDto> {
  const existing = await loadAccessibleAttempt(attemptId, user);
  if (existing.status === "SUBMITTED") {
    throw conflict("This attempt has already been submitted.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.quizAttempt.findUnique({
      where: { id: attemptId },
      include: attemptInclude,
    });
    if (!current || !canAccessAttempt(user, current.userId)) {
      throw notFound(`No attempt found with ID: ${attemptId}`);
    }
    if (current.status !== "IN_PROGRESS") {
      throw conflict("This attempt has already been submitted.");
    }

    // Answers sent with the submission override anything saved earlier.
    const applied = new Map<string, string | null>();
    for (const update of resolveAnswerItems(current.questions, items)) {
      applied.set(update.attemptQuestionId, update.selectedAnswer);
    }

    const now = new Date();
    const graded: { points: Prisma.Decimal; earned: Prisma.Decimal }[] = [];

    for (const question of current.questions) {
      const selectedAnswer = applied.has(question.id)
        ? applied.get(question.id) ?? null
        : question.answer?.selectedAnswer ?? null;

      const isCorrect = isAnswerCorrect(
        selectedAnswer,
        question.correctAnswer,
        question.type
      );
      const earned = isCorrect ? question.points : new Prisma.Decimal(0);
      graded.push({ points: question.points, earned });

      await tx.attemptAnswer.upsert({
        where: { attemptQuestionId: question.id },
        create: {
          attemptQuestionId: question.id,
          selectedAnswer,
          isCorrect,
          pointsEarned: earned,
          submittedAt: now,
        },
        update: {
          selectedAnswer,
          isCorrect,
          pointsEarned: earned,
          submittedAt: now,
        },
      });
    }

    const { score, maxScore } = scoreQuestions(graded);

    const finalised = await tx.quizAttempt.updateMany({
      where: { id: attemptId, status: "IN_PROGRESS" },
      data: { status: "SUBMITTED", score, maxScore, submittedAt: now },
    });
    if (finalised.count !== 1) {
      throw conflict("This attempt has already been submitted.");
    }

    return { score, maxScore, submittedAt: now };
  });

  const score = decimalToNumber(result.score);
  const maxScore = decimalToNumber(result.maxScore);

  return {
    attemptId,
    quizId: existing.quizId,
    status: "SUBMITTED",
    score,
    maxScore,
    percentage: percentageOf(score, maxScore),
    startedAt: existing.startedAt.toISOString(),
    submittedAt: result.submittedAt.toISOString(),
  };
}

/** Full review with answer keys. Only available once an attempt is submitted. */
export async function reviewAttempt(
  attemptId: string,
  user: AuthenticatedUser
): Promise<AttemptReviewDto> {
  const attempt = await loadAccessibleAttempt(attemptId, user);
  if (attempt.status !== "SUBMITTED") {
    throw conflict(
      "Review is only available after the attempt has been submitted."
    );
  }
  return toReviewDto(attempt);
}

/** The caller's own attempts for a quiz, newest first. */
export async function listMyAttempts(
  quizId: string,
  user: AuthenticatedUser
): Promise<AttemptSummaryDto[]> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { id: true },
  });
  if (!quiz) {
    throw notFound(`No quiz found with ID: ${quizId}`);
  }

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId, userId: user.id },
    include: attemptInclude,
    orderBy: { startedAt: "desc" },
  });

  return attempts.map(toSummaryDto);
}
