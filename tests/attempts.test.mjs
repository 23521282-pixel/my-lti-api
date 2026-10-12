import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  addQuestion,
  correctAnswersFor,
  createBank,
  createBankWithQuestions,
  createQuiz,
  singleChoice,
} from "./helpers/factory.mjs";
import { makeUser, ROLES, startTestServer } from "./helpers/harness.mjs";

const instructor = makeUser("instructor-att", [ROLES.INSTRUCTOR], "Grace Hopper");
const alice = makeUser("learner-alice", [ROLES.LEARNER], "Alice");
const bob = makeUser("learner-bob", [ROLES.LEARNER], "Bob");

let ctx;
let bank;
let quiz;

before(async () => {
  ctx = await startTestServer();

  const created = await createBankWithQuestions(
    ctx.http,
    instructor,
    6,
    "Attempt Bank"
  );
  bank = created.bank;
  quiz = await createQuiz(ctx.http, instructor, {
    title: "Attempt Quiz",
    description: "Six questions, four per attempt",
    questionBankId: bank.id,
    questionCount: 4,
  });
});

after(async () => {
  await ctx.close();
});

const wrongAnswerFor = (question) => ({
  attemptQuestionId: question.attemptQuestionId,
  selectedAnswer: question.type === "TRUE_FALSE" ? "false" : "B",
});

const totalPoints = (attempt) =>
  attempt.questions.reduce((sum, question) => sum + question.maxPoints, 0);

async function startAttempt(user = alice) {
  const response = await ctx.http.post(`/api/quizzes/${quiz.id}/attempts`, {
    user,
  });
  assert.equal(response.status, 201, response.text);
  return response.body;
}

describe("starting an attempt", () => {
  it("selects the requested number of unique questions in a fixed order", async () => {
    const attempt = await startAttempt();

    assert.equal(attempt.status, "IN_PROGRESS");
    assert.equal(attempt.quizId, quiz.id);
    assert.equal(attempt.questions.length, 4);
    assert.equal(
      new Set(attempt.questions.map((q) => q.attemptQuestionId)).size,
      4,
      "attempt question ids must be unique"
    );
    assert.equal(
      new Set(attempt.questions.map((q) => q.questionId)).size,
      4,
      "each source question may appear only once"
    );
    assert.deepEqual(
      attempt.questions.map((q) => q.order),
      [0, 1, 2, 3]
    );

    for (const question of attempt.questions) {
      assert.ok(question.questionText.length > 0);
      assert.ok(question.options.length >= 2);
      assert.ok(question.maxPoints > 0);
      assert.equal(question.selectedAnswer, null);
    }

    assert.equal(attempt.score, 0);
    assert.equal(attempt.percentage, 0);
    assert.equal(attempt.maxScore, totalPoints(attempt));
    assert.equal(attempt.submittedAt, null);
  });

  it("never exposes answer keys or explanations before submission", async () => {
    const response = await ctx.http.post(
      `/api/quizzes/${quiz.id}/attempts`,
      { user: alice }
    );

    assert.equal(response.status, 201);
    assert.ok(!response.text.includes("correctAnswer"));
    assert.ok(!response.text.includes("explanation"));
    assert.ok(!response.text.includes("pointsEarned"));
    assert.ok(!response.text.includes("isCorrect"));

    const fetched = await ctx.http.get(
      `/api/attempts/${response.body.attemptId}`,
      { user: alice }
    );
    assert.equal(fetched.status, 200);
    assert.ok(!fetched.text.includes("correctAnswer"));
  });

  it("gives each attempt its own questions", async () => {
    const first = await startAttempt(alice);
    const second = await startAttempt(alice);

    assert.notEqual(first.attemptId, second.attemptId);
    assert.notEqual(
      first.questions[0].attemptQuestionId,
      second.questions[0].attemptQuestionId,
      "a new attempt gets fresh snapshot rows"
    );
  });
});

