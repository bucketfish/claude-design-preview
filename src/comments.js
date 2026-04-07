import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const COMMENTS_FILE = join(tmpdir(), 'claude-design-comments.json');

async function readComments() {
  try {
    if (!existsSync(COMMENTS_FILE)) return [];
    const data = await readFile(COMMENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeComments(comments) {
  await writeFile(COMMENTS_FILE, JSON.stringify(comments, null, 2));
}

export async function getComments() {
  return readComments();
}

export async function addComment(data) {
  const comments = await readComments();
  const comment = {
    id: randomUUID().slice(0, 8),
    selector: data.selector,
    positional: data.positional || false,
    pageX: data.pageX,
    pageY: data.pageY,
    parentId: data.parentId || null,
    elementInfo: data.elementInfo || {},
    url: data.url || '/',
    text: data.text,
    status: data.status || 'open',   // open | pending | processing | done
    timestamp: new Date().toISOString(),
  };
  comments.push(comment);
  await writeComments(comments);
  return comment;
}

export async function setCommentStatus(id, status) {
  const comments = await readComments();
  const idx = comments.findIndex(c => c.id === id);
  if (idx !== -1) { comments[idx].status = status; await writeComments(comments); }
}

export async function updateComment(id, data) {
  const comments = await readComments();
  const idx = comments.findIndex(c => c.id === id);
  if (idx !== -1) {
    const allowed = ['text', 'resolved', 'resolvedAt', 'status'];
    const updates = Object.fromEntries(
      Object.entries(data).filter(([k]) => allowed.includes(k))
    );
    comments[idx] = { ...comments[idx], ...updates };
    await writeComments(comments);
  }
}

export async function deleteComment(id) {
  const comments = await readComments();
  await writeComments(comments.filter(c => c.id !== id));
}

export async function clearComments() {
  await writeComments([]);
}
