export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
}

export interface Quiz {
  id: string;
  title: string;
  description: string;
  questions: Question[];
}

export type QuizSummary = Omit<Quiz, "questions">;

export interface PublicQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface PublicQuiz {
  id: string;
  title: string;
  description: string;
  questions: PublicQuestion[];
}

export interface QuizAnswer {
  questionId: string;
  answer: string;
}

export interface QuizSubmission {
  answers: QuizAnswer[];
}

export interface QuizResult {
  quizId: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
}
