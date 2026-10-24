export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Opening the DB runs migrations, so the schema is ready before the first request.
    const { getDb } = await import("./db/client");
    getDb();
    const { startScheduler } = await import("./lib/simplefin/scheduler");
    startScheduler();
  }
}
