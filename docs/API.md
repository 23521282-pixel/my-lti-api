# Quiz Tool API

All endpoints live under `/api` and require a valid LTI session. The session is
established by an LTI 1.3 launch: the platform redirects to
`POST /lti/launch`, the tool verifies the `id_token` and stores an opaque
session, and the browser receives an `httpOnly` `lti_session` cookie. Every
`/api` request is authenticated from that cookie by `requireLtiSession`.

User identity always comes from the verified launch (`session.user.id`, the LTI
`sub`). No endpoint accepts a user ID from the request body.

## Permission model

| Level | Who | How it is determined |
| --- | --- | --- |
| Authenticated | Any successful LTI launch | Valid `lti_session` cookie |
| Authoring | Instructor or administrator | LTI role claims (`isInstructor` / `isAdmin`) |
| Owner | The user who started the attempt (administrators may also access) | `QuizAttempt.userId` |

Authoring endpoints return `403` for learners. Attempt endpoints return `404` for
attempts the caller does not own, so the API never confirms that another user's
attempt ID exists.

## Error format

```json
{ "error": "Request failed", "message": "Human readable detail", "details": {} }
```

`400` validation failures add a `details.issues` array of `{ path, message }`.
Unexpected failures return `500` with a generic message; internal details and
stack traces are never sent to clients.

## Question banks

Instructor/administrator only. Responses include answer keys.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/question-banks` | List banks with `questionCount`/`quizCount` |
| `POST` | `/api/question-banks` | Create a bank |
| `GET` | `/api/question-banks/:id` | Get one bank |
| `PATCH` | `/api/question-banks/:id` | Update `name`/`description` |
| `DELETE` | `/api/question-banks/:id` | Delete a bank (`409` if a quiz uses it) |

Create body:

```json
{ "name": "Java Basics", "description": "Core Java questions" }
```

## Questions

Instructor/administrator only.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/question-banks/:bankId/questions` | Add a question |
| `GET` | `/api/question-banks/:bankId/questions` | List a bank's questions |
| `GET` | `/api/questions/:id` | Get one question |
| `PATCH` | `/api/questions/:id` | Update a question |
| `DELETE` | `/api/questions/:id` | Delete a question |

Create/update body:

```json
{
  "text": "Which keyword declares a constant in Java?",
  "type": "SINGLE_CHOICE",
  "options": [
    { "id": "A", "text": "final" },
    { "id": "B", "text": "const" },
    { "id": "C", "text": "static" }
  ],
  "correctAnswer": "A",
  "explanation": "`final` marks a variable as assign-once.",
  "points": 2
}
```

Rules enforced server-side:

- `type` is `SINGLE_CHOICE` or `TRUE_FALSE`.
- `SINGLE_CHOICE` needs at least two options with unique ids, and
  `correctAnswer` must match one of them.
- `TRUE_FALSE` ignores client options: the tool always stores
  `true`/`false` and requires a boolean `correctAnswer`.
- `points` must be positive with at most two decimal places (`DECIMAL(8,2)`).

Deleting a question never corrupts history: each attempt holds its own snapshot.

## Quizzes

Reading is open to any authenticated launch; authoring is instructor-only.

| Method | Path | Permissions | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/quizzes` | Authenticated | List quizzes with availability info |
| `POST` | `/api/quizzes` | Instructor | Create a quiz from a bank |
| `GET` | `/api/quizzes/:id` | Authenticated | Quiz metadata |
| `PATCH` | `/api/quizzes/:id` | Instructor | Update title/description/bank/count |
| `DELETE` | `/api/quizzes/:id` | Instructor | Delete (`409` once attempts exist) |
| `POST` | `/api/quizzes/:id/attempts` | Authenticated | Start an attempt |
| `GET` | `/api/quizzes/:id/attempts/me` | Authenticated | The caller's attempts |

Create body:

```json
{
  "title": "Java Fundamentals",
  "description": "Short quiz",
  "questionBankId": "bank-id",
  "questionCount": 3
}
```

A quiz can only be created or updated when its bank holds at least
`questionCount` questions; otherwise the request fails with `400`. Starting an
attempt re-checks this, so a bank that shrank after quiz creation produces a
clear `400` instead of an incomplete attempt.

## Attempts

Every attempt belongs to the authenticated user who started it.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/quizzes/:id/attempts` | Start an attempt (random unique selection) |
| `GET` | `/api/attempts/:id` | Attempt state, **without** answer keys |
| `PUT` | `/api/attempts/:id/answers` | Save/replace draft answers |
| `POST` | `/api/attempts/:id/submit` | Grade and finalise |
| `GET` | `/api/attempts/:id/review` | Full review, only once submitted |

