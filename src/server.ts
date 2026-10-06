import "dotenv/config";
import express from "express";
import { LTITool, type LTISession } from "@lti-tool/core";
import { MemoryStorage } from "@lti-tool/memory";

declare global {
  namespace Express {
    interface Request {
      cookies?: Record<string, string>;
      ltiSession?: LTISession;
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

/**
 * Generate an RSA key pair for the LTI Tool.
 *
 * The private key is used by the Tool to sign requests.
 * The public key is exposed through /lti/jwks.
 */
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

/**
 * In-memory storage for LTI clients, nonces, and sessions.
 *
 * NOTE: MemoryStorage keeps all sessions and nonces in Node process memory.
 * It is suitable ONLY for development and testing. On serverless/container
 * platforms (e.g. Render, AWS Lambda, Kubernetes pods), sessions disappear
 * whenever the process restarts or scales, which will deauthenticate users.
 * For production, use a persistent store (e.g. Redis, DynamoDB, PostgreSQL).
 */
const storage = new MemoryStorage();

const ltiTool = new LTITool({
  stateSecret: new TextEncoder().encode(
    requiredEnv("LTI_STATE_SECRET")
  ),
  keyPair,
  storage,
});

const cohotaClientId = await ltiTool.addClient({
  name: "Cohota",
  clientId: "1060000000000004",
  iss: "https://sso.cohota.com",
  jwksUrl: "https://sso.cohota.com/api/lti/security/jwks",
  authUrl: "https://sso.cohota.com/api/lti/authorize_redirect",
  tokenUrl: "https://sso.cohota.com/login/oauth2/token",
});

await ltiTool.addDeployment(cohotaClientId, {
  deploymentId:
    "5:5RKoVsSrxjSi1JYFiu8V6Es9Jnw7PB1ASSxWtyP3",
  name: "Cohota Deployment",
});

/**
 * Parses HTTP Cookie header into key-value pairs without external dependencies.
 */
function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
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

/**
 * Computes secure cookie options for LTI session cookies.
 *
 * Requirements:
 * - httpOnly: true (prevents client-side scripts from reading the token)
 * - secure: true when running over HTTPS (required for SameSite=None)
 * - sameSite: "none" in HTTPS/production (required for LMS iframe embedding),
 *             falls back to "lax" for plain HTTP local development so browsers do not reject it.
 * - partitioned: opt-in via COOKIE_PARTITIONED=true for CHIPS (Cookies Having Independent Partitioned State)
 *                in modern browsers that block third-party cookies in iframes.
 */
function getSessionCookieOptions(req: express.Request): express.CookieOptions {
  const isHttps =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.TOOL_URL?.startsWith("https://") === true;

  const secure =
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === "true"
      : isHttps;

  // In browsers, SameSite=None strictly requires Secure=true.
  // For local HTTP development without TLS, fall back to "lax".
  const sameSite = secure ? "none" : "lax";

  const options: express.CookieOptions = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };

  if (process.env.COOKIE_PARTITIONED === "true") {
    (options as Record<string, unknown>).partitioned = true;
  }

  return options;
}

/**
 * Middleware requiring a valid active LTI session.
 * Reads the opaque session ID from `req.cookies.lti_session` and retrieves
 * the session from `@lti-tool/core` storage.
 */
async function requireLtiSession(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  try {
    const sessionId = req.cookies?.lti_session;

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Missing lti_session cookie",
      });
    }

    const session = await ltiTool.getSession(sessionId);

    if (!session) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or expired session",
      });
    }

    // Check if the underlying LTI JWT id_token exp claim has passed
    if (
      typeof session.jwtPayload.exp === "number" &&
      Date.now() >= session.jwtPayload.exp * 1000
    ) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Session expired",
      });
    }

    req.ltiSession = session;
    next();
  } catch (error) {
    console.error("Session verification error:", error);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Session authentication failed",
    });
  }
}

