import { AlertCircle, ArrowLeft } from "lucide-react";
import type React from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";

export interface ProjectUnavailableProps {
  reason: "deleted" | "trashed" | "permission_denied" | "not_found";
  details?: string;
}

export const ProjectUnavailable: React.FC<ProjectUnavailableProps> = ({ reason, details }) => {
  const getReasonMessage = () => {
    switch (reason) {
      case "trashed":
        return "This project has been moved to the Google Drive Trash by its owner.";
      case "permission_denied":
        return "You do not have permission to view this project. Please request access from the owner.";
      default:
        return "This project could not be found or has been permanently deleted.";
    }
  };

  return (
    <Card className="max-w-md mx-auto my-12 text-center" role="alert">
      <CardHeader>
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <CardTitle className="text-destructive">Project Unavailable</CardTitle>
        <CardDescription>{getReasonMessage()}</CardDescription>
      </CardHeader>
      <CardContent>
        {details && (
          <pre className="rounded-lg border border-border bg-muted/50 p-3 text-xs font-mono text-foreground overflow-x-auto text-left max-h-36">
            {details}
          </pre>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <Button asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to My Projects
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
};
