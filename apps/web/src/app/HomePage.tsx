import { ProjectExportV1Schema } from "@decisionator/core";
import type { ProjectSummary } from "@decisionator/plugin-sdk";
import type { FileProjectStore } from "@decisionator/store-file";
import { ArrowRight, Clock, FileJson, FolderOpen, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { getStorageManager } from "../storage/storage-manager.js";
import { getDatabase } from "../sync/db.js";

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        setLoading(true);
        const sm = getStorageManager();
        const all = await sm.listAllProjects();

        // Also check offline cached projects in IndexedDB if any
        const db = await getDatabase();
        const cachedSnapshots = await db.getAll("snapshots");
        const cachedSummaries: ProjectSummary[] = cachedSnapshots
          .filter((s) => !all.some((p) => p.ref.id === s.projectRefId.replace(/^[a-z-]+:/, "")))
          .map((s) => ({
            ref: {
              store: s.projectRefId.startsWith("file:") ? "file" : "google-sheets",
              id: s.projectRefId.replace(/^[a-z-]+:/, ""),
            },
            title: s.snapshot.project.title,
            owner: "",
            updatedAt: s.cachedAt,
          }));

        setProjects([...all, ...cachedSummaries]);
      } catch {
        // Fallback gracefully
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, []);

  const handleOpenJsonContent = async (jsonText: string, fileHandle?: FileSystemFileHandle) => {
    try {
      setError(null);
      const parsed = JSON.parse(jsonText);
      const validated = ProjectExportV1Schema.parse(parsed);

      const sm = getStorageManager();
      const fileStore = (sm.getStore("file") ||
        sm.getStore("org.decisionator.store.file")) as FileProjectStore;

      const ref = await fileStore.createProject({
        title: validated.project.title,
        description: validated.project.description,
        options: validated.options,
        voting: validated.project.voting,
      });

      if (fileHandle) {
        fileStore.setFileHandle(ref.id, fileHandle);
      }

      // Restore votes, comments, outcomes
      const entries: Parameters<typeof fileStore.append>[1] = [];
      for (const g of validated.grades) {
        entries.push({ kind: "grade", optionId: g.optionId, value: g.value });
      }
      for (const c of validated.comments) {
        entries.push({ kind: "comment", optionId: c.optionId, body: c.body });
      }
      for (const r of validated.rankings) {
        entries.push({ kind: "ranking", ranking: r.ranking, round: r.round });
      }
      for (const o of validated.outcomes) {
        entries.push({ kind: "outcome", outcome: o });
      }
      if (entries.length > 0) {
        await fileStore.append(ref, entries);
      }

      navigate(`/p/file/${ref.id}`);
    } catch (err: unknown) {
      setError(`Failed to open decision file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenFilePicker = async () => {
    try {
      if ("showOpenFilePicker" in window) {
        const [handle] = await (
          window as unknown as {
            showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandle[]>;
          }
        ).showOpenFilePicker({
          types: [
            {
              description: "Deci Project Files (*.decisionator.json, *.json)",
              accept: { "application/json": [".json", ".decisionator.json"] },
            },
          ],
        });
        if (handle) {
          const file = await handle.getFile();
          const text = await file.text();
          await handleOpenJsonContent(text, handle);
          return;
        }
      }
    } catch {
      // User cancelled or unsupported
    }
    // Fallback to standard file input
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      await handleOpenJsonContent(text);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const text = await file.text();
      await handleOpenJsonContent(text);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive font-medium shadow-xs"
        >
          {error}
        </div>
      )}

      {/* Hero Welcome Card */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary font-medium text-xs tracking-wider uppercase mb-1">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Modular Decision Engine</span>
          </div>
          <h2 className="text-2xl font-bold leading-none tracking-tight">My Decision Projects</h2>
          <CardDescription className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            Modular Decision Engine for Teams. Runs locally in your browser, saves to your active
            storage, and works 100% offline with local files.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="default" asChild>
              <Link to="/new">+ New Decision Project</Link>
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenFilePicker}
              leftIcon={<FolderOpen className="h-4 w-4" />}
            >
              Open from File...
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept=".json,.decisionator.json"
              className="hidden"
            />
          </div>
        </CardContent>
      </Card>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragActive
            ? "border-primary bg-primary/5 text-primary"
            : "border-border/80 hover:border-border bg-card/50 text-muted-foreground"
        }`}
      >
        <FileJson className="h-5 w-5 opacity-70" />
        <span className="text-sm font-medium">
          Tip: Drag and drop any{" "}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-foreground">
            .decisionator.json
          </code>{" "}
          file here to open it immediately.
        </span>
      </div>

      {/* Projects List */}
      {loading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent className="flex flex-col items-center justify-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-1">
              ⚖️
            </div>
            <p className="text-sm text-muted-foreground max-w-sm">
              No decision projects found yet.
            </p>
            <Button variant="outline" asChild className="mt-2">
              <Link to="/new">Create your first decision project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Recent Projects ({projects.length})
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {projects.map((p) => {
              const storePrefix = p.ref.store || "file";
              const openUrl = `/p/${storePrefix}/${p.ref.id}`;
              const badgeVariant =
                storePrefix === "file"
                  ? "success"
                  : storePrefix === "firestore"
                    ? "warning"
                    : "default";

              return (
                <div
                  key={`${storePrefix}:${p.ref.id}`}
                  className="group flex items-center justify-between p-3.5 rounded-lg border border-border bg-card/60 hover:bg-accent/40 hover:border-border transition-all shadow-2xs"
                >
                  <div className="space-y-1 pr-4 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground truncate text-sm">
                        {p.title}
                      </span>
                      <Badge
                        variant={badgeVariant}
                        className="uppercase text-[10px] tracking-wider font-semibold"
                      >
                        {storePrefix}
                      </Badge>
                    </div>
                    {p.updatedAt && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Updated: {new Date(p.updatedAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="shrink-0 group-hover:bg-accent group-hover:text-accent-foreground"
                  >
                    <Link to={openUrl} className="flex items-center gap-1">
                      <span>Open</span>
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default HomePage;
