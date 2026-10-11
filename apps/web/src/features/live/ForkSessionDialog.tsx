import type { ProjectRef, ProjectSnapshot } from "@decisionator/plugin-sdk";
import { GitFork, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { toast } from "../../components/ui/use-toast.js";
import { useStorage } from "../../storage/StorageContext.js";
import { restoreProject, snapshotToExport } from "../project/project-file.js";

export interface ForkSessionDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: ProjectSnapshot;
  onForked?(ref: ProjectRef): void;
}

function getStoreLabel(id: string): string {
  if (id.includes("file") || id.includes("local")) return "Local File / IndexedDB";
  if (id.includes("google-sheets")) return "Google Sheets";
  if (id.includes("firestore")) return "Firestore";
  return id;
}

export function ForkSessionDialog({
  open,
  onOpenChange,
  snapshot,
  onForked,
}: ForkSessionDialogProps) {
  const navigate = useNavigate();
  const { registeredStores, activeStoreId } = useStorage();
  const [selectedStoreId, setSelectedStoreId] = useState(
    activeStoreId || registeredStores[0]?.id || "file"
  );
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFork = async () => {
    try {
      setForking(true);
      setError(null);
      const targetStore =
        registeredStores.find((s) => s.id === selectedStoreId) ?? registeredStores[0];
      if (!targetStore) {
        throw new Error("No destination store selected or available.");
      }
      if (targetStore.id.includes("google-sheets") && typeof targetStore.signIn === "function") {
        await targetStore.signIn({ interactive: true });
      }
      const bundle = snapshotToExport(snapshot);
      const ref = await restoreProject(targetStore, bundle);
      toast({
        title: "Saved to your workspace",
        description: `Created new project "${snapshot.project.title}" in ${getStoreLabel(targetStore.id)}.`,
      });
      onOpenChange(false);
      const storePrefix = ref.store || targetStore.id;
      const targetPath = `/p/${storePrefix}/${ref.id}`;
      if (onForked) {
        onForked(ref);
      } else {
        navigate(targetPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save session to workspace.");
    } finally {
      setForking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="h-5 w-5 text-primary" aria-hidden />
            <span>Save to my workspace</span>
          </DialogTitle>
          <DialogDescription className="text-left text-sm">
            Create an independent permanent copy of this deliberation in your workspace. All
            options, ratings, comments, and voting history will be preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="fork-destination-store"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Destination Storage
            </label>
            <NativeSelect
              id="fork-destination-store"
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              disabled={forking}
            >
              {registeredStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {getStoreLabel(store.id)}
                </option>
              ))}
            </NativeSelect>
          </div>

          {error && (
            <p className="rounded bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={forking}>
            Cancel
          </Button>
          <Button onClick={handleFork} disabled={forking}>
            {forking && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Save Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
