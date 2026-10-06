import { CheckCircle2, Database, FileText, Flame, HardDrive, KeyRound, Save } from "lucide-react";
import React, { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { cn } from "../../lib/utils.js";
import { useStorage } from "../../storage/StorageContext.js";

const providerClass = (active: boolean) =>
  cn(
    "rounded-lg border p-4 transition-colors",
    active ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:bg-accent/30"
  );

export function StorageSettings() {
  const { storageManager, activeStoreId, setActiveStoreId } = useStorage();
  const [config, setConfig] = useState(() => storageManager.getConfig());
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [firebaseApiKey, setFirebaseApiKey] = useState(
    (config.configuredStores?.firestore?.apiKey as string) || ""
  );
  const [firebaseProjectId, setFirebaseProjectId] = useState(
    (config.configuredStores?.firestore?.projectId as string) || ""
  );
  const [firebaseAppId, setFirebaseAppId] = useState(
    (config.configuredStores?.firestore?.appId as string) || ""
  );

  const handleSelectActive = (storeId: string) => {
    setActiveStoreId(storeId);
    setSavedMessage(`Active storage switched to ${storeId.toUpperCase()}`);
    setTimeout(() => setSavedMessage(null), 3000);
  };

  const handleSaveFirebaseConfig = () => {
    const newConfig = {
      ...config,
      configuredStores: {
        ...config.configuredStores,
        firestore: {
          apiKey: firebaseApiKey,
          authDomain: `${firebaseProjectId}.firebaseapp.com`,
          projectId: firebaseProjectId,
          appId: firebaseAppId,
        },
      },
    };
    storageManager.saveConfig(newConfig);
    setConfig(newConfig);
    setSavedMessage("Firestore configuration saved successfully!");
    setTimeout(() => setSavedMessage(null), 3000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
          <Database className="h-4 w-4" aria-hidden />
          <span>Universal Storage</span>
        </div>
        <CardTitle className="text-xl font-bold">Storage & Persistence</CardTitle>
        <CardDescription className="mt-1">
          Choose where your decision projects are saved by default. When no remote storage is
          connected, Deci automatically saves directly to local files on your device.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {savedMessage && (
          <output className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
            <span>{savedMessage}</span>
          </output>
        )}

        {/* Local File Provider */}
        <div className={providerClass(activeStoreId === "file")}>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <HardDrive className="h-4 w-4 text-success" aria-hidden />
                <strong className="text-sm font-semibold text-foreground">
                  Local File Storage
                </strong>
                <Badge variant="success" className="py-0 text-[10px]">
                  OFFLINE-FIRST
                </Badge>
                {activeStoreId === "file" && (
                  <Badge variant="default" className="py-0 text-[10px] font-bold">
                    ACTIVE
                  </Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Zero-setup, private storage on your hard drive (.decisionator.json). No accounts or
                network required.
              </p>
            </div>

            {activeStoreId !== "file" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSelectActive("file")}
                className="shrink-0 text-xs"
              >
                Set as Active
              </Button>
            )}
          </div>
        </div>

        {/* Google Sheets Provider */}
        <div className={providerClass(activeStoreId === "google-sheets")}>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-primary" aria-hidden />
                <strong className="text-sm font-semibold text-foreground">
                  Google Sheets & Drive
                </strong>
                {activeStoreId === "google-sheets" && (
                  <Badge variant="default" className="py-0 text-[10px] font-bold">
                    ACTIVE
                  </Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Store projects in Google Sheets in your Drive with Drive link sharing and password
                protection.
              </p>
            </div>

            {activeStoreId !== "google-sheets" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSelectActive("google-sheets")}
                className="shrink-0 text-xs"
              >
                Set as Active
              </Button>
            )}
          </div>
        </div>

        {/* Firestore Provider */}
        <div className={cn(providerClass(activeStoreId === "firestore"), "space-y-4")}>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Flame className="h-4 w-4 text-warning" aria-hidden />
                <strong className="text-sm font-semibold text-foreground">
                  Firebase Firestore
                </strong>
                <Badge variant="warning" className="py-0 text-[10px]">
                  REAL-TIME SYNC
                </Badge>
                {activeStoreId === "firestore" && (
                  <Badge variant="default" className="py-0 text-[10px] font-bold">
                    ACTIVE
                  </Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Real-time subsecond synchronization across collaborators via Firebase Firestore.
              </p>
            </div>

            {activeStoreId !== "firestore" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSelectActive("firestore")}
                className="shrink-0 text-xs"
              >
                Set as Active
              </Button>
            )}
          </div>

          {/* Firebase credentials configuration form */}
          <div className="space-y-3 rounded-lg border border-border bg-background p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden />
              <span>Firebase Configuration</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="fb-project-id"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Project ID
                </label>
                <Input
                  id="fb-project-id"
                  type="text"
                  placeholder="e.g. my-decisionator-app"
                  value={firebaseProjectId}
                  onChange={(e) => setFirebaseProjectId(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="fb-api-key"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  API Key
                </label>
                <Input
                  id="fb-api-key"
                  type="password"
                  placeholder="AIzaSy..."
                  value={firebaseApiKey}
                  onChange={(e) => setFirebaseApiKey(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="fb-app-id" className="text-[11px] font-medium text-muted-foreground">
                App ID
              </label>
              <Input
                id="fb-app-id"
                type="text"
                placeholder="1:123456789:web:abcdef"
                value={firebaseAppId}
                onChange={(e) => setFirebaseAppId(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>

            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveFirebaseConfig}
                leftIcon={<Save className="h-3.5 w-3.5" aria-hidden />}
                className="h-8 text-xs"
              >
                Save Firebase Credentials
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StorageSettings;
