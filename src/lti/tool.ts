import { LTITool } from "@lti-tool/core";
import { MemoryStorage } from "@lti-tool/memory";

/**
 * LTI 1.3 tool instance and platform registration.
 *
 * NOTE: this is entirely in-process state.
 * - The RSA key pair is generated on every boot, so the public key served by
 *   `/lti/jwks` changes whenever the process restarts.
 * - `MemoryStorage` keeps LTI clients, nonces, and sessions in Node memory, so
 *   sessions disappear on restart or when a container scales.
 * Both are fine for development but must be replaced with persistent storage
 * (Redis/DynamoDB/PostgreSQL) and a stable key pair before production use.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

/**
 * RSA key pair for the tool. The private key signs requests to the platform;
 * the public key is published through `/lti/jwks`.
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

const storage = new MemoryStorage();

export const ltiTool = new LTITool({
  stateSecret: new TextEncoder().encode(requiredEnv("LTI_STATE_SECRET")),
  keyPair,
  storage,
});

/** Cohota LMS registration (pre-seeded client + deployment). */
const cohotaClientId = await ltiTool.addClient({
  name: "Cohota",
  clientId: "1060000000000004",
  iss: "https://sso.cohota.com",
  jwksUrl: "https://sso.cohota.com/api/lti/security/jwks",
  authUrl: "https://sso.cohota.com/api/lti/authorize_redirect",
  tokenUrl: "https://sso.cohota.com/login/oauth2/token",
});

await ltiTool.addDeployment(cohotaClientId, {
  deploymentId: "5:5RKoVsSrxjSi1JYFiu8V6Es9Jnw7PB1ASSxWtyP3",
  name: "Cohota Deployment",
});
