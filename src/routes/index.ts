import { Router } from "express";
import { attemptRouter } from "./attempt.routes.js";
import { questionBankRouter, questionRouter } from "./questionBank.routes.js";
import { quizRouter } from "./quiz.routes.js";

/**
 * All `/api` routers. Mounted behind `requireLtiSession` in `app.ts`, so every
 * handler here can rely on a verified LTI identity on the request.
 */
export const apiRouter = Router();

apiRouter.use("/question-banks", questionBankRouter);
apiRouter.use("/questions", questionRouter);
apiRouter.use("/quizzes", quizRouter);
apiRouter.use("/attempts", attemptRouter);
