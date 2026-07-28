import type { IMessageAdapter } from '@imessage-sdk/chat-adapter';
import type { AdapterPostableMessage } from 'chat';
import type { AnyIMessageProvider } from 'imessage-sdk';

import { getNodeChildren, isLinkNode, parseMarkdown, root, text, toPlainText, walkAst } from 'chat';

export function configurePlainTextIMessageOutput<
  TProvider extends AnyIMessageProvider,
  TConnectionId extends string,
>(adapter: IMessageAdapter<TProvider, TConnectionId>) {
  const postMessage = adapter.postMessage.bind(adapter);
  const editMessage = adapter.editMessage.bind(adapter);

  adapter.postMessage = (threadId, postable) =>
    postMessage(threadId, normalizeIMessagePost(postable));
  adapter.editMessage = (threadId, messageId, postable) =>
    editMessage(threadId, messageId, normalizeIMessagePost(postable));

  return adapter;
}

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
