import { createProjectExport } from "@decisionator/core";
import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import type React from "react";
import { useState } from "react";

export interface ExportButtonProps {
  snapshot: ProjectSnapshot;
}

export const ExportButton: React.FC<ExportButtonProps> = ({ snapshot }) => {
  const [exporting, setExporting] = useState(false);

  const handleExport = () => {
    try {
      setExporting(true);
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
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={exporting}
      className="btn btn-outline"
      style={{ fontSize: 13 }}
    >
      {exporting ? "Exporting..." : "Export Project (JSON)"}
    </button>
  );
};
