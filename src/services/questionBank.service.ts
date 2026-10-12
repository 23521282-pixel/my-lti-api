import { Prisma } from "../generated/prisma/client.js";
import { conflict, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { decimalToNumber, parseOptions } from "../lib/serialize.js";
import type {
  QuestionBankDto,
  QuestionDto,
  QuestionOption,
  QuestionType,
} from "../types/quiz.js";
import type {
  CreateQuestionBankInput,
  CreateQuestionInput,
  UpdateQuestionBankInput,
  UpdateQuestionInput,
} from "../validation/quiz.schemas.js";
import { resolveQuestionContent } from "./question.rules.js";

/**
 * Question bank and question management. These endpoints are instructor-only
 * (enforced by `requireInstructor` at the router) because the responses include
 * answer keys.
 */

interface QuestionBankRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { questions: number; quizzes: number };
}

interface QuestionRow {
  id: string;
  questionBankId: string;
  text: string;
  type: QuestionType;
  options: unknown;
  correctAnswer: string;
  explanation: string | null;
  points: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
}

const bankInclude = {
  _count: { select: { questions: true, quizzes: true } },
} as const;

function toBankDto(row: QuestionBankRow): QuestionBankDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    questionCount: row._count?.questions ?? 0,
    ...(row._count ? { quizCount: row._count.quizzes } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toQuestionDto(row: QuestionRow): QuestionDto {
  return {
    id: row.id,
    questionBankId: row.questionBankId,
    text: row.text,
    type: row.type,
    options: parseOptions(row.options),
    correctAnswer: row.correctAnswer,
    explanation: row.explanation,
    points: decimalToNumber(row.points),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Existing row reduced to the shape `resolveQuestionContent` merges over. */
function toExistingContent(row: QuestionRow) {
  return {
    text: row.text,
    type: row.type,
    options: parseOptions(row.options) as QuestionOption[],
    correctAnswer: row.correctAnswer,
    explanation: row.explanation,
    points: decimalToNumber(row.points),
  };
}

/* ------------------------------------------------------------------ banks */

export async function listQuestionBanks(): Promise<QuestionBankDto[]> {
  const banks = await prisma.questionBank.findMany({
    include: bankInclude,
    orderBy: { createdAt: "asc" },
  });
  return banks.map(toBankDto);
}

export async function getQuestionBank(id: string): Promise<QuestionBankDto> {
  const bank = await prisma.questionBank.findUnique({
    where: { id },
    include: bankInclude,
  });
  if (!bank) {
    throw notFound(`No question bank found with ID: ${id}`);
  }
  return toBankDto(bank);
}

export async function createQuestionBank(
  input: CreateQuestionBankInput
): Promise<QuestionBankDto> {
  const bank = await prisma.questionBank.create({
    data: {
      name: input.name,
      description: input.description ?? null,
    },
    include: bankInclude,
  });
  return toBankDto(bank);
}

export async function updateQuestionBank(
  id: string,
  input: UpdateQuestionBankInput
): Promise<QuestionBankDto> {
  await getQuestionBank(id);

  const bank = await prisma.questionBank.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description ?? null }),
    },
    include: bankInclude,
  });
  return toBankDto(bank);
}

/**
 * Deletes a bank only when no quiz still references it. Questions are removed
 * with the bank (cascade), while attempts keep working because each attempt
 * stores its own snapshot of the questions that were shown.
 */
export async function deleteQuestionBank(id: string): Promise<void> {
  const bank = await prisma.questionBank.findUnique({
    where: { id },
    include: bankInclude,
  });
  if (!bank) {
    throw notFound(`No question bank found with ID: ${id}`);
  }

  const quizCount = bank._count?.quizzes ?? 0;
  if (quizCount > 0) {
    throw conflict(
      `Question bank "${bank.name}" is used by ${quizCount} quiz(zes) and cannot be deleted.`
    );
  }

  await prisma.questionBank.delete({ where: { id } });
}

/* -------------------------------------------------------------- questions */

async function assertBankExists(bankId: string): Promise<void> {
  const bank = await prisma.questionBank.findUnique({
    where: { id: bankId },
    select: { id: true },
  });
  if (!bank) {
    throw notFound(`No question bank found with ID: ${bankId}`);
  }
}

export async function listQuestions(bankId: string): Promise<QuestionDto[]> {
  await assertBankExists(bankId);

  const questions = await prisma.question.findMany({
    where: { questionBankId: bankId },
    orderBy: { createdAt: "asc" },
  });
  return questions.map(toQuestionDto);
}

export async function getQuestion(id: string): Promise<QuestionDto> {
  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) {
    throw notFound(`No question found with ID: ${id}`);
  }
  return toQuestionDto(question);
}

export async function createQuestion(
  bankId: string,
  input: CreateQuestionInput
): Promise<QuestionDto> {
  await assertBankExists(bankId);

  const content = resolveQuestionContent(input);

  const question = await prisma.question.create({
    data: {
      questionBankId: bankId,
      text: content.text,
      type: content.type,
      options: content.options as unknown as Prisma.InputJsonValue,
      correctAnswer: content.correctAnswer,
      explanation: content.explanation,
      points: new Prisma.Decimal(content.points),
    },
  });
  return toQuestionDto(question);
}

export async function updateQuestion(
  id: string,
  input: UpdateQuestionInput
): Promise<QuestionDto> {
  const existing = await prisma.question.findUnique({ where: { id } });
  if (!existing) {
    throw notFound(`No question found with ID: ${id}`);
  }

  const content = resolveQuestionContent(input, toExistingContent(existing));

  const question = await prisma.question.update({
    where: { id },
    data: {
      text: content.text,
      type: content.type,
      options: content.options as unknown as Prisma.InputJsonValue,
      correctAnswer: content.correctAnswer,
      explanation: content.explanation,
      points: new Prisma.Decimal(content.points),
    },
  });
  return toQuestionDto(question);
}

/**
 * Deleting a question is safe even for questions already used in attempts:
 * the attempt keeps its own snapshot, and the link from the attempt back to
 * the (now deleted) question is cleared rather than cascading.
 */
export async function deleteQuestion(id: string): Promise<void> {
  const existing = await prisma.question.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    throw notFound(`No question found with ID: ${id}`);
  }

  await prisma.question.delete({ where: { id } });
}
