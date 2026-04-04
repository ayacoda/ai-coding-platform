// Vercel serverless entry point — re-exports the Express app.
// app.listen() is skipped because server/index.js only calls it when run directly.
export { default } from '../server/index.js';