Starting an attempt returns:

```json
{
  "attemptId": "...",
  "quizId": "...",
  "quizTitle": "Java Fundamentals",
  "status": "IN_PROGRESS",
  "score": 0,
  "maxScore": 4,
  "percentage": 0,
  "startedAt": "2026-10-12T10:00:00.000Z",
  "submittedAt": null,
  "questions": [
    {
      "attemptQuestionId": "...",
      "questionId": "...",
      "order": 0,
      "questionText": "Which keyword declares a constant in Java?",
      "type": "SINGLE_CHOICE",
      "options": [{ "id": "A", "text": "final" }],
      "maxPoints": 2,
      "selectedAnswer": null
    }
  ]
}
```

Answer body for `PUT .../answers` (also accepted on submit):

```json
{
  "answers": [
    { "attemptQuestionId": "...", "selectedAnswer": "A" },
    { "questionId": "...", "selectedAnswer": "true" }
  ]
}
```

`selectedAnswer` may be `null` for a blank answer. `SINGLE_CHOICE` answers must
be an option id; `TRUE_FALSE` answers must be `"true"` or `"false"`.

Submit response:

```json
{
  "attemptId": "...",
  "quizId": "...",
  "status": "SUBMITTED",
  "score": 3,
  "maxScore": 4,
  "percentage": 75,
  "startedAt": "2026-10-12T10:00:00.000Z",
  "submittedAt": "2026-10-12T10:05:00.000Z"
}
```

Review response adds the answer key data per question:

```json
{
  "attemptId": "...",
  "quizId": "...",
  "quizTitle": "Java Fundamentals",
  "status": "SUBMITTED",
  "score": 3,
  "maxScore": 4,
  "percentage": 75,
  "startedAt": "2026-10-12T10:00:00.000Z",
  "submittedAt": "2026-10-12T10:05:00.000Z",
  "questions": [
    {
      "attemptQuestionId": "...",
      "questionId": "...",
      "order": 0,
      "questionText": "Which keyword declares a constant in Java?",
      "type": "SINGLE_CHOICE",
      "options": [{ "id": "A", "text": "final" }],
      "maxPoints": 2,
      "selectedAnswer": "A",
      "correctAnswer": "A",
      "isCorrect": true,
      "pointsEarned": 2,
      "explanation": "`final` marks a variable as assign-once."
    }
  ]
}
```

## Rules and guarantees

- **Answer keys are never exposed before submission.** `POST .../attempts`,
  `GET /api/attempts/:id` and the answers endpoint return no `correctAnswer`,
  `explanation`, `isCorrect`, or `pointsEarned` fields. `GET .../review` returns
  `409` until the attempt is submitted.
- **Attempts are immutable once started.** The questions, their order, options,
  points and answer keys are snapshotted into `AttemptQuestion`. Editing or
  deleting the source question later cannot change a past result.
- **Repeated attempts are allowed.** Each attempt draws its own random selection
  of unique questions from the bank (`crypto.randomInt` Fisher-Yates shuffle) and
  is stored independently.
- **Scoring is always server-side** from the snapshot, using Prisma `Decimal`
  arithmetic, with `maxScore` summed from the attempt's question points.
- **Double submission is impossible.** Finalisation is a status-guarded
  `updateMany` inside a transaction; concurrent submits yield one `200` and one
  `409`.

## Environment

See `.env.example`. `DATABASE_URL` is required; `TEST_DATABASE_URL` is optional
and only used by the integration test suite.
