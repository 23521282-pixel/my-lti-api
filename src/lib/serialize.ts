import type { Prisma } from "../generated/prisma/client.js";
import type { QuestionOption } from "../types/quiz.js";

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
export function parseOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) {
    throw new Error("Stored question options are not an array.");
  }

  return raw.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as QuestionOption).id !== "string" ||
      typeof (entry as QuestionOption).text !== "string"
    ) {
      throw new Error(`Stored question option at index ${index} is malformed.`);
    }
    const option = entry as QuestionOption;
    return { id: option.id, text: option.text };
  });
}

/** Rounds a percentage to two decimals for display and storage. */
export function percentageOf(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((score / maxScore) * 10000) / 100;
}
