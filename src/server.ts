import "dotenv/config";
import express from "express";
import { LTITool } from "@lti-tool/core";
import { MemoryStorage } from "@lti-tool/memory";

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

const ltiTool = new LTITool({
  stateSecret: new TextEncoder().encode(
    process.env.LTI_STATE_SECRET!
  ),
  keyPair,
  storage,
});

const clientId = await ltiTool.addClient({
  name: "Cohota",
  clientId: process.env.LTI_CLIENT_ID!,
  iss: process.env.LTI_ISS!,
  jwksUrl: process.env.LTI_JWKS_URL!,
  authUrl: process.env.LTI_AUTH_URL!,
  tokenUrl: process.env.LTI_TOKEN_URL!,
});

await ltiTool.addDeployment(clientId, {
  deploymentId: process.env.LTI_DEPLOYMENT_ID!,
  name: "Development",
});

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ====================
// Basic test
// ====================

app.get("/", (req, res) => {
  res.send("My LTI Tool is running!");
});


// ====================
// LTI JWKS
// ====================

app.get("/lti/jwks", async (req, res) => {
  const jwks = await ltiTool.getJWKS();

  res.json(jwks);
});


// ====================
// LTI Login
// ====================

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


// ====================
// LTI Launch
// ====================

app.post("/lti/launch", async (req, res) => {
  try {
    const { id_token, state } = req.body;

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


// ====================
// Normal API
// ====================

app.get("/api/hello", (req, res) => {
  res.json({
    message: "Hello from my LTI Tool!",
  });
});


// ====================
// Start server
// ====================

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`LTI Tool running on http://localhost:${port}`);
});