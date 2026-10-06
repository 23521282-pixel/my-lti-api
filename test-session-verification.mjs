import express from "express";
import { LTITool } from "@lti-tool/core";
import { MemoryStorage } from "@lti-tool/memory";

async function main() {
  console.log("=== RUNNING SESSION VERIFICATION TEST ===");

  // 1. Setup mock LTITool and storage
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
    name: "John Doe",
    email: "john.doe@example.com",
    given_name: "John",
    family_name: "Doe",
    exp: Math.floor(Date.now() / 1000) + 3600,
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "5:5RKoVsSrxjSi1JYFiu8V6Es9Jnw7PB1ASSxWtyP3",
    "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://my-lti-api.onrender.com/lti/launch",
    "https://purl.imsglobal.org/spec/lti/claim/roles": [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"
    ],
    "https://purl.imsglobal.org/spec/lti/claim/context": {
      id: "course-101",
      label: "CS101",
      title: "Introduction to Computer Science"
    }
  };

  // 2. Cookie and session middleware identical to server.ts
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
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  // Launch test endpoint: simulates launch verification -> createSession -> set-cookie -> redirect to /app
  app.post("/lti/launch-test", async (req, res) => {
    const session = await ltiTool.createSession(mockPayload, "1060000000000004");
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie("lti_session", session.id, cookieOptions);
    return res.redirect("/app");
  });

  app.get("/app", requireLtiSession, (req, res) => {
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

  const TEST_PORT = 3123;
  const server = app.listen(TEST_PORT);

  try {
    const baseUrl = `http://localhost:${TEST_PORT}`;

    // A, B, C: Test POST /lti/launch-test
    const launchRes = await fetch(`${baseUrl}/lti/launch-test`, {
      method: "POST",
      redirect: "manual",
    });

    const is302 = launchRes.status === 302;
    console.log(`A. POST /lti/launch-test returns 302: ${is302 ? "PASS" : "FAIL"} (status: ${launchRes.status})`);

    const setCookieHeader = launchRes.headers.get("set-cookie") || "";
    const hasLtiSession = setCookieHeader.includes("lti_session=");
    console.log(`B. Set-Cookie contains lti_session: ${hasLtiSession ? "PASS" : "FAIL"}`);

    const hasHttpOnly = /httponly/i.test(setCookieHeader);
    console.log(`C. Set-Cookie contains HttpOnly: ${hasHttpOnly ? "PASS" : "FAIL"}`);

    const cookiePair = setCookieHeader.split(";")[0]; // "lti_session=<uuid>"

    // D: Test /api/me with valid cookie
    const meValidRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookiePair },
    });
    const isMe200 = meValidRes.status === 200;
    console.log(`D. /api/me with valid cookie returns 200: ${isMe200 ? "PASS" : "FAIL"} (status: ${meValidRes.status})`);

    // E: Test /app with valid cookie
    const appValidRes = await fetch(`${baseUrl}/app`, {
      headers: { Cookie: cookiePair },
    });
    const isApp200 = appValidRes.status === 200;
    console.log(`E. /app with valid cookie returns 200: ${isApp200 ? "PASS" : "FAIL"} (status: ${appValidRes.status})`);

    // F: Test /api/me with invalid cookie
    const meInvalidRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: "lti_session=invalid-session-uuid" },
    });
    const isMeInvalid401 = meInvalidRes.status === 401;
    console.log(`F. /api/me with invalid cookie returns 401: ${isMeInvalid401 ? "PASS" : "FAIL"} (status: ${meInvalidRes.status})`);

    // G: Test /api/me without cookie
    const meNoCookieRes = await fetch(`${baseUrl}/api/me`);
    const isMeNoCookie401 = meNoCookieRes.status === 401;
    console.log(`G. /api/me without cookie returns 401: ${isMeNoCookie401 ? "PASS" : "FAIL"} (status: ${meNoCookieRes.status})`);

    const allPassed = is302 && hasLtiSession && hasHttpOnly && isMe200 && isApp200 && isMeInvalid401 && isMeNoCookie401;
    console.log("-----------------------------------------");
    console.log(`OVERALL RESULT: ${allPassed ? "ALL TESTS PASSED" : "TESTS FAILED"}`);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

