import Form from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { CheckCircle2, Settings } from "lucide-react";
import React, { useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import type { InstalledPlugin } from "./plugin-registry.js";

export interface PluginSettingsProps {
  plugin: InstalledPlugin;
  onSave: (settings: Record<string, unknown>) => void;
  onClose: () => void;
}

export function PluginSettings({ plugin, onSave, onClose }: PluginSettingsProps) {
  const settingsSchema = (plugin.manifest as { settingsSchema?: RJSFSchema }).settingsSchema;
  const settingsUiSchema = (plugin.manifest as { settingsUiSchema?: UiSchema }).settingsUiSchema;

  const [formData, setFormData] = useState<Record<string, unknown>>(() => ({
    ...plugin.settings,
  }));
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSubmit = (data: { formData?: Record<string, unknown> }) => {
    const updated = data.formData ?? {};
    setFormData(updated);
    onSave(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" aria-hidden="true" />
            Settings: {plugin.name}
          </DialogTitle>
          <DialogDescription>
            v{plugin.version} (<span className="font-mono text-xs">{plugin.id}</span>)
          </DialogDescription>
        </DialogHeader>

        {saveSuccess && (
          <output className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Settings saved successfully.</span>
          </output>
        )}

        {settingsSchema ? (
          <div>
            <p className="text-xs text-muted-foreground mb-4">
              Configure preferences generated dynamically from the plugin schema (FR-053).
            </p>
            <Form
              schema={settingsSchema}
              uiSchema={settingsUiSchema}
              validator={validator}
              formData={formData}
              onSubmit={handleSubmit}
            >
              <div className="mt-5 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit">Save Settings</Button>
              </div>
            </Form>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground py-4">
              This plugin does not declare any configurable settings.
            </p>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
