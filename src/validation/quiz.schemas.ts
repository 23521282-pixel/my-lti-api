import { z } from "zod";
import { badRequest } from "../lib/errors.js";

/**
 * Request validation schemas. Bodies are parsed with `parseOrThrow` so unknown
 * keys are stripped (no mass assignment) and failures produce a 400 with a
 * per-field breakdown.
 */

const id = z.string().min(1).max(64);

export const idParamSchema = z.object({ id });
export const bankIdParamSchema = z.object({ bankId: id });

export const createQuestionBankSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
});

export const updateQuestionBankSchema = createQuestionBankSchema.partial();

export const optionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(2000),
});

/**
 * Points must be positive and cannot carry sub-cent precision, since the
 * scoring columns are DECIMAL(8,2).
 */
const pointsSchema = z
  .number()
  .finite()
  .positive("points must be greater than zero")
  .max(1000, "points must not exceed 1000")
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    { message: "points may have at most 2 decimal places" }
  );

export const createQuestionSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  type: z.enum(["SINGLE_CHOICE", "TRUE_FALSE"]),
  options: z.array(optionSchema).max(26).optional(),
  correctAnswer: z.string().trim().min(1).max(200),
  explanation: z.string().trim().max(5000).nullish(),
  points: pointsSchema.optional(),
});

export const updateQuestionSchema = createQuestionSchema.partial();

export const createQuizSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  questionBankId: id,
  questionCount: z
    .number()
    .int("questionCount must be a whole number")
    .positive("questionCount must be greater than zero")
    .max(500),
});

export const updateQuizSchema = createQuizSchema.partial();

/**
 * An answer may reference the attempt question either by `attemptQuestionId` or
 * by the original `questionId`; both resolve to the same attempt row.
 */
export const answerItemSchema = z
  .object({
    attemptQuestionId: id.optional(),
    questionId: id.optional(),
    selectedAnswer: z.string().trim().max(200).nullable(),
  })
  .refine(
    (value) =>
      value.attemptQuestionId !== undefined || value.questionId !== undefined,
    { message: "each answer needs an attemptQuestionId or questionId" }
  );

export const saveAnswersSchema = z.object({
  answers: z.array(answerItemSchema).min(1).max(500),
});

export const submitAttemptSchema = z.object({
  answers: z.array(answerItemSchema).max(500).optional(),
});

export type CreateQuestionBankInput = z.infer<typeof createQuestionBankSchema>;
export type UpdateQuestionBankInput = z.infer<typeof updateQuestionBankSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type UpdateQuizInput = z.infer<typeof updateQuizSchema>;
export type AnswerItemInput = z.infer<typeof answerItemSchema>;
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;

/** Parses `data` with `schema`, converting failures into a 400 HttpError. */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  data: unknown
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest("Invalid request.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
