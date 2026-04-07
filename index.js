#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { startServer, getPort, broadcastComments } from './src/server.js';
import { getComments, deleteComment, clearComments, setCommentStatus } from './src/comments.js';
import open from 'open';

const server = new McpServer({
  name: 'design-preview',
  version: '1.0.0',
});

// ── Tool: open_preview ────────────────────────────────────────────────────────

server.tool(
  'open_preview',
  'Open a design preview window for a local development server. Injects a comment overlay so you can click elements and leave design notes.',
  {
    target_url: z.string().describe(
      'URL of the running dev server to preview, e.g. http://localhost:3000'
    ),
    port: z.number().int().min(1024).max(65535).optional().describe(
      'Port for the preview server (default 5557). Use a different port to run multiple previews simultaneously.'
    ),
  },
  async ({ target_url, port }) => {
    await startServer(target_url, port);
    const previewUrl = `http://localhost:${getPort(port)}`;
    await open(previewUrl);
    return {
      content: [
        {
          type: 'text',
          text: [
            `Preview opened at ${previewUrl} (proxying ${target_url}).`,
            '',
            'In the browser:',
            '  • Click "+ Comment" to enter comment mode',
            '  • Hover over any element — it highlights with a dashed border',
            '  • Click to open a comment popup and type your note',
            '  • Orange badges show saved comments',
            '  • Click "View all" to see or clear all comments',
            '',
            'When you\'re done annotating, ask me to "implement the design comments".',
          ].join('\n'),
        },
      ],
    };
  }
);

// ── Tool: get_comments ────────────────────────────────────────────────────────

server.tool(
  'get_comments',
  'Retrieve all design comments added via the preview overlay, including element selector and HTML context needed to locate the element in source code.',
  {},
  async () => {
    const comments = await getComments();

    if (comments.length === 0) {
      return {
        content: [{ type: 'text', text: 'No design comments yet.' }],
      };
    }

    const open = comments.filter(c => !c.resolved);
    const resolved = comments.filter(c => c.resolved);

    const lines = comments.map((c, i) => {
      const ei = c.elementInfo || {};
      const tag = [
        ei.tag,
        ei.id ? `#${ei.id}` : '',
        ei.classes?.length ? `.${ei.classes.join('.')}` : '',
      ]
        .filter(Boolean)
        .join('');

      const statusStr = c.resolved ? `RESOLVED` : (c.status || 'open').toUpperCase();
      const status = `[${statusStr}]`;
      const ancestors = ei.ancestors?.length
        ? `  Ancestors: ${ei.ancestors.map(a => [a.tag, a.id ? `#${a.id}` : '', a.classes?.length ? `.${a.classes.join('.')}` : ''].filter(Boolean).join('')).join(' › ')}`
        : '';
      const stack = ei.stackAtPoint?.length
        ? `  Stack    : ${ei.stackAtPoint.slice(0, 4).join(', ')}`
        : '';
      // Build thread context
      let threadContext = '';
      if (c.parentId) {
        const chain = [];
        let cur = c;
        const visited = new Set();
        while (cur.parentId && !visited.has(cur.parentId)) {
          visited.add(cur.parentId);
          const parent = comments.find(p => p.id === cur.parentId);
          if (!parent) break;
          chain.unshift(`    [${parent.id}] ${parent.resolved ? '✓' : (parent.status || 'open').toUpperCase()}: "${parent.text}"`);
          cur = parent;
        }
        if (chain.length) threadContext = `  Thread   :\n${chain.join('\n')}\n    └─ (this): "${c.text}"`;
      }

      return [
        `── Comment ${i + 1}  [id: ${c.id}]  ${status} ──`,
        `  Page     : ${c.url}`,
        `  Selector : ${c.selector}`,
        `  Element  : ${tag || '(unknown)'}`,
        `  Content  : "${ei.text || ''}"`,
        ancestors,
        stack,
        `  HTML     : ${ei.outerHTML || ''}`,
        threadContext || `  Note     : ${c.text}`,
      ].filter(Boolean).join('\n');
    });

    lines.unshift(`${open.length} open, ${resolved.length} resolved\n`);

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n\n'),
        },
      ],
    };
  }
);

