import type { Option } from "@decisionator/core";
import type React from "react";
import { useMemo, useState } from "react";

export interface PreviewEditorProps {
  initialTitle?: string;
  initialDescription?: string;
  initialOptions: Option[];
  onConfirm: (data: { title: string; description: string; options: Option[] }) => void;
  onBack: () => void;
}

export const PreviewEditor: React.FC<PreviewEditorProps> = ({
  initialTitle = "Untitled Decision",
  initialDescription = "",
  initialOptions,
  onConfirm,
  onBack,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Check duplicate titles
  const duplicateTitles = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const opt of options) {
      const lower = opt.title.trim().toLowerCase();
      if (seen.has(lower)) {
        dupes.add(lower);
      } else {
        seen.add(lower);
      }
    }
    return dupes;
  }, [options]);

  const handleRemoveOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id));
  };

  const handleUpdateOption = <K extends keyof Option>(id: string, field: K, value: Option[K]) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const handleAddOption = () => {
    const newId = `opt_${Date.now()}`;
    const newOpt: Option = {
      id: newId,
      title: "New Option",
      description: "",
      order: options.length + 1,
      status: "active",
      tags: [],
      pros: [],
      cons: [],
      links: [],
    };
    setOptions((prev) => [...prev, newOpt]);
    setEditingId(newId);
  };

  const handleConfirm = () => {
    if (!title.trim() || options.length === 0) return;
    onConfirm({ title, description, options });
  };

  return (
    <div className="preview-editor card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>Step 3: Review & Edit Project</h3>
        <button
          type="button"
          onClick={onBack}
          className="btn btn-outline"
          style={{ padding: "4px 8px" }}
        >
          &larr; Back
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="project-title-input"
          style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}
        >
          Project Title *
        </label>
        <input
          id="project-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Choose team retrospectives tool"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            boxSizing: "border-box",
            fontSize: 15,
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="project-description-input"
          style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}
        >
          Description (Optional)
        </label>
        <textarea
          id="project-description-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Context or decision criteria..."
          rows={3}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            boxSizing: "border-box",
            fontSize: 13,
          }}
        />
      </div>

      {duplicateTitles.size > 0 && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "rgba(234, 179, 8, 0.1)",
            color: "#ca8a04",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          Warning: Detected duplicate option titles! Consider renaming or merging them.
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h4 style={{ margin: 0 }}>Options ({options.length})</h4>
        <button
          type="button"
          onClick={handleAddOption}
          className="btn btn-outline"
          style={{ fontSize: 12 }}
        >
          + Add Option
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {options.map((opt, index) => {
          const isDupe = duplicateTitles.has(opt.title.trim().toLowerCase());
          const isEditing = editingId === opt.id;

          return (
            <div
              key={opt.id}
              style={{
                border: isDupe ? "1px solid #ca8a04" : "1px solid var(--border)",
                borderRadius: 6,
                padding: 12,
                background: "var(--bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1 }}>
                  {isEditing ? (
                    <div>
                      <input
                        type="text"
                        value={opt.title}
                        onChange={(e) => handleUpdateOption(opt.id, "title", e.target.value)}
                        style={{
                          width: "100%",
                          padding: "4px 8px",
                          marginBottom: 8,
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                          background: "var(--card-bg)",
                          color: "var(--text)",
                        }}
                      />
                      <textarea
                        value={opt.description || ""}
                        onChange={(e) => handleUpdateOption(opt.id, "description", e.target.value)}
                        placeholder="Description..."
                        rows={2}
                        style={{
                          width: "100%",
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                          background: "var(--card-bg)",
                          color: "var(--text)",
                        }}
                      />
                    </div>
                  ) : (
                    <div>
                      <strong>
                        {index + 1}. {opt.title}
                      </strong>
                      {opt.description && (
                        <p
                          style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}
                        >
                          {opt.description}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setEditingId(isEditing ? null : opt.id)}
                    className="btn btn-outline"
                    style={{ fontSize: 12, padding: "2px 6px" }}
                  >
                    {isEditing ? "Done" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveOption(opt.id)}
                    className="btn btn-outline"
                    style={{
                      fontSize: 12,
                      padding: "2px 6px",
                      color: "var(--color-danger, #dc2626)",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleConfirm}
          className="btn btn-primary"
          disabled={!title.trim() || options.length === 0}
        >
          Create Project &rarr;
        </button>
      </div>
    </div>
  );
};
