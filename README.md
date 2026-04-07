# Claude Design Preview

An MCP (Model Context Protocol) server for [Claude Code](https://claude.ai/code) that lets Claude open a live preview of your running dev server, inject a comment overlay into the page, and implement design feedback in real time.

---

## Installation

**Requirements:** Node.js 18+, Claude Code CLI

```bash
git clone https://github.com/bucketfish/claude-design-preview.git
cd claude-design-preview
npm install
```

Then register it as an MCP server in Claude Code:

```bash
claude mcp add design-preview -- node /absolute/path/to/claude-design-preview/index.js
```

Restart Claude Code. The tools will appear automatically in your next session.

(You can also just ask Claude to do this for you after downloading.)

---

## What to ask Claude

Once the MCP server is connected, just talk to Claude naturally. Here are the kinds of things you can say:

**Opening a preview**
- "Open a design preview of my app running at localhost:3000"
- "Preview localhost:5173 in the browser"
- "Open two previews — one at localhost:3000 and one at localhost:4000"

**Implementing comments you've left in the browser**
- "Implement the design comments"
- "Read the comments and make those changes"
- "What comments are there? Go ahead and do them"

**Live back-and-forth mode** *(turn on Live in the browser toolbar first)*
- "Watch for live comments and implement each one as I send them"
- "Start implementing my live feedback"

After Claude implements a change, go back to the browser, hover the green badge, and press `Space` to approve or `Backspace` to reject and send a follow-up note.

**Cleaning up**
- "Clear all the design comments"
- "Remove comment #a1b2c3"

---

## How it works

When you call `open_preview`, the server starts a local proxy that:

1. Forwards all HTTP and WebSocket (HMR) traffic to your dev server
2. Injects a comment overlay script into every HTML page
3. Opens the proxied URL in your browser

Comments you leave in the browser are stored locally and can be read, implemented, or cleared by Claude via the other tools.

---

## Tools

### `open_preview`

Opens a browser preview window with the comment overlay injected.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_url` | string | yes | URL of your running dev server, e.g. `http://localhost:3000` |
| `port` | integer | no | Port for the preview server (default `5557`). Use a different port to run two previews at the same time. |

**Example:**
> "Open a design preview of my dev server at localhost:3000"

To run two previews simultaneously:
> "Open a preview of localhost:3000 on port 5557 and localhost:4000 on port 5558"

---

### `get_comments`

Returns all design comments that have been left in the browser overlay, including element selectors, HTML context, page URL, and thread history — everything Claude needs to locate and implement each change.

No parameters.

**Example:**
> "Get the design comments and implement them"

---

### `clear_comment`

Removes a single comment by ID, or clears all comments at once.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | no | ID of the comment to remove (from `get_comments` output). Omit to clear all comments. |

**Example:**
> "Clear all the design comments"

---

### `watch_live_comments`

Waits for the next comment marked as **pending** in the browser (i.e. submitted via Live mode), marks it as "processing", and returns it so Claude can implement the change immediately. Call this in a loop: implement → `mark_live_done` → `watch_live_comments` again.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timeout_seconds` | number | `120` | How long to wait before giving up. |

**Example:**
> "Watch for live comments and implement each one as it comes in"

---

### `mark_live_done`

Marks a live comment as done after Claude has implemented it. The badge in the browser turns green so you can approve or reject the change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | The comment ID returned by `watch_live_comments`. |

---

## Browser overlay

Once a preview is open, a toolbar appears in the top-right corner of the page.

### Toolbar buttons

| Button | Description |
|--------|-------------|
| **Commenting / Paused** | Toggle whether clicking elements opens a comment form. Click to pause/resume comment mode. |
| **Live** | Toggle Live mode (see below). |
| **View all** | Open a panel listing all comments with their status. |

### Leaving a comment

1. Make sure the toolbar shows **Commenting** (not Paused).
2. Hover over any element — it highlights with a dashed border.
3. Click the element to open a comment popup.
4. Type your note and press **Save**.

An orange badge appears on the element. Comments are stored on the proxy server and are immediately available to Claude via `get_comments`.

### Comment statuses

| Badge colour | Status | Meaning |
|---|---|---|
| Orange | open | Saved, waiting to be picked up |
| Amber (pulsing) | pending | Queued for Claude in Live mode |
| Spinning | processing | Claude is implementing this right now |
| Green | done | Claude finished — waiting for your approval |
| Grey | resolved / approved | Accepted and closed |

### Hover card actions (Live mode)

Hover over any badge to see a card with the comment text and quick actions:

| Action | Keyboard | Description |
|--------|----------|-------------|
| **Approve** | `Space` | Accept Claude's implementation, resolves the comment |
| **Reject** | `Backspace` | Send it back to Claude with optional follow-up notes |
| **Follow-up** | `Enter` | Add a threaded reply without rejecting |

### Live mode

Live mode lets you submit comments one at a time and have Claude implement each one immediately, then approve or reject the result before moving on.

1. Click **Live** in the toolbar to turn it on (button turns amber).
2. Leave a comment — it is queued as **pending** instead of open.
3. Tell Claude to `watch_live_comments` — it picks up the comment, implements it, and calls `mark_live_done`.
4. The badge turns green. Hover it and press `Space` to approve or `Backspace` to reject.
5. Repeat.

Live mode persists across page refreshes so hot-reload doesn't interrupt your session.

### Positional pins

Right-click anywhere on the page (not on a specific element) to drop a positional pin. Useful for pointing at whitespace, layout gaps, or areas between elements.

### Threaded comments

Inside a hover card, press `Enter` to open an inline reply form. Replies are linked to the parent comment and shown as a thread in `get_comments` output, giving Claude the full context of back-and-forth feedback.

---

## Running multiple previews

Each preview server runs on its own port. Start as many as you need:

```
open_preview(target_url="http://localhost:3000")           # preview at :5557
open_preview(target_url="http://localhost:4000", port=5558) # preview at :5558
```

Comments from all previews are stored in a single shared store, so `get_comments` returns notes from every open preview.

---

## Local data

Comments are stored in memory for the lifetime of the MCP server process. They are not written to disk and will be lost if the server restarts.
