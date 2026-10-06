import { type ProjectExportV1, ProjectExportV1Schema } from "@decisionator/core";
import type { ProjectSnapshot, ProjectStore } from "@decisionator/plugin-sdk";
import { AlertCircle, ArrowRightLeft, CheckCircle2, Download, FileUp } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { copyEntriesAsAuthors } from "./copy-entries.js";

export interface MoveProjectProps {
  currentStore: ProjectStore;
  targetStore: ProjectStore;
  currentSnapshot?: ProjectSnapshot;
  onMoved?: (newRef: { store: string; id: string }) => void;
}

export const MoveProject: React.FC<MoveProjectProps> = ({
  currentStore,
  targetStore,
  currentSnapshot,
  onMoved,
}) => {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileInputJson, setFileInputJson] = useState<string>("");

  const handleExportToFile = () => {
    if (!currentSnapshot) return;
    const bundle: ProjectExportV1 = {
      format: "decisionator.project/v1",
      exportedAt: new Date().toISOString(),
      project: currentSnapshot.project,
      options: currentSnapshot.options,
      grades: currentSnapshot.grades,
      comments: currentSnapshot.comments,
      rankings: currentSnapshot.rankings,
      outcomes: currentSnapshot.outcomes,
    };

    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSnapshot.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.decisionator.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (jsonString: string) => {
    try {
      setMoving(true);
      setError(null);
      const parsed = JSON.parse(jsonString);
      const validated = ProjectExportV1Schema.parse(parsed);

      const newRef = await targetStore.createProject({
        title: validated.project.title,
        description: validated.project.description,
        voting: validated.project.voting,
        options: validated.options,
      });

      // Keep every collaborator's votes and comments under their own name.
      await copyEntriesAsAuthors(targetStore, newRef, validated);

      setSuccess(`Project migrated to ${targetStore.id} successfully!`);
      if (onMoved) {
        onMoved(newRef);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import project");
    } finally {
      setMoving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileInputJson(text);
    };
    reader.readAsText(file);
  };

  const handleDirectTransfer = async () => {
    if (!currentSnapshot) return;
    try {
      setMoving(true);
      setError(null);

      const newRef = await targetStore.createProject({
        title: currentSnapshot.project.title,
        description: currentSnapshot.project.description,
        voting: currentSnapshot.project.voting,
        options: currentSnapshot.options,
      });

      await copyEntriesAsAuthors(targetStore, newRef, currentSnapshot);

      setSuccess(`Project transferred directly from ${currentStore.id} to ${targetStore.id}`);
      if (onMoved) {
        onMoved(newRef);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Direct transfer failed");
    } finally {
      setMoving(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Every close path (Done, X, Esc, outside click) clears the last result, as before.
      setError(null);
      setSuccess(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          leftIcon={<ArrowRightLeft className="h-4 w-4" aria-hidden />}
        >
          Move / Export Project
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" aria-hidden />
            Move / Migrate Project (FR-072)
          </DialogTitle>
          <DialogDescription>
            Migrate decisions seamlessly between Google Sheets and Local-First mode using standard{" "}
            <code className="text-foreground font-mono text-xs">decisionator.project/v1</code>{" "}
            bundles.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <output className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <span>{success}</span>
          </output>
        )}

        <div className="space-y-3 py-1">
          {currentSnapshot && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-semibold">Option A: Direct Transfer</CardTitle>
                <CardDescription className="text-xs">
                  Copy project state directly to {targetStore.id}.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleDirectTransfer}
                  disabled={moving}
                  isLoading={moving}
                >
                  {moving ? "Transferring..." : `Transfer to ${targetStore.id}`}
                </Button>
              </CardContent>
            </Card>
          )}

          {currentSnapshot && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-semibold">Option B: Export to File</CardTitle>
                <CardDescription className="text-xs">
                  Download <code className="font-mono text-xs">decisionator.project/v1</code> JSON
                  file for backup or import elsewhere.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExportToFile}
                  leftIcon={<Download className="h-4 w-4" aria-hidden />}
                >
                  Download JSON Bundle
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">Option C: Import from File</CardTitle>
              <CardDescription className="text-xs">
                Import a <code className="font-mono text-xs">decisionator.project/v1</code> JSON
                bundle into {targetStore.id}.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Project JSON bundle file"
                onChange={handleFileUpload}
                className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border file:border-input file:text-xs file:font-medium file:bg-background hover:file:bg-accent cursor-pointer"
              />
              {fileInputJson && (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleImportJson(fileInputJson)}
                    disabled={moving}
                    isLoading={moving}
                    leftIcon={<FileUp className="h-4 w-4" aria-hidden />}
                  >
                    {moving ? "Importing..." : "Execute Import"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
