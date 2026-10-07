import express from "express";
import path from "node:path";
import { LTITool } from "@lti-tool/core";
import { MemoryStorage } from "@lti-tool/memory";
import { quizRouter } from "../dist/routes/quiz.routes.js";

async function main() {
  console.log("=== RUNNING QUIZ TOOL VERIFICATION TESTS ===");

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );

  const storage = new MemoryStorage();
  const stateSecret = new TextEncoder().encode("test-state-secret-12345678901234567890");

  const ltiTool = new LTITool({
    stateSecret,
    keyPair,
    storage,
  });

  const mockPayload = {
    iss: "https://sso.cohota.com",
    aud: "1060000000000004",
    sub: "user-cohota-123",
    name: "Quang Nguyen",
    email: "quang@example.com",
    given_name: "Quang",
    family_name: "Nguyen",
    exp: Math.floor(Date.now() / 1000) + 3600,
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "5:5RKoVsSrxjSi1JYFiu8V6Es9Jnw7PB1ASSxWtyP3",
    "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://my-lti-api.onrender.com/lti/launch",
    "https://purl.imsglobal.org/spec/lti/claim/roles": [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"
    ],
    "https://purl.imsglobal.org/spec/lti/claim/context": {
      id: "course-101",
      label: "CS101",
      title: "Introduction to Computer Science"
    }
  };

  function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    const pairs = cookieHeader.split(";");
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx !== -1) {
        const key = pair.substring(0, eqIdx).trim();
        const val = pair.substring(eqIdx + 1).trim();
        try {
          cookies[key] = decodeURIComponent(val);
        } catch {
          cookies[key] = val;
        }
      }
    }
    return cookies;
  }

  function getSessionCookieOptions(req) {
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    const secure = isHttps;
    const sameSite = secure ? "none" : "lax";
    return {
      httpOnly: true,
      secure,
      sameSite,
      path: "/",
    };
  }

  async function requireLtiSession(req, res, next) {
    try {
      const sessionId = req.cookies?.lti_session;
      if (!sessionId || typeof sessionId !== "string") {
        return res.status(401).json({ error: "Unauthorized", message: "Missing lti_session cookie" });
      }
      const session = await ltiTool.getSession(sessionId);
      if (!session) {
        return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired session" });
      }
      if (typeof session.jwtPayload.exp === "number" && Date.now() >= session.jwtPayload.exp * 1000) {
        return res.status(401).json({ error: "Unauthorized", message: "Session expired" });
      }
      req.ltiSession = session;
      next();
    } catch {
      return res.status(401).json({ error: "Unauthorized", message: "Session authentication failed" });
    }
  }

  const app = express();
  const publicDir = path.resolve(process.cwd(), "public");

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(publicDir, { index: false }));
  app.use((req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/", (req, res) => {
    if (req.headers.accept?.includes("text/html")) {
      return res.sendFile(path.join(publicDir, "index.html"));
    }
    res.json({
      name: "LTI Quiz Tool",
      status: "running",
      message: "This application is intended to be launched from Cohota LMS.",
    });
  });

  // Mock launch endpoint
  app.post("/lti/launch-test", async (req, res) => {
    const session = await ltiTool.createSession(mockPayload, "1060000000000004");
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie("lti_session", session.id, cookieOptions);
    return res.redirect("/app");
  });

  app.get("/app", requireLtiSession, (req, res) => {
    if (req.headers.accept?.includes("text/html")) {
      return res.sendFile(path.join(publicDir, "app.html"));
    }
    res.json({
      message: "LTI Tool authenticated",
      user: req.ltiSession?.user,
    });
  });

  app.get("/api/me", requireLtiSession, (req, res) => {
    res.json({
      authenticated: true,
      user: req.ltiSession?.user,
    });
  });

  app.use("/api/quizzes", requireLtiSession, quizRouter);

  const TEST_PORT = 3144;
  const server = app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  try {
    let allPassed = true;
    function assert(desc, condition, details = "") {
      if (condition) {
        console.log(`[PASS] ${desc}`);
      } else {
        console.error(`[FAIL] ${desc} - ${details}`);
        allPassed = false;
      }
    }

    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    assert("GET /health returns status: ok", healthRes.status === 200 && healthData.status === "ok");

    // 2. Direct root access
    const rootRes = await fetch(`${baseUrl}/`);
    const rootData = await rootRes.json();
    assert("GET / returns LMS guidance", rootRes.status === 200 && rootData.name === "LTI Quiz Tool");

    // 3. Unauthenticated requests MUST return 401
    const noCookieMe = await fetch(`${baseUrl}/api/me`);
    assert("GET /api/me without cookie returns 401", noCookieMe.status === 401);

    const noCookieQuizzes = await fetch(`${baseUrl}/api/quizzes`);
    assert("GET /api/quizzes without cookie returns 401", noCookieQuizzes.status === 401);

    const noCookieQuizDetail = await fetch(`${baseUrl}/api/quizzes/java-basics`);
    assert("GET /api/quizzes/:id without cookie returns 401", noCookieQuizDetail.status === 401);

    const noCookieSubmit = await fetch(`${baseUrl}/api/quizzes/java-basics/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [] }),
    });
    assert("POST /api/quizzes/:id/submit without cookie returns 401", noCookieSubmit.status === 401);

    // 4. Authenticate via LTI launch simulation
    const launchRes = await fetch(`${baseUrl}/lti/launch-test`, {
      method: "POST",
      redirect: "manual",
    });
    assert("POST /lti/launch returns 302 redirect", launchRes.status === 302 && launchRes.headers.get("location") === "/app");

    const setCookie = launchRes.headers.get("set-cookie") || "";
    assert("Response sets HttpOnly lti_session cookie", setCookie.includes("lti_session=") && /httponly/i.test(setCookie));

    const cookieHeader = setCookie.split(";")[0];

    // 5. Authenticated requests with cookie
    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookieHeader },
    });
    const meData = await meRes.json();
    assert("GET /api/me returns authenticated user", meRes.status === 200 && meData.user?.name === "Quang Nguyen");

    // 6. GET /app with HTML Accept header serves app.html
    const appHtmlRes = await fetch(`${baseUrl}/app`, {
      headers: { Cookie: cookieHeader, Accept: "text/html" },
    });
    const appHtmlText = await appHtmlRes.text();
    assert("GET /app serves HTML UI to browsers", appHtmlRes.status === 200 && appHtmlText.includes("Quiz Tool"));

    // 7. GET /api/quizzes returns list of quizzes
    const quizzesRes = await fetch(`${baseUrl}/api/quizzes`, {
      headers: { Cookie: cookieHeader },
    });
    const quizzes = await quizzesRes.json();
    assert("GET /api/quizzes returns 3 quizzes", quizzesRes.status === 200 && Array.isArray(quizzes) && quizzes.length === 3);
    assert("GET /api/quizzes does NOT expose questions or answers", quizzes.every((q) => !q.questions && !q.correctAnswer));

    // 8. GET /api/quizzes/:id returns quiz with questions and options, NEVER correctAnswer
    const quizDetailRes = await fetch(`${baseUrl}/api/quizzes/java-basics`, {
      headers: { Cookie: cookieHeader },
    });
    const quizDetail = await quizDetailRes.json();
    assert("GET /api/quizzes/java-basics returns quiz details", quizDetailRes.status === 200 && quizDetail.title === "Java Basics");
    assert("Quiz has questions with options", Array.isArray(quizDetail.questions) && quizDetail.questions.length > 0);

    // CRITICAL SECURITY ASSERTION: correctAnswer must NEVER be in GET response
    const hasExposedAnswer = JSON.stringify(quizDetail).toLowerCase().includes("correctanswer");
    assert("CRITICAL: correctAnswer is NEVER exposed in GET /api/quizzes/:id", !hasExposedAnswer);

    // 9. GET /api/quizzes/invalid-id returns 404
    const notFoundQuizRes = await fetch(`${baseUrl}/api/quizzes/nonexistent-quiz`, {
      headers: { Cookie: cookieHeader },
    });
    assert("GET /api/quizzes/nonexistent-quiz returns 404", notFoundQuizRes.status === 404);

    // 10. POST /api/quizzes/:id/submit with correct answers
    const submitFullRes = await fetch(`${baseUrl}/api/quizzes/java-basics/submit`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [
          { questionId: "q1", answer: "A" },
          { questionId: "q2", answer: "B" },
          { questionId: "q3", answer: "C" },
          { questionId: "q4", answer: "C" },
        ],
      }),
    });
    const submitFullData = await submitFullRes.json();
    assert("POST submit returns 200 with full score and passed: true",
      submitFullRes.status === 200 &&
      submitFullData.score === 4 &&
      submitFullData.maxScore === 4 &&
      submitFullData.percentage === 100 &&
      submitFullData.passed === true
    );

    // 11. POST /api/quizzes/:id/submit with incorrect answers
    const submitFailRes = await fetch(`${baseUrl}/api/quizzes/java-basics/submit`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [
          { questionId: "q1", answer: "D" },
          { questionId: "q2", answer: "D" },
          { questionId: "q3", answer: "D" },
          { questionId: "q4", answer: "D" },
        ],
      }),
    });
    const submitFailData = await submitFailRes.json();
    assert("POST submit with wrong answers returns passed: false",
      submitFailRes.status === 200 &&
      submitFailData.score === 0 &&
      submitFailData.percentage === 0 &&
      submitFailData.passed === false
    );

    // 12. POST submit with invalid body (missing answers array) -> 400
    const submitBadRes = await fetch(`${baseUrl}/api/quizzes/java-basics/submit`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert("POST submit with malformed body returns 400 Bad Request", submitBadRes.status === 400);

    // 13. POST submit with nonexistent quiz -> 404
    const submit404Res = await fetch(`${baseUrl}/api/quizzes/unknown-quiz/submit`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [] }),
    });
    assert("POST submit with nonexistent quiz returns 404", submit404Res.status === 404);

    // 14. POST submit with invalid question ID -> 400
    const submitInvalidQRes = await fetch(`${baseUrl}/api/quizzes/java-basics/submit`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [{ questionId: "nonexistent-question", answer: "A" }],
      }),
    });
    assert("POST submit with invalid question ID returns 400 Bad Request", submitInvalidQRes.status === 400);

    // 15. POST submit with malformed answer item -> 400
    const submitBadItemRes = await fetch(`${baseUrl}/api/quizzes/java-basics/submit`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: ["invalid-element"],
      }),
    });
    assert("POST submit with malformed answer item returns 400 Bad Request", submitBadItemRes.status === 400);

    console.log("-----------------------------------------");
    console.log(`TEST SUITE RESULT: ${allPassed ? "ALL 17 TESTS PASSED" : "FAILURES DETECTED"}`);
    if (!allPassed) process.exit(1);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error("Test execution encountered an error:", err);
  process.exit(1);
});
