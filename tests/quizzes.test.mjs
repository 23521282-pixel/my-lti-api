import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  addQuestion,
  createBank,
  createBankWithQuestions,
  singleChoice,
} from "./helpers/factory.mjs";
import { makeUser, ROLES, startTestServer } from "./helpers/harness.mjs";

const instructor = makeUser("instructor-quiz", [ROLES.INSTRUCTOR], "Grace Hopper");
const learner = makeUser("learner-quiz", [ROLES.LEARNER], "Alan Turing");

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

describe("quiz API", () => {
  it("lets any authenticated user list quizzes but only instructors manage them", async () => {
    const list = await ctx.http.get("/api/quizzes", { user: learner });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));

    const bank = await createBank(ctx.http, instructor, "Permissions Bank");
    const forbidden = await ctx.http.post("/api/quizzes", {
      user: learner,
      body: {
        title: "Learner quiz",
        questionBankId: bank.id,
        questionCount: 1,
      },
    });
    assert.equal(forbidden.status, 403);
  });

  it("creates a quiz from a bank and question count", async () => {
    const { bank } = await createBankWithQuestions(
      ctx.http,
      instructor,
      5,
      "Quiz Creation Bank"
    );

    const response = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Java Fundamentals",
        description: "Short quiz",
        questionBankId: bank.id,
        questionCount: 3,
      },
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.title, "Java Fundamentals");
    assert.equal(response.body.questionCount, 3);
    assert.equal(response.body.questionBankId, bank.id);
    assert.equal(response.body.questionBankName, "Quiz Creation Bank");
    assert.equal(response.body.availableQuestionCount, 5);
  });

  it("rejects a quiz when the bank has too few questions", async () => {
    const { bank } = await createBankWithQuestions(
      ctx.http,
      instructor,
      2,
      "Too Small Bank"
    );

    const response = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Impossible quiz",
        questionBankId: bank.id,
        questionCount: 5,
      },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /2 question/);

    const listed = await ctx.http.get("/api/quizzes", { user: instructor });
    assert.ok(
      !listed.body.some((quiz) => quiz.title === "Impossible quiz"),
      "no quiz row should be created when validation fails"
    );
  });

  it("rejects an empty bank and invalid counts", async () => {
    const emptyBank = await createBank(ctx.http, instructor, "Empty Bank");

    const empty = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Empty quiz",
        questionBankId: emptyBank.id,
        questionCount: 1,
      },
    });
    assert.equal(empty.status, 400);

    for (const questionCount of [0, -3, 2.5]) {
      const response = await ctx.http.post("/api/quizzes", {
        user: instructor,
        body: {
          title: `Count ${questionCount}`,
          questionBankId: emptyBank.id,
          questionCount,
        },
      });
      assert.equal(response.status, 400, `count ${questionCount} should fail`);
    }

    const unknownBank = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Unknown bank",
        questionBankId: "missing-bank",
        questionCount: 1,
      },
    });
    assert.equal(unknownBank.status, 404);
  });

  it("reads and updates a quiz", async () => {
    const { bank } = await createBankWithQuestions(
      ctx.http,
      instructor,
      4,
      "Update Bank"
    );

    const created = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Before update",
        questionBankId: bank.id,
        questionCount: 2,
      },
    });
    assert.equal(created.status, 201);

    const fetched = await ctx.http.get(`/api/quizzes/${created.body.id}`, {
      user: learner,
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.title, "Before update");
    assert.ok(
      !("questions" in fetched.body),
      "quiz detail must not embed questions"
    );

    const updated = await ctx.http.patch(`/api/quizzes/${created.body.id}`, {
      user: instructor,
      body: { title: "After update", questionCount: 4 },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title, "After update");
    assert.equal(updated.body.questionCount, 4);

    const tooMany = await ctx.http.patch(`/api/quizzes/${created.body.id}`, {
      user: instructor,
      body: { questionCount: 99 },
    });
    assert.equal(tooMany.status, 400);
  });

  it("blocks starting an attempt when the bank lost questions", async () => {
    const { bank, questions } = await createBankWithQuestions(
      ctx.http,
      instructor,
      3,
      "Shrinking Bank"
    );

    const quiz = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Shrinking quiz",
        questionBankId: bank.id,
        questionCount: 3,
      },
    });
    assert.equal(quiz.status, 201);

    const deleted = await ctx.http.delete(`/api/questions/${questions[0].id}`, {
      user: instructor,
    });
    assert.equal(deleted.status, 204);

    const attempt = await ctx.http.post(
      `/api/quizzes/${quiz.body.id}/attempts`,
      { user: learner }
    );
    assert.equal(attempt.status, 400);
    assert.match(attempt.body.message, /question/);
  });

  it("blocks deleting a bank that a quiz uses", async () => {
    const { bank } = await createBankWithQuestions(
      ctx.http,
      instructor,
      2,
      "Referenced Bank"
    );
    await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "References the bank",
        questionBankId: bank.id,
        questionCount: 1,
      },
    });

    const response = await ctx.http.delete(`/api/question-banks/${bank.id}`, {
      user: instructor,
    });
    assert.equal(response.status, 409);
  });

  it("deletes a quiz without attempts, and refuses once attempts exist", async () => {
    const { bank } = await createBankWithQuestions(
      ctx.http,
      instructor,
      2,
      "Deletable Bank"
    );

    const quiz = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Deletable quiz",
        questionBankId: bank.id,
        questionCount: 2,
      },
    });
    assert.equal(quiz.status, 201);

    const started = await ctx.http.post(
      `/api/quizzes/${quiz.body.id}/attempts`,
      { user: learner }
    );
    assert.equal(started.status, 201);

    const blocked = await ctx.http.delete(`/api/quizzes/${quiz.body.id}`, {
      user: instructor,
    });
    assert.equal(blocked.status, 409);

    const other = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Unused quiz",
        questionBankId: bank.id,
        questionCount: 1,
      },
    });

    const removed = await ctx.http.delete(`/api/quizzes/${other.body.id}`, {
      user: instructor,
    });
    assert.equal(removed.status, 204);

    const gone = await ctx.http.get(`/api/quizzes/${other.body.id}`, {
      user: instructor,
    });
    assert.equal(gone.status, 404);
  });

  it("validates that questions added later become available", async () => {
    const bank = await createBank(ctx.http, instructor, "Growing Bank");
    await addQuestion(ctx.http, instructor, bank.id, singleChoice());

    const quiz = await ctx.http.post("/api/quizzes", {
      user: instructor,
      body: {
        title: "Growing quiz",
        questionBankId: bank.id,
        questionCount: 1,
      },
    });
    assert.equal(quiz.status, 201);
    assert.equal(quiz.body.availableQuestionCount, 1);

    const started = await ctx.http.post(
      `/api/quizzes/${quiz.body.id}/attempts`,
      { user: learner }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.questions.length, 1);
  });
});
