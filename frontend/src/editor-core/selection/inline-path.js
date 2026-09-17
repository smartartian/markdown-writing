function nodeTextLength(node) {
  switch (node.type) {
    case 'text':
    case 'code':
      return (node.text || '').length;
    case 'image':
      return (node.alt || '').length;
    case 'math':
      return (node.text || '').length;
    default:
      return Array.isArray(node.children)
        ? node.children.reduce((total, child) => total + nodeTextLength(child), 0)
        : 0;
  }
}

export function textOffsetToInlinePosition(nodes, offset) {
  let remaining = Math.max(0, offset);
  const stack = [{ nodes, path: [] }];

  while (stack.length > 0) {
    const current = stack.pop();
    for (let index = current.nodes.length - 1; index >= 0; index--) {
      const node = current.nodes[index];
      const length = nodeTextLength(node);
      if (remaining > length) {
        remaining -= length;
        continue;
      }
      const path = [...current.path, index];
      if (Array.isArray(node.children) && node.children.length > 0) {
        stack.push({ nodes: node.children, path });
        break;
      }
      return {
        path,
        offset: Math.min(remaining, length),
      };
    }
  }

  return { path: [], offset: Math.max(0, offset) };
}

export function inlinePositionToTextOffset(nodes, path = [], leafOffset = 0) {
  if (!Array.isArray(path) || path.length === 0) return leafOffset;
  let currentNodes = nodes;
  let total = 0;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth];
    if (!Number.isInteger(index) || index < 0 || index >= currentNodes.length) return total;
    for (let before = 0; before < index; before++) {
      total += nodeTextLength(currentNodes[before]);
    }
    const node = currentNodes[index];
    if (depth === path.length - 1) {
      return total + Math.min(leafOffset, nodeTextLength(node));
    }
    currentNodes = node.children || [];
  }
  return total;
}

export { nodeTextLength };
