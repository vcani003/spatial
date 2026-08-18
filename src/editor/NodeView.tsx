import type { NodeId } from "../core/ids";
import type { SpatialNode } from "../core/schema";
import styles from "./Canvas.module.css";

/**
 * One node, positioned in WORLD units.
 *
 * It knows nothing about the viewport — the wrapper above it carries the
 * whole transform — which is what keeps pan and zoom O(1) instead of O(nodes)
 * and keeps this component about content rather than geometry.
 *
 * `alt` goes straight onto the `<img>`. That is not thoroughness for its own
 * sake: §7 makes accessible structure architectural rather than a later pass,
 * and the cheapest way to keep that true is for the first renderer ever
 * written to have nowhere to put an image without also carrying its
 * description.
 */
export function NodeView({
  node,
  selected,
  onPointerDown,
}: {
  node: SpatialNode;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent, id: NodeId) => void;
}) {
  const { x, y, width, height } = node.presentations.desktop;

  return (
    <div
      className={styles.node}
      data-selected={selected ? "" : undefined}
      style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
      onPointerDown={(event) => {
        onPointerDown(event, node.id);
      }}
    >
      {node.content.kind === "text" ? (
        <p className={styles.text}>{node.content.text}</p>
      ) : (
        <img
          className={styles.image}
          src={node.content.src}
          alt={node.content.alt}
          draggable={false}
        />
      )}
    </div>
  );
}