// ── Tool: clear_comment ───────────────────────────────────────────────────────

server.tool(
  'clear_comment',
  'Remove a design comment after implementing it, or clear all comments at once.',
  {
    id: z.string().optional().describe(
      'ID of the specific comment to remove (from get_comments output). Omit to clear ALL comments.'
    ),
  },
  async ({ id }) => {
    if (id) {
      await deleteComment(id);
      return { content: [{ type: 'text', text: `Comment ${id} removed.` }] };
    } else {
      await clearComments();
      return { content: [{ type: 'text', text: 'All design comments cleared.' }] };
    }
  }
);

// ── Tool: watch_live_comments ─────────────────────────────────────────────────

server.tool(
  'watch_live_comments',
  'Wait for the next pending live comment from the browser overlay, then return it so you can implement the change. Marks the comment as "processing" while you work. Call this in a loop: implement the change, call mark_live_done, then call this again.',
  {
    timeout_seconds: z.number().default(120).describe(
      'How long to wait for a pending comment before giving up (default 120s).'
    ),
  },
  async ({ timeout_seconds }) => {
    const deadline = Date.now() + timeout_seconds * 1000;

    while (Date.now() < deadline) {
      const comments = await getComments();
      const pending = comments.find(c => c.status === 'pending');

      if (pending) {
        await setCommentStatus(pending.id, 'processing');
        await broadcastComments();
        const ei = pending.elementInfo || {};
        const tag = [
          ei.tag,
          ei.id ? `#${ei.id}` : '',
          ei.classes?.length ? `.${ei.classes.join('.')}` : '',
        ].filter(Boolean).join('');

        // Build thread context by walking up parentId chain
        const threadLines = [];
        let cur = pending;
        const visited = new Set();
        while (cur.parentId && !visited.has(cur.parentId)) {
          visited.add(cur.parentId);
          const parent = comments.find(c => c.id === cur.parentId);
          if (!parent) break;
          threadLines.unshift(`  [${parent.id}] ${parent.status === 'done' || parent.resolved ? '✓' : '…'} "${parent.text}"`);
          cur = parent;
        }

        return {
          content: [{
            type: 'text',
            text: [
              `Live comment ready [id: ${pending.id}]`,
              `  Page     : ${pending.url}`,
              `  Selector : ${pending.selector}`,
              `  Element  : ${tag || (pending.positional ? 'positional pin' : 'unknown')}`,
              `  Content  : "${ei.text || ''}"`,
              ei.stackAtPoint?.length ? `  Stack    : ${ei.stackAtPoint.slice(0, 4).join(', ')}` : '',
              `  HTML     : ${ei.outerHTML || ''}`,
              threadLines.length ? `  Thread   :\n${threadLines.join('\n')}\n  └─ (this) "${pending.text}"` : `  Change   : ${pending.text}`,
              '',
              `Implement this change now, then call mark_live_done("${pending.id}").`,
            ].filter(l => l !== undefined).join('\n'),
          }],
        };
      }

      await new Promise(r => setTimeout(r, 600));
    }

    return {
      content: [{ type: 'text', text: `No pending live comments within ${timeout_seconds}s. Call again to keep watching.` }],
    };
  }
);

// ── Tool: mark_live_done ──────────────────────────────────────────────────────

server.tool(
  'mark_live_done',
  'Mark a live comment as done after you have implemented the change. The badge in the browser turns green so the user can approve it.',
  {
    id: z.string().describe('The comment id returned by watch_live_comments.'),
  },
  async ({ id }) => {
    await setCommentStatus(id, 'done');
    await broadcastComments();
    return { content: [{ type: 'text', text: `Comment ${id} marked done. Badge is now green in the browser. Call watch_live_comments to wait for the next one.` }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
