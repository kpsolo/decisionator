import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { Download } from "lucide-react";
import type React from "react";
import { Button } from "../../components/ui/button.js";
import { type ExportFormat, downloadProjectExport } from "./project-file.js";

export { downloadProjectExport } from "./project-file.js";

export interface ExportButtonProps {
  snapshot: ProjectSnapshot;
  format?: ExportFormat;
}

export const ExportButton: React.FC<ExportButtonProps> = ({ snapshot, format = "json" }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={() => downloadProjectExport(snapshot, format)}
    leftIcon={<Download className="h-3.5 w-3.5" />}
  >
    {format === "xlsx" ? "Export Project (Excel / Google Sheets)" : "Export Project (JSON)"}
  </Button>
);
