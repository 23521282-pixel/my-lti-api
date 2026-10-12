import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeUser, ROLES, startTestServer } from "./helpers/harness.mjs";

const learner = makeUser("learner-ui", [ROLES.LEARNER], "Alice");

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

describe("bundled UI", () => {
  it("serves the quiz UI to an authenticated browser", async () => {
    const response = await ctx.http.get("/app", {
      user: learner,
      headers: { Accept: "text/html" },
    });

    assert.equal(response.status, 200);
    assert.match(response.text, /Quiz Tool/);
    assert.match(response.text, /review-btn/);
  });

  it("does not call any removed mock endpoints", async () => {
    const response = await ctx.http.get("/app", {
      user: learner,
      headers: { Accept: "text/html" },
    });

    assert.ok(
      !response.text.includes("currentQuizId"),
      "the removed per-quiz state must not be referenced"
    );
    assert.ok(
      !/\/api\/quizzes\/\$\{/.test(response.text),
      "no template-literal call to the removed quiz endpoints"
    );
    assert.ok(
      response.text.includes("/api/attempts/"),
      "the UI should use the attempt endpoints"
    );
  });
});
