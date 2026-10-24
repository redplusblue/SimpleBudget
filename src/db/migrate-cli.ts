import { runMigrations } from "./migrate";
import { createDb, openSqlite } from "./open";

const file = process.env.DATABASE_PATH ?? "./data/simplebudget.db";
const sqlite = openSqlite(file);
runMigrations(createDb(sqlite));
sqlite.close();
console.log(`Migrations applied to ${file}`);
