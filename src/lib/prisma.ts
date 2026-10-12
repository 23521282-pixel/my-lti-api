import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Shared Prisma Client.
 *
 * The generator writes to `src/generated/prisma` (see `prisma/schema.prisma`),
 * so the client must be imported from there. Importing `@prisma/client` would
 * fail with "did not initialize yet" because nothing is generated into that
 * package's default location.
 */
export const prisma = new PrismaClient();

/** Releases pooled connections. Used by tests and graceful shutdown. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
