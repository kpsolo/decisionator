import { createProjectExport } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { Download } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";

export interface ExportButtonProps {
  snapshot: ProjectSnapshot;
}

/** Downloads the project as a `.json` export bundle. */
export function downloadProjectExport(snapshot: ProjectSnapshot) {
  const bundle = createProjectExport({
    project: snapshot.project,
    options: snapshot.options,
    grades: snapshot.grades,
    comments: snapshot.comments,
    rankings: snapshot.rankings,
    outcomes: snapshot.outcomes,
  });

  const jsonStr = JSON.stringify(bundle, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${snapshot.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-export.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ExportButton: React.FC<ExportButtonProps> = ({ snapshot }) => {
  const [exporting, setExporting] = useState(false);

  const handleExport = () => {
    try {
      setExporting(true);
      downloadProjectExport(snapshot);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      isLoading={exporting}
      leftIcon={<Download className="h-3.5 w-3.5" />}
    >
      {exporting ? "Exporting..." : "Export Project (JSON)"}
    </Button>
  );
};
