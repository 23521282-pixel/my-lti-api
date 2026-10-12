import "dotenv/config";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration-test harness.
 *
 * Runs the real Express app (from `dist`) against a dedicated PostgreSQL test
 * database, and authenticates by creating genuine LTI sessions through the same
 * `LTITool` instance the app uses. Nothing here stubs authentication, so the
 * authorization rules under test are the production ones.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

const DEFAULT_TEST_DATABASE = "lti_quiz_test";

/** Cohota client registered in `src/lti/tool.ts`. */
const LTI_CLIENT_ID = "1060000000000004";
const LTI_ISSUER = "https://sso.cohota.com";
const LTI_DEPLOYMENT_ID = "5:5RKoVsSrxjSi1JYFiu8V6Es9Jnw7PB1ASSxWtyP3";

export const ROLES = {
  LEARNER: "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
  INSTRUCTOR: "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
  ADMIN: "http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator",
};

export function makeUser(id, roles, name = id) {
  return { id, roles, name, email: `${id}@example.com` };
}

/* ------------------------------------------------------- database plumbing
 */

function databaseNameOf(url) {
  return new URL(url).pathname.replace(/^\//, "");
}

function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Test data must never land in the development database, so the test database
 * name has to end in `_test`. Checked before anything is read or written.
 */
function assertSafeTestDatabase(url) {
  const name = databaseNameOf(url);
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against database "${name}": the name must end with "_test".`
    );
  }
  return name;
}

function isMissingDatabaseError(error) {
  return (
    error?.code === "P1003" ||
    /does not exist/i.test(String(error?.message ?? ""))
  );
}

async function ensureDatabaseExists(PrismaClient, testUrl) {
  const probe = new PrismaClient({ datasourceUrl: testUrl });
  try {
    await probe.$queryRawUnsafe("SELECT 1");
    return;
  } catch (error) {
    if (!isMissingDatabaseError(error)) throw error;
  } finally {
    await probe.$disconnect();
  }

  const name = assertSafeTestDatabase(testUrl);
  const admin = new PrismaClient({
    datasourceUrl: withDatabase(testUrl, "postgres"),
  });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
}

/** Applies prisma/migrations to the test database. */
function runMigrations(testUrl) {
  const prismaCli = path.join(
    projectRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js"
  );
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });
}

/** Empties only the test database; the name guard above keeps it scoped. */
export async function resetTestDatabase(prisma) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AttemptAnswer", "AttemptQuestion", "QuizAttempt", "Quiz", "Question", "QuestionBank" RESTART IDENTITY CASCADE'
  );
}

/* ------------------------------------------------------------------ server
 */

export async function startTestServer() {
  const testUrl =
    process.env.TEST_DATABASE_URL ||
    withDatabase(process.env.DATABASE_URL, DEFAULT_TEST_DATABASE);
  assertSafeTestDatabase(testUrl);

  const { PrismaClient } = await import(
    "../../dist/generated/prisma/client.js"
  );
  await ensureDatabaseExists(PrismaClient, testUrl);
  runMigrations(testUrl);

  // Set before importing the app. dotenv never overwrites existing values, so
  // the app's Prisma client binds to the test database.
  process.env.DATABASE_URL = testUrl;
  process.env.LTI_STATE_SECRET ??= "test-state-secret-0123456789abcdefghijkl";
  process.env.TOOL_URL ??= "http://localhost:3000";

  const [{ createApp }, { ltiTool }, { prisma }] = await Promise.all([
    import("../../dist/app.js"),
    import("../../dist/lti/tool.js"),
    import("../../dist/lib/prisma.js"),
  ]);

  await resetTestDatabase(prisma);

  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const cookieCache = new Map();

  /** Creates a real LTI session for `user` and returns its session cookie. */
  async function sessionCookie(user) {
    if (cookieCache.has(user.id)) return cookieCache.get(user.id);

    const session = await ltiTool.createSession({
      iss: LTI_ISSUER,
      aud: LTI_CLIENT_ID,
      sub: user.id,
      name: user.name,
      email: user.email,
      given_name: user.name,
      family_name: "Test",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
        LTI_DEPLOYMENT_ID,
      "https://purl.imsglobal.org/spec/lti/claim/target_link_uri":
        "https://my-lti-api.onrender.com/lti/launch",
      "https://purl.imsglobal.org/spec/lti/claim/roles": user.roles,
      "https://purl.imsglobal.org/spec/lti/claim/context": {
        id: "course-101",
        label: "CS101",
        title: "Introduction to Computer Science",
      },
    });

    const cookie = `lti_session=${session.id}`;
    cookieCache.set(user.id, cookie);
    return cookie;
  }

  async function request(method, endpoint, { user, body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };

    if (user) {
      init.headers.Cookie = await sessionCookie(user);
    }
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}${endpoint}`, init);
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    return { status: response.status, body: parsed, text };
  }

  return {
    baseUrl,
    prisma,
    ltiTool,
    sessionCookie,
    http: {
      get: (endpoint, options) => request("GET", endpoint, options),
      post: (endpoint, options) => request("POST", endpoint, options),
      patch: (endpoint, options) => request("PATCH", endpoint, options),
      put: (endpoint, options) => request("PUT", endpoint, options),
      delete: (endpoint, options) => request("DELETE", endpoint, options),
    },
    async close() {
      server.close();
      await once(server, "close");
      await prisma.$disconnect();
    },
  };
}