describe("submitting an attempt", () => {
  it("scores a fully correct submission server-side", async () => {
    const attempt = await startAttempt();

    const response = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body: { answers: correctAnswersFor(attempt) } }
    );

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.status, "SUBMITTED");
    assert.equal(response.body.score, attempt.maxScore);
    assert.equal(response.body.maxScore, attempt.maxScore);
    assert.equal(response.body.percentage, 100);
    assert.ok(response.body.submittedAt);

    const stored = await ctx.prisma.quizAttempt.findUnique({
      where: { id: attempt.attemptId },
    });
    assert.equal(stored.status, "SUBMITTED");
    assert.equal(Number(stored.score), attempt.maxScore);
    assert.equal(Number(stored.maxScore), attempt.maxScore);
  });

  it("awards no points for wrong answers but keeps the full maximum", async () => {
    const attempt = await startAttempt();

    const response = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body: { answers: attempt.questions.map(wrongAnswerFor) } }
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.score, 0);
    assert.equal(response.body.maxScore, attempt.maxScore);
    assert.equal(response.body.percentage, 0);
  });

  it("uses decimal-safe arithmetic for partial scores", async () => {
    const fractionalBank = await createBank(
      ctx.http,
      instructor,
      "Fractional Bank"
    );
    await addQuestion(
      ctx.http,
      instructor,
      fractionalBank.id,
      singleChoice({ text: "Half point", points: 0.5 })
    );
    await addQuestion(
      ctx.http,
      instructor,
      fractionalBank.id,
      singleChoice({ text: "Two and a half", points: 2.5 })
    );
    await addQuestion(
      ctx.http,
      instructor,
      fractionalBank.id,
      singleChoice({ text: "One point", points: 1 })
    );

    const fractionalQuiz = await createQuiz(ctx.http, instructor, {
      title: "Fractional Quiz",
      questionBankId: fractionalBank.id,
      questionCount: 3,
    });

    const started = await ctx.http.post(
      `/api/quizzes/${fractionalQuiz.id}/attempts`,
      { user: alice }
    );
    assert.equal(started.status, 201);
    const attempt = started.body;

    // Answer everything correctly except the first question shown.
    const [skipped, ...rest] = attempt.questions;
    const answers = [
      wrongAnswerFor(skipped),
      ...rest.map((question) => ({
        attemptQuestionId: question.attemptQuestionId,
        selectedAnswer: "A",
      })),
    ];

    const response = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body: { answers } }
    );

    const expectedScore = attempt.maxScore - skipped.maxPoints;
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.maxScore, 4);
    assert.equal(response.body.score, expectedScore);
    assert.equal(response.body.percentage, Math.round((expectedScore / 4) * 10000) / 100);
  });

  it("grades answers saved before submission", async () => {
    const attempt = await startAttempt();
    const answers = correctAnswersFor(attempt);

    const saved = await ctx.http.put(
      `/api/attempts/${attempt.attemptId}/answers`,
      { user: alice, body: { answers } }
    );
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(
      saved.body.questions.map((question) => question.selectedAnswer),
      answers.map((answer) => answer.selectedAnswer)
    );

    const submitted = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body: {} }
    );
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.score, attempt.maxScore);
  });

  it("rejects invalid or malformed answers", async () => {
    const attempt = await startAttempt();
    const [first] = attempt.questions;

    const invalidOption = await ctx.http.put(
      `/api/attempts/${attempt.attemptId}/answers`,
      {
        user: alice,
        body: {
          answers: [
            { attemptQuestionId: first.attemptQuestionId, selectedAnswer: "Z" },
          ],
        },
      }
    );
    assert.equal(invalidOption.status, 400);

    const foreignQuestion = await ctx.http.put(
      `/api/attempts/${attempt.attemptId}/answers`,
      {
        user: alice,
        body: {
          answers: [
            { attemptQuestionId: "not-in-this-attempt", selectedAnswer: "A" },
          ],
        },
      }
    );
    assert.equal(foreignQuestion.status, 400);

    const duplicate = await ctx.http.put(
      `/api/attempts/${attempt.attemptId}/answers`,
      {
        user: alice,
        body: {
          answers: [
            { attemptQuestionId: first.attemptQuestionId, selectedAnswer: "A" },
            { attemptQuestionId: first.attemptQuestionId, selectedAnswer: "B" },
          ],
        },
      }
    );
    assert.equal(duplicate.status, 400);

    const notAnArray = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body: { answers: "A" } }
    );
    assert.equal(notAnArray.status, 400);

    const missingReference = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body: { answers: [{ selectedAnswer: "A" }] } }
    );
    assert.equal(missingReference.status, 400);
  });

  it("prevents duplicate submission", async () => {
    const attempt = await startAttempt();
    const body = { answers: correctAnswersFor(attempt) };

    const first = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body }
    );
    assert.equal(first.status, 200);

    const second = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: alice, body }
    );
    assert.equal(second.status, 409);
    assert.match(second.body.message, /already been submitted/i);

    const answersAfterSubmit = await ctx.http.put(
      `/api/attempts/${attempt.attemptId}/answers`,
      { user: alice, body }
    );
    assert.equal(answersAfterSubmit.status, 409);
  });

  it("resolves concurrent submissions to exactly one success", async () => {
    const attempt = await startAttempt();
    const body = { answers: correctAnswersFor(attempt) };

    const [one, two] = await Promise.all([
      ctx.http.post(`/api/attempts/${attempt.attemptId}/submit`, {
        user: alice,
        body,
      }),
      ctx.http.post(`/api/attempts/${attempt.attemptId}/submit`, {
        user: alice,
        body,
      }),
    ]);

    const statuses = [one.status, two.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      `expected one success and one conflict, got ${statuses}`
    );

    const stored = await ctx.prisma.quizAttempt.findUnique({
      where: { id: attempt.attemptId },
    });
    assert.equal(stored.status, "SUBMITTED");
    assert.equal(Number(stored.maxScore), attempt.maxScore);
  });
});

