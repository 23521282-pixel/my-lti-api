import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";

// The generated client lives in `src/generated/prisma` (see prisma/schema.prisma),
// not in the default `@prisma/client` location.
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw<
    { current_database: string; current_user: string }[]
  >`
    SELECT current_database(), current_user
  `;

  console.log("Database connection successful!");
  console.log(result);
}

main()
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
