import "dotenv/config";
import express from "express";
import { LTITool } from "@lti-tool/core";
import { MemoryStorage } from "@lti-tool/memory";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

// --------------------------------------------------
// 1. Generate Tool key pair
// --------------------------------------------------

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

// --------------------------------------------------
// 2. LTI storage
// --------------------------------------------------

const storage = new MemoryStorage();

// --------------------------------------------------
// 3. Create LTI Tool
// --------------------------------------------------

const ltiTool = new LTITool({
  stateSecret: new TextEncoder().encode(
    requiredEnv("LTI_STATE_SECRET")
  ),
  keyPair,
  storage,
});

// --------------------------------------------------
// 4. Register Platform
// --------------------------------------------------

const clientId = await ltiTool.addClient({
  name: requiredEnv("LTI_PLATFORM_NAME"),
  clientId: requiredEnv("LTI_CLIENT_ID"),
  iss: requiredEnv("LTI_ISS"),
  jwksUrl: requiredEnv("LTI_JWKS_URL"),
  authUrl: requiredEnv("LTI_AUTH_URL"),
  tokenUrl: requiredEnv("LTI_TOKEN_URL"),
});

await ltiTool.addDeployment(clientId, {
  deploymentId: requiredEnv("LTI_DEPLOYMENT_ID"),
  name: "Default",
});

// --------------------------------------------------
// 5. Express application
// --------------------------------------------------

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    name: "New LTI Tool",
    status: "running",
  });
});

// --------------------------------------------------
// LTI JWKS
// --------------------------------------------------

app.get("/lti/jwks", async (req, res) => {
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

// --------------------------------------------------
// LTI OIDC Login
// --------------------------------------------------

app.post("/lti/login", async (req, res) => {
  try {
    const authUrl = await ltiTool.handleLogin(req.body);

    res.redirect(authUrl);
  } catch (error) {
    console.error("LTI login error:", error);

    res.status(400).json({
      error: "LTI login failed",
    });
  }
});

// --------------------------------------------------
// LTI Launch
// --------------------------------------------------

app.post("/lti/launch", async (req, res) => {
  try {
    const { id_token, state } = req.body;

    if (!id_token || !state) {
      return res.status(400).json({
        error: "Missing id_token or state",
      });
    }

    const payload = await ltiTool.verifyLaunch(
      id_token,
      state
    );

    console.log("LTI payload:", payload);

    const session = await ltiTool.createSession(payload);

    console.log("LTI session:", session);

    res.json({
      message: "LTI launch successful",
      user: session.user,
    });
  } catch (error) {
    console.error("LTI launch error:", error);

    res.status(401).json({
      error: "Invalid LTI launch",
    });
  }
});

// --------------------------------------------------
// Example application API
// --------------------------------------------------

app.get("/api/hello", (req, res) => {
  res.json({
    message: "Hello from the new LTI Tool!",
  });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(
    `LTI Tool running on port ${port}`
  );
});