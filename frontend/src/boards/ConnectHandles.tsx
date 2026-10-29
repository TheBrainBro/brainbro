import { Handle, Position, useConnection } from '@xyflow/react'

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

/**
 * Dots on each side to drag an edge from (shown on hover), and while an edge
 * is being dragged, the whole node to drop it on. Edges attach to borders,
 * not to these, so which dot it came from doesn't matter.
 */
export function ConnectHandles({ id, readOnly }: { id: string; readOnly: boolean }) {
  const connecting = useConnection(
    (connection) => connection.inProgress && connection.fromNode.id !== id,
  )
  return (
    <>
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          isConnectable={!readOnly}
          className="connect-handle"
        />
      ))}
      {/* What saved edges resolve to; never seen. */}
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!invisible"
      />
      {connecting && (
        <Handle
          id="drop"
          type="target"
          position={Position.Top}
          isConnectableStart={false}
          className="connect-target"
        />
      )}
    </>
  )
}
