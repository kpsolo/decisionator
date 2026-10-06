import { AlertTriangle, Boxes, Check, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
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
} from "../../components/ui/dialog.js";
import { Input } from "../../components/ui/input.js";
import { type PluginManifest, validateManifest } from "../../host/module-host.js";
import { PluginSettings } from "./PluginSettings.js";
import {
  type InstalledPlugin,
  getInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
} from "./plugin-registry.js";

export function PluginsPage() {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(() => getInstalledPlugins());
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [installMode, setInstallMode] = useState<"file" | "url">("file");
  const [installUrl, setInstallUrl] = useState("");
  const [_manifestText, setManifestText] = useState("");
  const [pendingManifest, setPendingManifest] = useState<PluginManifest | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [editingSettingsPlugin, setEditingSettingsPlugin] = useState<InstalledPlugin | null>(null);
  const [reviewingPermsPlugin, setReviewingPermsPlugin] = useState<InstalledPlugin | null>(null);

  const refreshPlugins = () => {
    setPlugins(getInstalledPlugins());
  };

  const handleToggleEnable = (plugin: InstalledPlugin) => {
    updatePlugin(plugin.id, { enabled: !plugin.enabled });
    refreshPlugins();
  };

  const handleUninstall = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to uninstall plugin "${name}"?`)) {
      uninstallPlugin(id);
      refreshPlugins();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInstallError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        setManifestText(text);
        const parsed = JSON.parse(text);
        validateManifest(parsed);
        setPendingManifest(parsed);
        setSelectedPermissions(parsed.permissions ? [...parsed.permissions] : []);
      } catch (err) {
        setPendingManifest(null);
        setInstallError(err instanceof Error ? err.message : "Invalid plugin manifest JSON");
      }
    };
    reader.readAsText(file);
  };

  const handleFetchUrl = async () => {
    setInstallError(null);
    if (!installUrl.trim()) return;

    try {
      const res = await fetch(installUrl.trim());
      if (!res.ok) {
        throw new Error(`Failed to fetch from URL: HTTP ${res.status}`);
      }
      const parsed = await res.json();
      validateManifest(parsed);
      setPendingManifest(parsed);
      setSelectedPermissions(parsed.permissions ? [...parsed.permissions] : []);
    } catch (err) {
      setPendingManifest(null);
      setInstallError(err instanceof Error ? err.message : "Failed to load manifest from URL");
    }
  };

  const handleConfirmInstall = () => {
    if (!pendingManifest) return;

    try {
      installPlugin(
        pendingManifest,
        installMode === "file"
          ? { type: "file", filename: pendingManifest.name || "plugin.json" }
          : { type: "url", url: installUrl },
        selectedPermissions
      );

      refreshPlugins();
      setIsInstallOpen(false);
      setPendingManifest(null);
      setInstallUrl("");
      setManifestText("");
      setSelectedPermissions([]);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    }
  };

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" aria-hidden="true" />
            Plugins & Extensions
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage decision strategies, idea sources, and sandboxed extensions (FR-050).
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setIsInstallOpen(true);
            setInstallError(null);
            setPendingManifest(null);
          }}
          leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        >
          Install Plugin
        </Button>
      </div>

      <div className="space-y-4">
        {plugins.map((plugin) => (
          <Card
            key={plugin.id}
            className={`border-l-4 transition-opacity ${
              plugin.enabled ? "border-l-success opacity-100" : "border-l-border opacity-75"
            }`}
          >
            <CardContent className="p-5">
              <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">{plugin.name}</h3>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      v{plugin.version}
                    </Badge>
                    {plugin.source.type === "builtin" && (
                      <Badge variant="secondary" className="text-[11px]">
                        Built-in
                      </Badge>
                    )}
                    <Badge
                      variant={plugin.enabled ? "success" : "secondary"}
                      className="text-[11px]"
                    >
                      {plugin.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>

                  <div className="text-xs font-mono text-muted-foreground">{plugin.id}</div>

                  {plugin.description && (
                    <p className="text-sm text-muted-foreground">{plugin.description}</p>
                  )}

                  {plugin.lastError && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <strong>Error:</strong> {plugin.lastError}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs text-muted-foreground">Permissions:</span>
                    {plugin.grantedPermissions.length > 0 ? (
                      plugin.grantedPermissions.map((perm) => (
                        <span
                          key={perm}
                          className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-mono text-foreground"
                        >
                          {perm}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">None requested</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant={plugin.enabled ? "outline" : "default"}
                    onClick={() => handleToggleEnable(plugin)}
                  >
                    {plugin.enabled ? "Disable" : "Enable"}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setReviewingPermsPlugin(plugin)}
                  >
                    Permissions
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingSettingsPlugin(plugin)}
                  >
                    Settings
                  </Button>

                  {plugin.source.type !== "builtin" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleUninstall(plugin.id, plugin.name)}
                      aria-label={`Uninstall ${plugin.name}`}
                      leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    >
                      Uninstall
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Settings Modal */}
      {editingSettingsPlugin && (
        <PluginSettings
          plugin={editingSettingsPlugin}
          onSave={(newSettings) => {
            updatePlugin(editingSettingsPlugin.id, { settings: newSettings });
            refreshPlugins();
          }}
          onClose={() => setEditingSettingsPlugin(null)}
        />
      )}

      {/* Permissions Review Modal */}
      {reviewingPermsPlugin && (
        <Dialog open onOpenChange={(open) => !open && setReviewingPermsPlugin(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                Permissions: {reviewingPermsPlugin.name}
              </DialogTitle>
              <DialogDescription>
                Review or revoke capabilities granted to this plugin.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {reviewingPermsPlugin.manifest.permissions &&
              reviewingPermsPlugin.manifest.permissions.length > 0 ? (
                reviewingPermsPlugin.manifest.permissions.map((perm) => {
                  const isChecked = reviewingPermsPlugin.grantedPermissions.includes(perm);
                  return (
                    <label
                      key={perm}
                      className="flex items-center gap-2.5 rounded-lg border border-border p-2.5 text-xs hover:bg-muted/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const updated = isChecked
                            ? reviewingPermsPlugin.grantedPermissions.filter((p) => p !== perm)
                            : [...reviewingPermsPlugin.grantedPermissions, perm];
                          const updatedRecord = updatePlugin(reviewingPermsPlugin.id, {
                            grantedPermissions: updated,
                          });
                          if (updatedRecord) setReviewingPermsPlugin({ ...updatedRecord });
                          refreshPlugins();
                        }}
                        className="rounded border-border text-primary focus:ring-ring"
                      />
                      <span className="font-mono text-foreground font-medium">{perm}</span>
                    </label>
                  );
                })
              ) : (
                <div className="text-xs text-muted-foreground py-2">
                  No optional permissions declared by this plugin.
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => setReviewingPermsPlugin(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Install Plugin Modal */}
      {isInstallOpen && (
        <Dialog open onOpenChange={(open) => !open && setIsInstallOpen(false)}>
          <DialogContent
            className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
            aria-describedby={undefined}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" aria-hidden="true" />
                Install Plugin
              </DialogTitle>
            </DialogHeader>

            {/* Unreviewed Source Warning */}
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <strong className="text-foreground">Unreviewed Source Warning:</strong>
                <p className="text-muted-foreground leading-relaxed">
                  Third-party plugins execute in an isolated sandbox. Only install plugins from
                  creators you trust. Review all requested permissions carefully before installing
                  (FR-061).
                </p>
              </div>
            </div>

            {/* Mode selection */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={installMode === "file" ? "default" : "outline"}
                onClick={() => {
                  setInstallMode("file");
                  setPendingManifest(null);
                  setInstallError(null);
                }}
              >
                Install from File
              </Button>
              <Button
                type="button"
                size="sm"
                variant={installMode === "url" ? "default" : "outline"}
                onClick={() => {
                  setInstallMode("url");
                  setPendingManifest(null);
                  setInstallError(null);
                }}
              >
                Install from URL
              </Button>
            </div>

            {installMode === "file" ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="plugin-file-input"
                  className="block text-xs font-medium text-foreground"
                >
                  Select plugin manifest file (
                  <code className="font-mono text-xs">decisionator-plugin.json</code>):
                </label>
                <input
                  id="plugin-file-input"
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
                  className="w-full text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border file:border-input file:text-xs file:font-medium file:bg-background hover:file:bg-accent cursor-pointer"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label
                  htmlFor="plugin-url-input"
                  className="block text-xs font-medium text-foreground"
                >
                  Enter manifest HTTPS URL:
                </label>
                <div className="flex gap-2">
                  <Input
                    id="plugin-url-input"
                    type="url"
                    placeholder="https://example.com/decisionator-plugin.json"
                    value={installUrl}
                    onChange={(e) => setInstallUrl(e.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={handleFetchUrl}>
                    Load
                  </Button>
                </div>
              </div>
            )}

            {installError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <X className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{installError}</span>
              </div>
            )}

            {/* Manifest Preview & Permission Review */}
            {pendingManifest && (
              <Card className="bg-muted/30">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">{pendingManifest.name}</CardTitle>
                    <Badge variant="outline" className="text-[11px] font-mono">
                      v{pendingManifest.version}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs font-mono">
                    {pendingManifest.id}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  {(pendingManifest as { description?: string }).description && (
                    <p className="text-xs text-muted-foreground">
                      {(pendingManifest as { description?: string }).description}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-foreground">Permission Review:</div>
                    <p className="text-[11px] text-muted-foreground">
                      Select which capabilities to grant this plugin:
                    </p>

                    {pendingManifest.permissions && pendingManifest.permissions.length > 0 ? (
                      <div className="space-y-1.5">
                        {pendingManifest.permissions.map((perm: string) => (
                          <label
                            key={perm}
                            className="flex items-center gap-2 rounded-md border border-border bg-card p-2 text-xs hover:bg-muted/40 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedPermissions.includes(perm)}
                              onChange={() => togglePermission(perm)}
                              className="rounded border-border text-primary focus:ring-ring"
                            />
                            <span className="font-mono text-foreground">{perm}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        This plugin requests no sensitive permissions.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsInstallOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!pendingManifest}
                onClick={handleConfirmInstall}
                leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
              >
                Confirm & Install
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
