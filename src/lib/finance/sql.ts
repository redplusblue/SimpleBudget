import { sql } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * The date a transaction "belongs" to. Pending items have no posted date (it's 0), so they use the
 * purchase date, falling back to when we first saw them.
 */
export const effectiveDateSql = sql<number>`CASE WHEN ${transactions.pending} = 1 THEN COALESCE(${transactions.transactedAt}, ${transactions.importedAt}) ELSE ${transactions.posted} END`;
