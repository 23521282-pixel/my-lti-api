import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  addQuestion,
  createBank,
  singleChoice,
  trueFalse,
} from "./helpers/factory.mjs";
import { makeUser, ROLES, startTestServer } from "./helpers/harness.mjs";

const instructor = makeUser("instructor-qb", [ROLES.INSTRUCTOR], "Ada Lovelace");
const learner = makeUser("learner-qb", [ROLES.LEARNER], "Alan Turing");

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

describe("question bank API", () => {
  it("requires an authenticated LTI session", async () => {
    const response = await ctx.http.get("/api/question-banks");
    assert.equal(response.status, 401);
  });

  it("refuses bank management for learners", async () => {
    const create = await ctx.http.post("/api/question-banks", {
      user: learner,
      body: { name: "Learner bank" },
    });
    assert.equal(create.status, 403);
    assert.match(create.body.message, /instructor|administrator/i);

    const list = await ctx.http.get("/api/question-banks", { user: learner });
    assert.equal(list.status, 403);
  });

  it("creates, lists, reads and updates a bank", async () => {
    const created = await ctx.http.post("/api/question-banks", {
      user: instructor,
      body: { name: "Java Basics", description: "Core Java questions" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, "Java Basics");
    assert.equal(created.body.questionCount, 0);
    assert.ok(created.body.id, "bank should have a generated id");

    const listed = await ctx.http.get("/api/question-banks", {
      user: instructor,
    });
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body));
    assert.ok(listed.body.some((bank) => bank.id === created.body.id));

    const fetched = await ctx.http.get(
      `/api/question-banks/${created.body.id}`,
      { user: instructor }
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.description, "Core Java questions");

    const updated = await ctx.http.patch(
      `/api/question-banks/${created.body.id}`,
      { user: instructor, body: { name: "Java Essentials" } }
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, "Java Essentials");
    assert.equal(updated.body.description, "Core Java questions");
  });

  it("rejects invalid bank payloads", async () => {
    const empty = await ctx.http.post("/api/question-banks", {
      user: instructor,
      body: { name: "   " },
    });
    assert.equal(empty.status, 400);

    const missing = await ctx.http.post("/api/question-banks", {
      user: instructor,
      body: {},
    });
    assert.equal(missing.status, 400);
  });

  it("404s for unknown bank ids", async () => {
    const response = await ctx.http.get("/api/question-banks/does-not-exist", {
      user: instructor,
    });
    assert.equal(response.status, 404);
  });
});

describe("question API", () => {
  let bank;

  before(async () => {
    bank = await createBank(ctx.http, instructor, "Question API Bank");
  });

  it("adds a single-choice question", async () => {
    const response = await ctx.http.post(
      `/api/question-banks/${bank.id}/questions`,
      { user: instructor, body: singleChoice() }
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.type, "SINGLE_CHOICE");
    assert.equal(response.body.correctAnswer, "A");
    assert.equal(response.body.points, 2);
    assert.deepEqual(
      response.body.options.map((option) => option.id),
      ["A", "B", "C"]
    );
  });

  it("adds a true/false question with fixed options", async () => {
    const response = await ctx.http.post(
      `/api/question-banks/${bank.id}/questions`,
      { user: instructor, body: trueFalse({ correctAnswer: "TRUE" }) }
    );

    assert.equal(response.status, 201);
    assert.equal(response.body.correctAnswer, "true");
    assert.deepEqual(
      response.body.options.map((option) => option.id),
      ["true", "false"]
    );
  });

  it("lists and reads back questions", async () => {
    const listed = await ctx.http.get(
      `/api/question-banks/${bank.id}/questions`,
      { user: instructor }
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 2);

    const one = await ctx.http.get(`/api/questions/${listed.body[0].id}`, {
      user: instructor,
    });
    assert.equal(one.status, 200);
    assert.equal(one.body.id, listed.body[0].id);
  });

  it("rejects invalid questions", async () => {
    const cases = [
      { label: "unknown type", body: singleChoice({ type: "ESSAY" }) },
      {
        label: "missing text",
        body: { ...singleChoice(), text: "  " },
      },
      {
        label: "single option",
        body: singleChoice({ options: [{ id: "A", text: "Only" }] }),
      },
      {
        label: "duplicate option ids",
        body: singleChoice({
          options: [
            { id: "A", text: "One" },
            { id: "A", text: "Two" },
          ],
        }),
      },
      {
        label: "answer not an option",
        body: singleChoice({ correctAnswer: "D" }),
      },
      { label: "non-boolean true/false", body: trueFalse({ correctAnswer: "maybe" }) },
      { label: "zero points", body: singleChoice({ points: 0 }) },
      { label: "negative points", body: trueFalse({ points: -1 }) },
      { label: "sub-cent points", body: singleChoice({ points: 1.005 }) },
    ];

    for (const testCase of cases) {
      const response = await ctx.http.post(
        `/api/question-banks/${bank.id}/questions`,
        { user: instructor, body: testCase.body }
      );
      assert.equal(
        response.status,
        400,
        `${testCase.label} should be rejected, got ${response.status}`
      );
    }
  });

  it("rejects questions for an unknown bank", async () => {
    const response = await ctx.http.post(
      "/api/question-banks/missing-bank/questions",
      { user: instructor, body: singleChoice() }
    );
    assert.equal(response.status, 404);
  });

  it("updates a question and re-validates the answer key", async () => {
    const question = await addQuestion(
      ctx.http,
      instructor,
      bank.id,
      singleChoice({ text: "Update me" })
    );

    const badKey = await ctx.http.patch(`/api/questions/${question.id}`, {
      user: instructor,
      body: { correctAnswer: "Z" },
    });
    assert.equal(badKey.status, 400);

    const ok = await ctx.http.patch(`/api/questions/${question.id}`, {
      user: instructor,
      body: { correctAnswer: "B", points: 3.5 },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.correctAnswer, "B");
    assert.equal(ok.body.points, 3.5);
    assert.equal(ok.body.text, "Update me", "unspecified fields are preserved");

    const deleted = await ctx.http.delete(`/api/questions/${question.id}`, {
      user: instructor,
    });
    assert.equal(deleted.status, 204);

    const gone = await ctx.http.get(`/api/questions/${question.id}`, {
      user: instructor,
    });
    assert.equal(gone.status, 404);
  });

  it("requires an instructor to read the answer key", async () => {
    const listed = await ctx.http.get(
      `/api/question-banks/${bank.id}/questions`,
      { user: instructor }
    );

    const asLearner = await ctx.http.get(
      `/api/questions/${listed.body[0].id}`,
      { user: learner }
    );
    assert.equal(asLearner.status, 403);
  });
});
