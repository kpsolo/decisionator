import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { InPagePeerClient } from "@decisionator/share-inpage";
import { Radio, Unplug, Users } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useParams } from "react-router-dom";
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
import { Skeleton } from "../../components/ui/skeleton.js";
import { GradeInput } from "../grading/GradeInput.js";

export function PeerJoinFlow() {
  const { sessionId } = useParams();
  const [participantId] = useState(
    () => `guest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  );
  const [displayName, setDisplayName] = useState("Guest Voter");
  const [joined, setJoined] = useState(false);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [peerClient, setPeerClient] = useState<InPagePeerClient | null>(null);
  const [disconnectedReason, setDisconnectedReason] = useState<string | null>(null);
  const nameId = useId();

  const handleJoin = () => {
    if (!sessionId) return;
    const client = new InPagePeerClient({
      sessionId,
      participantId,
      displayName,
      onSnapshot: (snap) => setSnapshot(snap),
      onClosed: (reason) => setDisconnectedReason(reason),
    });
    client.connect();
    setPeerClient(client);
    setJoined(true);
  };

  useEffect(() => {
    return () => {
      peerClient?.disconnect();
    };
  }, [peerClient]);

  const handleGrade = (optionId: string, val: number) => {
    if (!peerClient) return;
    peerClient.submitEntries([
      {
        kind: "grade",
        optionId,
        value: val as 1 | 2 | 3 | 4 | 5,
      },
    ]);
  };

  if (disconnectedReason) {
    return (
      <Card className="mx-auto mt-6 max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Unplug className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle>Session Disconnected</CardTitle>
          <CardDescription>{disconnectedReason}</CardDescription>
          <p className="pt-2 text-sm text-muted-foreground">
            The host closed their browser tab. Thank you for participating!
          </p>
        </CardHeader>
      </Card>
    );
  }

  if (!joined) {
    return (
      <Card className="mx-auto mt-6 max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle>Join Live Decision Session</CardTitle>
          <CardDescription className="[overflow-wrap:anywhere]">
            Connect directly to the in-page host session:{" "}
            <code className="font-mono text-xs">{sessionId}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleJoin();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-sm font-medium">
                Your Name
              </label>
              <Input
                id={nameId}
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
              />
            </div>
            <Button type="submit" className="w-full">
              Connect & Vote
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card className="mx-auto mt-6 max-w-md" aria-busy="true">
        <CardHeader>
          <CardTitle>Connecting to host...</CardTitle>
          <CardDescription>
            Waiting for the host's tab to share the current project state.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="space-y-2">
        <Badge variant="success" className="gap-1.5 uppercase tracking-wide">
          <Radio className="h-3 w-3" aria-hidden />
          Connected peer
        </Badge>
        <h2 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {snapshot.project.title}
        </h2>
        {snapshot.project.description && (
          <p className="text-sm text-muted-foreground">{snapshot.project.description}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cast Your Grades</CardTitle>
          <CardDescription>
            Your selections are sent directly to the host's browser tab in real time.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {snapshot.options.map((opt) => {
            const myGrade = snapshot.grades.find(
              (g) => g.by === participantId && g.optionId === opt.id
            );
            return (
              <div key={opt.id} className="rounded-lg border border-border bg-background/60 p-4">
                <div className="font-semibold [overflow-wrap:anywhere]">{opt.title}</div>
                {opt.description && (
                  <div className="mt-1 text-sm text-muted-foreground">{opt.description}</div>
                )}
                <div className="mt-3">
                  <GradeInput
                    value={myGrade?.value || 0}
                    onChange={(val) => handleGrade(opt.id, val)}
                    disabled={false}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