const app = express();

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Express cookie parsing middleware (using built-in headers parsing)
app.use((req, _res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

app.get("/", (_req, res) => {
  res.json({
    name: "New LTI Tool",
    status: "running",
  });
});

app.get("/lti/register", async (req, res) => {
  console.log("===== LTI REGISTER CALLED =====");
  console.log("Query:", req.query);

  try {
    const openidConfigurationUrl =
      req.query.openid_configuration;

    const registrationToken =
      req.query.registration_token;

    console.log(
      "OPENID CONFIGURATION URL:",
      openidConfigurationUrl
    );

    if (
      typeof openidConfigurationUrl !== "string" ||
      typeof registrationToken !== "string"
    ) {
      return res.status(400).send(`
        <h1>Invalid registration request</h1>
        <p>Missing openid_configuration or registration_token.</p>
      `);
    }

    const configurationResponse = await fetch(
      openidConfigurationUrl,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${registrationToken}`,
        },
      }
    );

    if (!configurationResponse.ok) {
      const body = await configurationResponse.text();

      console.error(
        "OpenID configuration request failed:",
        configurationResponse.status,
        body
      );

      return res.status(502).send(`
        <h1>Failed to retrieve Platform configuration</h1>
        <p>Status: ${configurationResponse.status}</p>
      `);
    }

    const platformConfiguration =
      await configurationResponse.json();

    console.log(
      "Cohota OpenID configuration:",
      platformConfiguration
    );

    const toolUrl =
      process.env.TOOL_URL ||
      `${req.protocol}://${req.get("host")}`;

    const registration = {
      application_type: "web",
      client_name: "New LTI Tool",
      grant_types: [
        "client_credentials",
        "implicit",
      ],
      jwks_uri: `${toolUrl}/lti/jwks`,
      initiate_login_uri: `${toolUrl}/lti/login`,
      redirect_uris: [
        `${toolUrl}/lti/launch`,
      ],
      response_types: [
        "id_token",
      ],
      token_endpoint_auth_method: "private_key_jwt",
      scope: "",
      "https://purl.imsglobal.org/spec/lti-tool-configuration":
        {
          domain: new URL(toolUrl).hostname,
          target_link_uri:
            `${toolUrl}/lti/launch`,
          claims: [
            "sub",
            "iss",
            "name",
            "given_name",
            "family_name",
            "email",
            "locale",
          ],
          messages: [
            {
              type: "LtiResourceLinkRequest",
              label: "New LTI Tool",
              target_link_uri:
                `${toolUrl}/lti/launch`,
            },
          ],
          "https://canvas.instructure.com/lti/privacy_level":
            "public",
          "https://canvas.instructure.com/lti/tool_id":
            "new-lti-tool",
        },
    };

    console.log(
      "Registration request:",
      JSON.stringify(registration, null, 2)
    );

    const registrationResponse = await fetch(
      platformConfiguration.registration_endpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${registrationToken}`,
        },
        body: JSON.stringify(registration),
      }
    );

    const registrationBody =
      await registrationResponse.text();

    if (!registrationResponse.ok) {
      console.error(
        "Tool registration failed:",
        registrationResponse.status,
        registrationBody
      );

      return res.status(502).send(`
        <h1>Tool registration failed</h1>
        <p>Status: ${registrationResponse.status}</p>
        <pre>${registrationBody}</pre>
      `);
    }

    const registeredTool =
      JSON.parse(registrationBody);

    console.log(
      "Tool registered successfully:",
      registeredTool
    );

    console.log(
      "REGISTERED TOOL DETAILS:",
      JSON.stringify(registeredTool, null, 2)
    );

    res.type("html").send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Registration Successful</title>
        </head>
        <body>
          <h1>Registration successful</h1>
          <p>The LTI Tool has been registered successfully.</p>
          <script>
            window.parent.postMessage(
              {
                subject: "org.imsglobal.lti.close"
              },
              "*"
            );
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(
      "Dynamic registration error:",
      error
    );

    res.status(500).send(`
      <h1>Dynamic registration failed</h1>
      <pre>${String(error)}</pre>
    `);
  }
});

app.get("/lti/jwks", async (_req, res) => {
  try {
    const jwks = await ltiTool.getJWKS();

    res.json(jwks);
  } catch (error) {
    console.error("JWKS error:", error);

    res.status(500).json({
      error: "Failed to generate JWKS",
    });
  }
});


/* =========================================================
   LTI OIDC LOGIN
   ========================================================= */

type LtiLoginParams = {
  client_id: string;
  iss: string;
  login_hint: string;
  target_link_uri: string;
  lti_deployment_id: string;
  lti_message_hint?: string;
};

function parseLtiLoginParams(
  params: Record<string, unknown>
): LtiLoginParams {
  const client_id = params.client_id;
  const iss = params.iss;
  const login_hint = params.login_hint;
  const target_link_uri = params.target_link_uri;
  const lti_deployment_id = params.lti_deployment_id;
  const lti_message_hint = params.lti_message_hint;

  if (
    typeof client_id !== "string" ||
    typeof iss !== "string" ||
    typeof login_hint !== "string" ||
    typeof target_link_uri !== "string" ||
    typeof lti_deployment_id !== "string"
  ) {
    throw new Error("Invalid LTI login parameters");
  }

  return {
    client_id,
    iss,
    login_hint,
    target_link_uri,
    lti_deployment_id,
    ...(typeof lti_message_hint === "string"
      ? { lti_message_hint }
      : {}),
  };
}

async function handleLtiLogin(
  params: Record<string, unknown>,
  res: express.Response
) {
  try {
    console.log("===== LTI LOGIN =====");
    console.log("LTI login params:", params);

    const loginParams =
      parseLtiLoginParams(params);

    const launchUrl =
      `${process.env.TOOL_URL}/lti/launch`;

    const authUrl =
      await ltiTool.handleLogin({
        ...loginParams,
        launchUrl,
      });

    console.log("LTI auth URL:", authUrl);

    return res.redirect(authUrl);
  } catch (error) {
    console.error(
      "LTI login error:",
      error
    );

    return res.status(400).json({
      error: "LTI login failed",
      details:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}

app.get("/lti/login", async (req, res) => {
  await handleLtiLogin(
    req.query as Record<string, unknown>,
    res
  );
});

app.post("/lti/login", async (req, res) => {
  await handleLtiLogin(
    req.body as Record<string, unknown>,
    res
  );
});


/* =========================================================
   LTI LAUNCH
   ========================================================= */

app.post("/lti/launch", async (req, res) => {
  try {
    const {
      id_token,
      state,
    } = req.body;

    if (!id_token || !state) {
      return res.status(400).json({
        error: "Missing id_token or state",
      });
    }

    const payload =
      await ltiTool.verifyLaunch(
        id_token,
        state
      );

    console.log(
      "LTI payload:",
      payload
    );

    const session =
      await ltiTool.createSession(payload);

    console.log(
      "LTI session created successfully for user:",
      session.user.id
    );

    const cookieOptions = getSessionCookieOptions(req);
    res.cookie("lti_session", session.id, cookieOptions);

    return res.redirect("/app");
  } catch (error) {
    console.error(
      "LTI launch error:",
      error
    );

    res.status(401).json({
      error: "Invalid LTI launch",
    });
  }
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

app.get("/api/hello", (_req, res) => {
  res.json({
    message: "Hello from the new LTI Tool!",
  });
});

const port =
  Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(
    `LTI Tool running on port ${port}`
  );
});