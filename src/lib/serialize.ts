import type { Prisma } from "../generated/prisma/client.js";
import type { QuestionOption } from "../types/quiz.js";
import { z } from "zod";

/** Permissive shape check for options read back out of the database. */
const storedOptionsSchema = z.array(
  z.object({ id: z.string(), text: z.string() })
);

/** Converts a Prisma Decimal column into a JSON-friendly number. */
export function decimalToNumber(
  value: Prisma.Decimal | number | null | undefined
): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

/**
 * Reads the `options` JSON column back into typed options. Rows are written
 * through validated schemas, so a malformed shape here means data corruption
 * rather than bad input; we fail loudly instead of returning junk.
 */
export function parseOptions(raw: Prisma.JsonValue): QuestionOption[] {
  const result = storedOptionsSchema.safeParse(raw);
  if (!result.success) {
    throw new Error("Stored question options are malformed.");
  }
  return result.data;
}

/** Rounds a percentage to two decimals for display and storage. */
export function percentageOf(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((score / maxScore) * 10000) / 100;
}
