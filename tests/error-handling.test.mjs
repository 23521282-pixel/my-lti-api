import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { badRequest, errorHandler, HttpError } from "../dist/lib/errors.js";
import { makeUser, ROLES, startTestServer } from "./helpers/harness.mjs";

const instructor = makeUser("instructor-err", [ROLES.INSTRUCTOR], "Grace");

let ctx;
let probeServer;
let probeUrl;

/**
 * A tiny app that throws deliberately, so the central error handler can be
 * exercised without needing to break the real database.
 */
function startProbeServer() {
  const app = express();
  app.use(express.json());

  app.get("/http-error", () => {
    throw badRequest("A deliberate validation failure.");
  });

  app.get("/zod-error", () => {
    z.object({ name: z.string() }).parse({});
  });

  app.get("/boom", () => {
    const error = new Error("connection to 10.0.0.5 refused (password=secret)");
    error.code = "ECONNREFUSED";
    throw error;
  });

  app.post("/echo", (req, res) => {
    res.json({ received: req.body });
  });

  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  return server;
}

before(async () => {
  ctx = await startTestServer();
  probeServer = startProbeServer();
  await new Promise((resolve) => probeServer.once("listening", resolve));
  probeUrl = `http://127.0.0.1:${probeServer.address().port}`;
});

after(async () => {
  probeServer.close();
  await ctx.close();
});

describe("error handling", () => {
  it("maps HttpError to its status and message", async () => {
    const response = await fetch(`${probeUrl}/http-error`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.message, "A deliberate validation failure.");
  });

  it("reports validation failures as 400 with field details", async () => {
    const response = await fetch(`${probeUrl}/zod-error`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "Validation failed");
    assert.ok(Array.isArray(body.details));
    assert.equal(body.details[0].path, "name");
  });

  it("hides internal details behind a generic 500", async () => {
    // The handler logs unexpected failures on purpose; keep the test output
    // readable by muting that one log line.
    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    let body;
    try {
      response = await fetch(`${probeUrl}/boom`);
      body = await response.json();
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(response.status, 500);
    assert.equal(body.error, "Internal Server Error");
    assert.equal(body.message, "An unexpected error occurred.");
    assert.ok(!JSON.stringify(body).includes("ECONNREFUSED"));
    assert.ok(!JSON.stringify(body).includes("secret"));
    assert.ok(!("stack" in body));
    assert.ok(
      !("code" in body),
      "driver/DB error codes must not reach the client"
    );
  });

  it("returns 400 for malformed JSON bodies instead of 500", async () => {
    const response = await fetch(`${probeUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ this is not json",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "Request failed");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const response = await ctx.http.get("/api/definitely-not-a-route", {
      user: instructor,
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "Not Found");
  });

  it("does not leak the LTI session secret or tool keys through /api/me", async () => {
    const response = await ctx.http.get("/api/me", { user: instructor });
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.ok(!serialized.includes(process.env.LTI_STATE_SECRET ?? "@@none@@"));
    assert.ok(!serialized.includes("BEGIN PRIVATE KEY"));
    assert.ok(!("jwtPayload" in (response.body.user ?? {})));
  });

  it("exposes HttpError as an Error subclass with a status", () => {
    const error = new HttpError(409, "conflict");
    assert.ok(error instanceof Error);
    assert.equal(error.status, 409);
    assert.equal(error.name, "HttpError");
  });
});
