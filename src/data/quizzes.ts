import type { Quiz } from "../types/quiz.js";

export const MOCK_QUIZZES: Quiz[] = [
  {
    id: "java-basics",
    title: "Java Basics",
    description: "Fundamental Java concepts including JVM, OOP, and data types.",
    questions: [
      {
        id: "q1",
        question: "What does JVM stand for?",
        options: [
          "A. Java Virtual Machine",
          "B. Java Variable Method",
          "C. Joint Virtual Module",
          "D. Java Visual Model",
        ],
        correctAnswer: "A",
      },
      {
        id: "q2",
        question: "Which keyword is used to create an instance of a class in Java?",
        options: [
          "A. class",
          "B. new",
          "C. instance",
          "D. create",
        ],
        correctAnswer: "B",
      },
      {
        id: "q3",
        question: "Which data type is used to store true or false values in Java?",
        options: [
          "A. int",
          "B. String",
          "C. boolean",
          "D. float",
        ],
        correctAnswer: "C",
      },
      {
        id: "q4",
        question: "Which OOP principle allows a class to inherit properties from another class?",
        options: [
          "A. Polymorphism",
          "B. Encapsulation",
          "C. Inheritance",
          "D. Abstraction",
        ],
        correctAnswer: "C",
      },
    ],
  },
  {
    id: "sql-basics",
    title: "SQL Basics",
    description: "Basic SQL queries, relational database concepts, and clauses.",
    questions: [
      {
        id: "q1",
        question: "Which SQL statement is used to extract data from a database?",
        options: [
          "A. SELECT",
          "B. GET",
          "C. EXTRACT",
          "D. OPEN",
        ],
        correctAnswer: "A",
      },
      {
        id: "q2",
        question: "Which clause is used to filter records in a SQL query?",
        options: [
          "A. GROUP BY",
          "B. ORDER BY",
          "C. WHERE",
          "D. HAVING",
        ],
        correctAnswer: "C",
      },
      {
        id: "q3",
        question: "Which SQL command is used to add new rows to a table?",
        options: [
          "A. ADD ROW",
          "B. INSERT INTO",
          "C. UPDATE",
          "D. CREATE ROW",
        ],
        correctAnswer: "B",
      },
      {
        id: "q4",
        question: "Which clause sorts the query results in ascending or descending order?",
        options: [
          "A. SORT BY",
          "B. ALIGN BY",
          "C. ORDER BY",
          "D. GROUP BY",
        ],
        correctAnswer: "C",
      },
    ],
  },
  {
    id: "lti-basics",
    title: "LTI 1.3 Basics",
    description: "Core concepts of the 1EdTech LTI 1.3 standard, OIDC flow, and security.",
    questions: [
      {
        id: "q1",
        question: "Which authentication standard forms the foundation of LTI 1.3 launches?",
        options: [
          "A. OAuth 1.0a",
          "B. OpenID Connect (OIDC)",
          "C. Basic HTTP Auth",
          "D. SAML 1.0",
        ],
        correctAnswer: "B",
      },
      {
        id: "q2",
        question: "What mechanism does the LTI Tool use to verify the LMS id_token signature?",
        options: [
          "A. Shared password",
          "B. Asymmetric RSA / JWKS public key verification",
          "C. MD5 checksum",
          "D. Client IP allowlist",
        ],
        correctAnswer: "B",
      },
      {
        id: "q3",
        question: "What is the primary purpose of the 'nonce' in an LTI 1.3 launch?",
        options: [
          "A. Encrypt the database records",
          "B. Prevent replay attacks",
          "C. Store student grades",
          "D. Compress the launch payload",
        ],
        correctAnswer: "B",
      },
      {
        id: "q4",
        question: "In an LTI 1.3 integration, what role does Cohota LMS represent?",
        options: [
          "A. LTI Tool",
          "B. LTI Platform",
          "C. Learning Record Store",
          "D. Identity Provider Only",
        ],
        correctAnswer: "B",
      },
    ],
  },
];
