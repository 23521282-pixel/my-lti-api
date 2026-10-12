import "dotenv/config";
import path from "node:path";
import express from "express";
import {
  errorHandler,
  HttpError,
  notFoundHandler,
  unauthorized,
} from "./lib/errors.js";
import { getSessionCookieOptions, parseCookies } from "./lib/cookies.js";
import { ltiTool } from "./lti/tool.js";
import { apiRouter } from "./routes/index.js";

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` so tests can exercise the real middleware
 * chain (including LTI session verification) without opening a fixed port.
 */
export function createApp(): express.Express {
  /**
   * Middleware requiring a valid active LTI session. Reads the opaque session
   * ID from `req.cookies.lti_session` and retrieves the session from
   * `@lti-tool/core` storage.
   */
  async function requireLtiSession(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const sessionId = req.cookies?.lti_session;

      if (!sessionId || typeof sessionId !== "string") {
        throw unauthorized("Missing lti_session cookie");
      }

      const session = await ltiTool.getSession(sessionId);

      if (!session) {
        throw unauthorized("Invalid or expired session");
      }

      // Check if the underlying LTI JWT id_token exp claim has passed
      if (
        typeof session.jwtPayload.exp === "number" &&
        Date.now() >= session.jwtPayload.exp * 1000
      ) {
        throw unauthorized("Session expired");
      }

      req.ltiSession = session;
      next();
    } catch (error) {
      if (error instanceof HttpError) {
        return res
          .status(error.status)
          .json({ error: "Unauthorized", message: error.message });
      }

      console.error("Session verification error:", error);
      return res.status(401).json({
        error: "Unauthorized",
        message: "Session authentication failed",
      });
    }
  }

  const publicDir = path.resolve(process.cwd(), "public");

  const app = express();

  app.set("trust proxy", 1);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(publicDir, { index: false }));

  // Cookie parsing middleware (no external dependency needed).
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

  app.get("/lti/register", async (req, res) => {
    console.log("===== LTI REGISTER CALLED =====");
    // `registration_token` is a bearer credential and `openid_configuration`
    // is untrusted input: log only which parameters arrived, never the values.
    console.log("Query params:", Object.keys(req.query));

    try {
      const openidConfigurationUrl = req.query.openid_configuration;
      const registrationToken = req.query.registration_token;

      console.log("OPENID CONFIGURATION URL:", openidConfigurationUrl);

      if (
        typeof openidConfigurationUrl !== "string" ||
        typeof registrationToken !== "string"
      ) {
        return res.status(400).send(`
        <h1>Invalid registration request</h1>
        <p>Missing openid_configuration or registration_token.</p>
      `);
      }

      const configurationResponse = await fetch(openidConfigurationUrl, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${registrationToken}`,
        },
      });

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

      const platformConfiguration = await configurationResponse.json();

      console.log("Cohota OpenID configuration loaded:", {
        issuer: platformConfiguration?.issuer,
        registration_endpoint: platformConfiguration?.registration_endpoint,
      });

      const toolUrl =
        process.env.TOOL_URL || `${req.protocol}://${req.get("host")}`;

      const registration = {
        application_type: "web",
        client_name: "New LTI Tool",
        grant_types: ["client_credentials", "implicit"],
        jwks_uri: `${toolUrl}/lti/jwks`,
        initiate_login_uri: `${toolUrl}/lti/login`,
        redirect_uris: [`${toolUrl}/lti/launch`],
        response_types: ["id_token"],
        token_endpoint_auth_method: "private_key_jwt",
        scope: "",
        "https://purl.imsglobal.org/spec/lti-tool-configuration": {
          domain: new URL(toolUrl).hostname,
          target_link_uri: `${toolUrl}/lti/launch`,
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
              target_link_uri: `${toolUrl}/lti/launch`,
            },
          ],
          "https://canvas.instructure.com/lti/privacy_level": "public",
          "https://canvas.instructure.com/lti/tool_id": "new-lti-tool",
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

      const registrationBody = await registrationResponse.text();

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

      const registeredTool = JSON.parse(registrationBody);

      // The registration response can carry credentials, so log identifiers
      // only rather than the whole body.
      console.log("Tool registered successfully:", {
        client_id: registeredTool?.client_id,
        client_name: registeredTool?.client_name,
      });

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
      console.error("Dynamic registration error:", error);

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
      ...(typeof lti_message_hint === "string" ? { lti_message_hint } : {}),
    };
  }

  async function handleLtiLogin(
    params: Record<string, unknown>,
    req: express.Request,
    res: express.Response
  ) {
    try {
      console.log("===== LTI LOGIN =====");
      console.log("LTI login params:", params);

      const loginParams = parseLtiLoginParams(params);

      // Falls back to the request host when TOOL_URL is not configured, which
      // would otherwise produce a literal "undefined/lti/launch" redirect.
      const toolUrl =
        process.env.TOOL_URL || `${req.protocol}://${req.get("host")}`;
      const launchUrl = `${toolUrl}/lti/launch`;

      const authUrl = await ltiTool.handleLogin({
        ...loginParams,
        launchUrl,
      });

      console.log("LTI auth URL:", authUrl);

      return res.redirect(authUrl);
    } catch (error) {
      console.error("LTI login error:", error);

      return res.status(400).json({
        error: "LTI login failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  app.get("/lti/login", async (req, res) => {
    await handleLtiLogin(req.query as Record<string, unknown>, req, res);
  });

  app.post("/lti/login", async (req, res) => {
    await handleLtiLogin(req.body as Record<string, unknown>, req, res);
  });

  /* =========================================================
     LTI LAUNCH
     ========================================================= */

  app.post("/lti/launch", async (req, res) => {
    try {
      const { id_token, state } = req.body;

      if (!id_token || !state) {
        return res.status(400).json({
          error: "Missing id_token or state",
        });
      }

      const payload = await ltiTool.verifyLaunch(id_token, state);

      console.log("LTI payload:", payload);

      const session = await ltiTool.createSession(payload);

      console.log(
        "LTI session created successfully for user:",
        session.user.id
      );

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie("lti_session", session.id, cookieOptions);

      return res.redirect("/app");
    } catch (error) {
      console.error("LTI launch error:", error);

      res.status(401).json({
        error: "Invalid LTI launch",
      });
    }
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

  app.get("/api/hello", (_req, res) => {
    res.json({
      message: "Hello from the new LTI Tool!",
    });
  });

  // Everything under /api beyond this point requires a verified LTI session.
  app.use("/api", requireLtiSession, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
