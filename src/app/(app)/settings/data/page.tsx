import { Database, FileSpreadsheet } from "lucide-react";
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
            Every transaction as a CSV file you can open in a spreadsheet: date, account, payee, amount, category,
            splits, tags, notes and status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="h-11 md:h-9">
            <a href="/api/export/transactions" download>
              <FileSpreadsheet /> Download CSV
            </a>
          </Button>
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
