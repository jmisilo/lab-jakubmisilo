import type { AdapterPostableMessage } from 'chat';

import { getNodeChildren, isLinkNode, parseMarkdown, root, text, toPlainText, walkAst } from 'chat';

/** Convert model Markdown into the plain-text format rendered by Photon iMessage. */
export function normalizeIMessagePost(postable: AdapterPostableMessage): AdapterPostableMessage {
  if (typeof postable !== 'string') {
    return postable;
  }

  const ast = walkAst(parseMarkdown(postable), (node) => {
    if (!isLinkNode(node)) {
      return node;
    }

    const label = toPlainText(root(getNodeChildren(node))).trim();

    return text(label && label !== node.url ? `${label}: ${node.url}` : node.url);
  });

  return {
    raw: toPlainText(ast).trim(),
  };
}