describe("reviewing an attempt", () => {
  it("refuses review before submission", async () => {
    const attempt = await startAttempt();

    const response = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}/review`,
      { user: alice }
    );
    assert.equal(response.status, 409);
  });

  it("returns answer keys, correctness, points and explanations after submission", async () => {
    const attempt = await startAttempt();
    const answers = attempt.questions.map((question, index) =>
      index === 0
        ? wrongAnswerFor(question)
        : {
            attemptQuestionId: question.attemptQuestionId,
            selectedAnswer: question.type === "TRUE_FALSE" ? "true" : "A",
          }
    );

    await ctx.http.post(`/api/attempts/${attempt.attemptId}/submit`, {
      user: alice,
      body: { answers },
    });

    const response = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}/review`,
      { user: alice }
    );

    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.status, "SUBMITTED");
    assert.equal(response.body.quizTitle, "Attempt Quiz");
    assert.equal(response.body.maxScore, attempt.maxScore);
    assert.ok(response.body.submittedAt);
    assert.equal(response.body.questions.length, 4);

    const [first, ...others] = response.body.questions;
    assert.equal(first.isCorrect, false);
    assert.equal(first.pointsEarned, 0);
    assert.equal(first.selectedAnswer, wrongAnswerFor(first).selectedAnswer);
    assert.equal(
      first.correctAnswer,
      first.type === "TRUE_FALSE" ? "true" : "A"
    );
    assert.ok(first.maxPoints > 0);

    for (const question of others) {
      assert.equal(question.isCorrect, true);
      assert.equal(question.pointsEarned, question.maxPoints);
      assert.ok(question.explanation, "explanations come from the snapshot");
    }

    const expectedScore = attempt.maxScore - first.maxPoints;
    assert.equal(response.body.score, expectedScore);
  });

  it("keeps a historical result stable when the source question is edited", async () => {
    const { bank: historyBank, questions } = await createBankWithQuestions(
      ctx.http,
      instructor,
      2,
      "History Bank"
    );
    const historyQuiz = await createQuiz(ctx.http, instructor, {
      title: "History Quiz",
      questionBankId: historyBank.id,
      questionCount: 2,
    });

    const started = await ctx.http.post(
      `/api/quizzes/${historyQuiz.id}/attempts`,
      { user: alice }
    );
    const attempt = started.body;
    const answers = correctAnswersFor(attempt);

    await ctx.http.post(`/api/attempts/${attempt.attemptId}/submit`, {
      user: alice,
      body: { answers },
    });

    const before = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}/review`,
      { user: alice }
    );

    // Rewrite every source question: new text and a new answer key.
    for (const question of questions) {
      const patched = await ctx.http.patch(`/api/questions/${question.id}`, {
        user: instructor,
        body: {
          text: "Rewritten after the attempt",
          correctAnswer: question.type === "TRUE_FALSE" ? "false" : "B",
        },
      });
      assert.equal(patched.status, 200, patched.text);
    }

    const after = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}/review`,
      { user: alice }
    );

    assert.deepEqual(
      after.body,
      before.body,
      "review must not change when the underlying questions are edited"
    );
    assert.equal(after.body.percentage, 100);
  });

  it("keeps a historical result reviewable after the source question is deleted", async () => {
    const { bank: deleteBank, questions } = await createBankWithQuestions(
      ctx.http,
      instructor,
      2,
      "Deletion Bank"
    );
    const deleteQuiz = await createQuiz(ctx.http, instructor, {
      title: "Deletion Quiz",
      questionBankId: deleteBank.id,
      questionCount: 2,
    });

    const started = await ctx.http.post(
      `/api/quizzes/${deleteQuiz.id}/attempts`,
      { user: alice }
    );
    const attempt = started.body;

    await ctx.http.post(`/api/attempts/${attempt.attemptId}/submit`, {
      user: alice,
      body: { answers: correctAnswersFor(attempt) },
    });

    for (const question of questions) {
      const deleted = await ctx.http.delete(`/api/questions/${question.id}`, {
        user: instructor,
      });
      assert.equal(deleted.status, 204);
    }

    const review = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}/review`,
      { user: alice }
    );
    assert.equal(review.status, 200);
    assert.equal(review.body.score, attempt.maxScore);
    assert.equal(review.body.questions.length, 2);
    assert.ok(
      review.body.questions.every((question) => question.correctAnswer),
      "snapshotted answer keys survive deletion of the source question"
    );
  });
});

describe("attempt ownership", () => {
  it("hides another user's attempt for reads, writes and review", async () => {
    const attempt = await startAttempt(alice);

    const read = await ctx.http.get(`/api/attempts/${attempt.attemptId}`, {
      user: bob,
    });
    assert.equal(read.status, 404);

    const write = await ctx.http.put(
      `/api/attempts/${attempt.attemptId}/answers`,
      { user: bob, body: { answers: correctAnswersFor(attempt) } }
    );
    assert.equal(write.status, 404);

    const submit = await ctx.http.post(
      `/api/attempts/${attempt.attemptId}/submit`,
      { user: bob, body: { answers: correctAnswersFor(attempt) } }
    );
    assert.equal(submit.status, 404);

    const review = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}/review`,
      { user: bob }
    );
    assert.equal(review.status, 404);

    const ownerRead = await ctx.http.get(
      `/api/attempts/${attempt.attemptId}`,
      { user: alice }
    );
    assert.equal(ownerRead.status, 200);
  });

  it("lists only the caller's attempts for a quiz", async () => {
    const attempt = await startAttempt(bob);
    await ctx.http.post(`/api/attempts/${attempt.attemptId}/submit`, {
      user: bob,
      body: { answers: correctAnswersFor(attempt) },
    });

    const bobList = await ctx.http.get(
      `/api/quizzes/${quiz.id}/attempts/me`,
      { user: bob }
    );
    assert.equal(bobList.status, 200);
    assert.ok(bobList.body.length >= 1);
    assert.ok(
      bobList.body.every((entry) => entry.quizId === quiz.id),
      "list is scoped to the requested quiz"
    );

    const carol = makeUser("learner-carol", [ROLES.LEARNER], "Carol");
    const carolList = await ctx.http.get(
      `/api/quizzes/${quiz.id}/attempts/me`,
      { user: carol }
    );
    assert.equal(carolList.status, 200);
    assert.deepEqual(carolList.body, []);
  });
});
