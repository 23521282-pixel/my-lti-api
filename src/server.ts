import { createApp } from "./app.js";

/**
 * Server bootstrap. All application wiring lives in `app.ts`; this file only
 * starts the HTTP listener so the app can also be imported by tests.
 */
const port = Number(process.env.PORT) || 3000;

createApp().listen(port, () => {
  console.log(`LTI Tool running on port ${port}`);
});
