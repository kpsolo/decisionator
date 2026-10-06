import type React from "react";
import { Link } from "react-router-dom";

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
    <div className="card" role="alert" style={{ textAlign: "center", padding: "32px 16px" }}>
      <h3 style={{ color: "var(--color-danger, #ef4444)", marginBottom: 8 }}>
        Project Unavailable
      </h3>
      <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>{getReasonMessage()}</p>
      {details && (
        <pre
          style={{
            background: "var(--bg)",
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            maxWidth: 500,
            margin: "0 auto 16px auto",
            overflowX: "auto",
          }}
        >
          {details}
        </pre>
      )}
      <Link to="/" className="btn btn-primary">
        Back to My Projects
      </Link>
    </div>
  );
};
