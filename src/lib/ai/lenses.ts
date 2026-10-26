// Client-safe: the Assistant UI lists these. A lens is a focused prompt plus the tools and proposals it may use.

export const LENS_IDS = ["general", "spending", "subscriptions", "cashflow", "accounts", "goals", "cleanup"] as const;
export type LensId = (typeof LENS_IDS)[number];

export type ProposeToolName = "propose_rule" | "propose_memory" | "propose_target";

export interface Lens {
  id: LensId;
  label: string;
  /** One line shown under the chip. */
  description: string;
  /** Appended to the base system prompt. */
  instructions: string;
  /** Read tools this lens may call (names from LLM_TOOLS); propose tools are listed separately. */
  tools: string[];
  proposals: ProposeToolName[];
  /** Example questions shown as buttons in an empty chat. */
  starters: string[];
}

const ALL_READ = [
  "get_facts",
  "get_goals",
  "get_category_totals",
  "search_transactions",
  "get_period_report",
  "get_monthly_trend",
  "get_recurring",
  "get_year_summary",
  "get_merchant_history",
  "get_merchant_trace",
];

export const LENSES: Record<LensId, Lens> = {
  general: {
    id: "general",
    label: "General",
    description: "Anything about your money.",
    instructions:
      "Answer any question about the owner's money. Start from the summary; call tools when it doesn't answer the question. Compare with earlier periods before calling something unusual.",
    tools: ALL_READ,
    proposals: ["propose_rule", "propose_memory", "propose_target"],
    starters: [
      "How am I doing this month?",
      "Where did my money go last month?",
      "What changed compared with my usual spending?",
      "Is there anything I should look at?",
    ],
  },
  spending: {
    id: "spending",
    label: "Spending",
    description: "Categories, merchants and changes.",
    instructions:
      "Focus on where money goes: categories, merchants, changes against last month and the 3-month average, unusual purchases. Quantify every claim with figures from the data. Suggest at most two concrete actions.",
    tools: [
      "get_facts",
      "get_period_report",
      "get_monthly_trend",
      "get_category_totals",
      "get_merchant_history",
      "get_merchant_trace",
      "search_transactions",
    ],
    proposals: ["propose_target", "propose_memory"],
    starters: [
      "Which categories grew the most?",
      "What are my biggest merchants this month?",
      "Was anything unusual this month?",
      "Where could I realistically cut back?",
    ],
  },
  subscriptions: {
    id: "subscriptions",
    label: "Subscriptions",
    description: "Recurring charges and price rises.",
    instructions:
      "Focus on recurring charges: total monthly and yearly cost, price increases, duplicates, ones that look unused or cancelled. Name the merchant and the amount for each point.",
    tools: ["get_facts", "get_recurring", "get_merchant_history", "get_merchant_trace", "search_transactions"],
    proposals: ["propose_memory"],
    starters: [
      "What do my subscriptions cost per year?",
      "Which subscriptions went up in price?",
      "Do any look cancelled or unused?",
    ],
  },
  cashflow: {
    id: "cashflow",
    label: "Cash flow",
    description: "Income, savings rate and upcoming bills.",
    instructions:
      "Focus on income versus spending, savings rate, upcoming bills and whether the month will end positive. Use the forecast and the upcoming bills.",
    tools: ["get_facts", "get_period_report", "get_monthly_trend", "get_recurring"],
    proposals: ["propose_memory"],
    starters: ["Will this month end positive?", "What bills are coming up?", "How has my savings rate changed?"],
  },
  accounts: {
    id: "accounts",
    label: "Accounts",
    description: "Manual accounts, cards and balances.",
    instructions:
      "Focus on accounts: manual accounts that need updating, credit utilization, low balances. If you were not given account names, refer to accounts generically and say that account details are off in settings.",
    tools: ["get_facts"],
    proposals: ["propose_memory"],
    starters: ["Which accounts need attention?", "Are any manual accounts out of date?"],
  },
  goals: {
    id: "goals",
    label: "Goals",
    description: "Progress toward savings goals.",
    instructions: "Focus on savings goals: progress, whether the pace will hit the date, how much per month is needed.",
    tools: ["get_facts", "get_goals", "get_period_report"],
    proposals: ["propose_memory", "propose_target"],
    starters: ["Am I on track for my goals?", "How much per month do I need to save?"],
  },
  cleanup: {
    id: "cleanup",
    label: "Cleanup",
    description: "Uncategorized, duplicates and rules.",
    instructions:
      "Focus on data quality: uncategorized transactions, merchants without rules, duplicate charges. Prefer proposing a rule over describing a fix; a rule fixes it for good.",
    tools: ["get_facts", "search_transactions", "get_merchant_history"],
    proposals: ["propose_rule", "propose_memory"],
    starters: [
      "Which merchants still need a category?",
      "Are there duplicate charges?",
      "Make a rule for my coffee purchases",
    ],
  },
};

export const isLensId = (v: unknown): v is LensId => LENS_IDS.includes(v as LensId);
