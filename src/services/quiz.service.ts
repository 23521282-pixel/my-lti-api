import { conflict, notFound, badRequest } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { QuizDto } from "../types/quiz.js";
import type {
  CreateQuizInput,
  UpdateQuizInput,
} from "../validation/quiz.schemas.js";

/**
 * Quiz definitions: a title/description, the bank to draw from, and how many
 * questions each attempt should present.
 */

interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  questionBankId: string;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;
  bank: { name: string; _count?: { questions: number } };
}

const quizInclude = {
  bank: { select: { name: true, _count: { select: { questions: true } } } },
} as const;

function toQuizDto(row: QuizRow): QuizDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    questionBankId: row.questionBankId,
    questionBankName: row.bank.name,
    questionCount: row.questionCount,
    availableQuestionCount: row.bank._count?.questions ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A quiz can only be saved when its bank holds enough questions; otherwise
 * attempts would silently come out incomplete.
 */
async function assertBankHasEnoughQuestions(
  bankId: string,
  questionCount: number
): Promise<void> {
  const bank = await prisma.questionBank.findUnique({
    where: { id: bankId },
    select: { name: true, _count: { select: { questions: true } } },
  });
  if (!bank) {
    throw notFound(`No question bank found with ID: ${bankId}`);
  }

  const available = bank._count.questions;
  if (available < questionCount) {
    throw badRequest(
      `Question bank "${bank.name}" has ${available} question(s) but the quiz requests ${questionCount}.`
    );
  }
}

export async function listQuizzes(): Promise<QuizDto[]> {
  const quizzes = await prisma.quiz.findMany({
    include: quizInclude,
    orderBy: { createdAt: "asc" },
  });
  return quizzes.map(toQuizDto);
}

export async function getQuiz(id: string): Promise<QuizDto> {
  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: quizInclude,
  });
  if (!quiz) {
    throw notFound(`No quiz found with ID: ${id}`);
  }
  return toQuizDto(quiz);
}

export async function createQuiz(input: CreateQuizInput): Promise<QuizDto> {
  await assertBankHasEnoughQuestions(input.questionBankId, input.questionCount);

  const quiz = await prisma.quiz.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      questionBankId: input.questionBankId,
      questionCount: input.questionCount,
    },
    include: quizInclude,
  });
  return toQuizDto(quiz);
}

export async function updateQuiz(
  id: string,
  input: UpdateQuizInput
): Promise<QuizDto> {
  const existing = await prisma.quiz.findUnique({ where: { id } });
  if (!existing) {
    throw notFound(`No quiz found with ID: ${id}`);
  }

  const questionBankId = input.questionBankId ?? existing.questionBankId;
  const questionCount = input.questionCount ?? existing.questionCount;
  await assertBankHasEnoughQuestions(questionBankId, questionCount);

  const quiz = await prisma.quiz.update({
    where: { id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined
        ? {}
        : { description: input.description ?? null }),
      questionBankId,
      questionCount,
    },
    include: quizInclude,
  });
  return toQuizDto(quiz);
}

/**
 * Quizzes that already have attempts are kept so results stay reviewable;
 * deleting one would cascade away its attempts and their history.
 */
export async function deleteQuiz(id: string): Promise<void> {
  const quiz = await prisma.quiz.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      _count: { select: { attempts: true } },
    },
  });
  if (!quiz) {
    throw notFound(`No quiz found with ID: ${id}`);
  }

  if (quiz._count.attempts > 0) {
    throw conflict(
      `Quiz "${quiz.title}" has ${quiz._count.attempts} attempt(s); delete is blocked to preserve attempt history.`
    );
  }

  await prisma.quiz.delete({ where: { id } });
}

