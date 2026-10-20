import { type FormEvent, useState } from "react";
import { TAG_COLORS, type Tag, type TagInput } from "../db/tags";
import { Temporal } from "../time/temporal";
import { formatTime } from "./dates";
import { SyncPanel } from "./SyncPanel";
import { ColorDots } from "./TagPicker";
import type { useSync } from "./useSync";
import type { useUpdate } from "./useUpdate";

interface Props {
  appUpdate: ReturnType<typeof useUpdate>;
  sync: ReturnType<typeof useSync>;
  tags: Tag[];
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onChangeTag: (id: string, patch: Partial<TagInput>) => void;
  onDeleteTag: (id: string) => void;
  onClose: () => void;
}

function timeOf(date: Date): string {
  return formatTime(Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(Temporal.Now.timeZoneId()));
}

export function SettingsDialog({ appUpdate, sync, tags, onCreateTag, onChangeTag, onDeleteTag, onClose }: Props) {
  const [newTag, setNewTag] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[tags.length % TAG_COLORS.length]);

  async function addTag(e: FormEvent) {
    e.preventDefault();
    if (!newTag.trim()) return;
    await onCreateTag(newTag, newColor);
    setNewTag("");
    setNewColor(TAG_COLORS[(tags.length + 1) % TAG_COLORS.length]);
  }

  let updateStatus: string;
  if (appUpdate.checking) updateStatus = "Checking…";
  else if (appUpdate.update) updateStatus = `Version ${appUpdate.update.version} is ready.`;
  else if (appUpdate.checkedAt) updateStatus = `Up to date, checked at ${timeOf(appUpdate.checkedAt)}.`;
  else updateStatus = "Not checked yet.";

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="settings-title">Settings</h2>

        <section className="settings-section">
          <h3>Version</h3>
          <p>Calendaria {__APP_VERSION__}</p>
          <p className="muted">{updateStatus}</p>
          {appUpdate.error && <p className="error-text">{appUpdate.error}</p>}
          <div className="settings-actions">
            {appUpdate.update ? (
              <button type="button" className="primary" onClick={appUpdate.install}>
                {appUpdate.installing ? "Updating…" : "Update and restart"}
              </button>
            ) : (
              <button type="button" onClick={appUpdate.checkNow} disabled={appUpdate.checking}>
                Check for updates
              </button>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h3>Sync</h3>
          <SyncPanel sync={sync} />
        </section>

        <section className="settings-section">
          <h3>Tags</h3>
          <p className="muted">Right-click a day, or open a note, to tag it. A tag tints what it's on in its color.</p>
          <ul className="settings-tags">
            {tags.map((tag) => (
              <li key={`${tag.id}:${tag.name}`}>
                <input
                  defaultValue={tag.name}
                  aria-label="Tag name"
                  style={{ color: tag.color }}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== tag.name) onChangeTag(tag.id, { name });
                    else e.target.value = tag.name;
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <ColorDots value={tag.color} onChange={(color) => onChangeTag(tag.id, { color })} />
                <button type="button" className="link" onClick={() => onDeleteTag(tag.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <form className="settings-tag-new" onSubmit={addTag}>
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="New tag" aria-label="New tag name" />
            <ColorDots value={newColor} onChange={setNewColor} />
            <button type="submit">Add</button>
          </form>
        </section>

        <div className="dialog-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
