/** Small builders so each test states only what it cares about. */

export function singleChoice(overrides = {}) {
  return {
    text: "Which keyword declares a constant in Java?",
    type: "SINGLE_CHOICE",
    options: [
      { id: "A", text: "final" },
      { id: "B", text: "const" },
      { id: "C", text: "static" },
    ],
    correctAnswer: "A",
    explanation: "`final` marks a variable as assign-once.",
    points: 2,
    ...overrides,
  };
}

export function trueFalse(overrides = {}) {
  return {
    text: "The JVM is platform independent.",
    type: "TRUE_FALSE",
    correctAnswer: "true",
    explanation: "Bytecode runs on any JVM implementation.",
    points: 1,
    ...overrides,
  };
}

export async function createBank(http, instructor, name = "Test Bank") {
  const response = await http.post("/api/question-banks", {
    user: instructor,
    body: { name, description: "Created by the integration test suite." },
  });
  if (response.status !== 201) {
    throw new Error(
      `Failed to create bank: ${response.status} ${response.text}`
    );
  }
  return response.body;
}

export async function addQuestion(http, instructor, bankId, body) {
  const response = await http.post(
    `/api/question-banks/${bankId}/questions`,
    { user: instructor, body }
  );
  if (response.status !== 201) {
    throw new Error(
      `Failed to add question: ${response.status} ${response.text}`
    );
  }
  return response.body;
}

export async function createQuiz(http, instructor, body) {
  const response = await http.post("/api/quizzes", { user: instructor, body });
  if (response.status !== 201) {
    throw new Error(
      `Failed to create quiz: ${response.status} ${response.text}`
    );
  }
  return response.body;
}

/**
 * Builds a bank holding `count` questions. Every single-choice question has "A"
 * as its key and every true/false question has "true", so expected scores are
 * easy to state exactly.
 */
export async function createBankWithQuestions(http, instructor, count, name) {
  const bank = await createBank(http, instructor, name);
  const questions = [];

  for (let index = 0; index < count; index += 1) {
    const isChoice = index % 2 === 0;
    questions.push(
      await addQuestion(
        http,
        instructor,
        bank.id,
        isChoice
          ? singleChoice({ text: `Choice question ${index + 1}` })
          : trueFalse({ text: `True/false question ${index + 1}` })
      )
    );
  }

  return { bank, questions };
}

/** Answers every question of an attempt correctly. */
export function correctAnswersFor(attempt) {
  return attempt.questions.map((question) => ({
    attemptQuestionId: question.attemptQuestionId,
    selectedAnswer: question.type === "TRUE_FALSE" ? "true" : "A",
  }));
}
