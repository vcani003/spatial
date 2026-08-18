import { useState } from "react";
import { createImageNode, createTextNode, isSafeImageUrl } from "../core/create";
import type { SpatialNode } from "../core/schema";
import styles from "./CreateBar.module.css";

/**
 * =============================================================================
 * THE CREATE BAR — adding things to the canvas
 * =============================================================================
 *
 * IT TAKES THE CONTENT UP FRONT rather than dropping an empty box for you to
 * fill in. Inline text editing does not exist yet (§23 step 6), so a "new text
 * node" button on its own would produce a node saying nothing, with no way to
 * make it say anything — a feature that looks finished and is not. Typing the
 * words here is a smaller thing that actually works, and it stops being the
 * only way in the day editing lands.
 *
 * THE IMAGE FIELD REFUSES BEFORE IT CREATES. `isSafeImageUrl` is §11's
 * allowlist and it lives in `core`, so the same rule will apply to a paste, a
 * drop or an import. What is added here is the part that belongs to a UI:
 * saying WHY, next to the field, before anything is created — a validator that
 * silently does nothing is indistinguishable from a broken button.
 *
 * ALT TEXT IS A FIELD, NOT A FOLLOW-UP. §7 makes accessibility architectural;
 * the cheapest way to keep that true is that the only path to an image node
 * has a box for its description in it. It may be left empty — that is the
 * convention for decorative — but the question is always put.
 */

export function CreateBar({ onCreate }: { onCreate: (node: SpatialNode) => void }) {
  const [text, setText] = useState("");
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const addText = (): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    /* The centre is resolved by the shell, which asks the canvas — a new node
       lands where you are looking, not at the world origin you may be nowhere
       near. */
    onCreate(createTextNode(trimmed, { x: 0, y: 0 }));
    setText("");
  };

  const addImage = (): void => {
    if (!isSafeImageUrl(src)) {
      setProblem("Needs a full http:// or https:// address.");
      return;
    }
    setProblem(null);
    onCreate(createImageNode(src, alt, { x: 0, y: 0 }));
    setSrc("");
    setAlt("");
  };

  return (
    <div className={styles.bar}>
      <form
        className={styles.group}
        onSubmit={(event) => {
          event.preventDefault();
          addText();
        }}
      >
        <label className={styles.label} htmlFor="create-text">
          Text
        </label>
        <input
          id="create-text"
          className={styles.input}
          value={text}
          placeholder="Something to put on the canvas"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button type="submit" className={styles.add} disabled={text.trim() === ""}>
          Add
        </button>
      </form>

      <form
        className={styles.group}
        onSubmit={(event) => {
          event.preventDefault();
          addImage();
        }}
      >
        <label className={styles.label} htmlFor="create-image">
          Image
        </label>
        <input
          id="create-image"
          className={styles.input}
          value={src}
          placeholder="https://…"
          /* `type="url"` gives the right keyboard on a phone. Validation is
             still ours — the browser's is about syntax, §11's is about
             schemes. */
          type="url"
          aria-describedby={problem === null ? undefined : "create-image-problem"}
          aria-invalid={problem === null ? undefined : true}
          onChange={(event) => {
            setSrc(event.target.value);
            setProblem(null);
          }}
        />
        <input
          className={styles.input}
          value={alt}
          placeholder="Describe it (leave empty if decorative)"
          aria-label="Image description"
          onChange={(event) => {
            setAlt(event.target.value);
          }}
        />
        <button type="submit" className={styles.add} disabled={src.trim() === ""}>
          Add
        </button>
      </form>

      {problem !== null && (
        /* `role="alert"` so it is spoken when it appears. A refusal nobody is
           told about is the same as a button that does nothing. */
        <p id="create-image-problem" className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
