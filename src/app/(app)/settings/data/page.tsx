import { Database, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Export & backup" };

export default function DataPage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Export transactions</CardTitle>
          <CardDescription>
            Every transaction as a file: date, account, payee, amount, category, splits, tags, notes and status. Text is
            an easy-to-read aligned list; CSV and TSV open in a spreadsheet; JSON is for scripts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            { f: "txt", label: "Download TXT", Icon: FileText },
            { f: "csv", label: "Download CSV", Icon: FileSpreadsheet },
            { f: "tsv", label: "Download TSV", Icon: FileSpreadsheet },
            { f: "json", label: "Download JSON", Icon: FileJson },
          ].map(({ f, label, Icon }) => (
            <Button key={f} asChild variant="outline" className="h-11 md:h-9">
              <a href={`/api/export/transactions?format=${f}`} download>
                <Icon /> {label}
              </a>
            </Button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Back up everything</CardTitle>
          <CardDescription>
            A copy of the whole database (a SQLite file). It includes your encrypted bank connection and password hash,
            so keep it somewhere private. To restore, stop the app and put the file back in the data folder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="h-11 md:h-9">
            <a href="/api/export/backup" download>
              <Database /> Download backup
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
