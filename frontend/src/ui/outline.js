function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanHeadingText(raw) {
  return String(raw || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

function headingLevel(raw) {
  const match = String(raw || '').match(/^(#{1,6})\s+/);
  return match ? match[1].length : 1;
}

export function headingsFromDocument(documentModel) {
  if (!documentModel?.blocks) return [];
  const headings = [];
  let blockIndex = 0;

  for (const block of documentModel.blocks) {
    if (block.attrs?.separator) continue;
    if (block.type === 'heading') {
      headings.push({
        id: block.id || `outline-${blockIndex}`,
        blockIndex,
        level: Number(block.attrs?.level) || headingLevel(block.raw),
        text: cleanHeadingText(block.raw),
      });
    }
    blockIndex += 1;
  }

  return headings;
}

export function headingsFromMarkdown(source) {
  const headings = [];
  let inFence = false;
  let offset = 0;

  for (const line of String(source || '').split('\n')) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) {
        headings.push({
          id: `source-${offset}`,
          blockIndex: null,
          sourceOffset: offset,
          level: match[1].length,
          text: cleanHeadingText(line),
        });
      }
    }
    offset += line.length + 1;
  }

  return headings;
}

export function buildOutlineTree(headings) {
  const roots = [];
  const stack = [];

  headings.forEach((heading, index) => {
    const node = {
      ...heading,
      key: `${heading.id || 'heading'}-${index}`,
      children: [],
      depth: 0,
    };

    while (stack.length && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    node.depth = stack.length;
    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  });

  return roots;
}

function renderNode(node, collapsedKeys) {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedKeys.has(node.key);
  return `
    <div class="outline-node ${collapsed ? 'collapsed' : ''}" data-outline-key="${escapeHtml(node.key)}">
      <button class="outline-item outline-level-${node.level}" type="button"
        data-block-index="${node.blockIndex ?? ''}"
        data-source-offset="${node.sourceOffset ?? ''}"
        style="--outline-depth:${node.depth}">
        <span class="outline-toggle ${hasChildren ? '' : 'outline-toggle-leaf'}" ${hasChildren ? 'data-outline-toggle' : ''}></span>
        <span class="outline-level">H${node.level}</span>
        <span class="outline-text">${escapeHtml(node.text)}</span>
      </button>
      ${hasChildren ? `<div class="outline-children">${node.children.map(child => renderNode(child, collapsedKeys)).join('')}</div>` : ''}
    </div>
  `;
}

export function renderOutlineTree(tree, { collapsedKeys = new Set() } = {}) {
  return tree.map(node => renderNode(node, collapsedKeys)).join('');
}
