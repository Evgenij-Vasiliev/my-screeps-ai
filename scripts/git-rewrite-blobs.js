#!/usr/bin/env node
"use strict";

/**
 * Переписывает объекты git, заменяя заданный текст во ВСЕХ blob'ах,
 * достижимых из любых ссылок (refs/*), включая нестандартный namespace
 * (например refs/cline/checkpoints/*).
 *
 * Функциональный эквивалент `git filter-repo --replace-text`, реализованный
 * на git plumbing без Python (git-filter-repo в системе недоступен).
 *
 * Гарантии:
 *   - сообщения, author и committer коммитов не меняются;
 *   - режимы и имена файлов сохраняются;
 *   - blob'ы без совпадений переиспользуются (тот же oid).
 *
 * Использование:
 *   node scripts/git-rewrite-blobs.js <search> <replace>
 *
 * После запуска обязательны чистка reflog и gc (см. scripts/run-history-scrub.sh).
 */

const { execFileSync } = require("child_process");

const SEARCH = process.argv[2];
const REPLACE = process.argv[3] === undefined ? "***REMOVED***" : process.argv[3];

if (!SEARCH || SEARCH.length < 8) {
  console.error("usage: node scripts/git-rewrite-blobs.js <search> <replace>");
  process.exit(2);
}

/**
 * @param {string[]} args
 * @param {Buffer | string} [input]
 * @returns {Buffer}
 */
const git = (args, input) => {
  /** @type {{ maxBuffer: number, input?: Buffer | string }} */
  const opts = { maxBuffer: 1 << 30 };
  if (input !== undefined) opts.input = input;
  return /** @type {Buffer} */ (execFileSync("git", args, opts));
};
const gitText = (args, input) => git(args, input).toString("utf8").trim();
const realOid = (oid) => (oid.length === 40 ? oid : gitText(["rev-parse", oid]));

const search = Buffer.from(SEARCH, "utf8");
const replace = Buffer.from(REPLACE, "utf8");

function parseTree(body) {
  const entries = [];
  let pos = 0;
  while (pos < body.length) {
    const sp = body.indexOf(0x20, pos);
    const nul = body.indexOf(0x00, pos);
    if (sp === -1 || nul === -1) throw new Error("повреждён объект tree");
    entries.push({
      mode: body.toString("utf8", pos, sp),
      name: body.subarray(sp + 1, nul),
      oid: body.subarray(nul + 1, nul + 21).toString("hex"),
    });
    pos = nul + 21;
  }
  return entries;
}

const serializeTree = (entries) => {
  const parts = [];
  for (const e of entries) {
    parts.push(
      Buffer.from(e.mode + " ", "utf8"),
      e.name,
      Buffer.from([0]),
      Buffer.from(e.oid, "hex")
    );
  }
  return Buffer.concat(parts);
};

// --- 1. Ссылки и их вершины ------------------------------------------------
const refTip = new Map();
for (const line of gitText(["for-each-ref", "--format=%(refname) %(objectname)"]).split("\n")) {
  if (!line) continue;
  const sp = line.indexOf(" ");
  refTip.set(line.slice(0, sp), realOid(line.slice(sp + 1)));
}

// --- 2. Обход графа из всех вершин ----------------------------------------
const commitParents = new Map();
const commitTrees = new Map();
const allTrees = new Set();
const allBlobs = new Set();
const seen = new Set();
const stack = [...refTip.values()];

while (stack.length) {
  const oid = stack.pop();
  if (seen.has(oid)) continue;
  seen.add(oid);
  const type = gitText(["cat-file", "-t", oid]);

  if (type === "commit") {
    const body = gitText(["cat-file", "commit", oid]);
    const parents = [];
    let tree = null;
    for (const line of body.split("\n")) {
      if (line.startsWith("parent ")) parents.push(line.slice(7).trim());
      else if (line.startsWith("tree ")) tree = line.slice(5).trim();
      else if (line === "") break;
    }
    commitParents.set(oid, parents);
    commitTrees.set(oid, tree);
    for (const p of parents) stack.push(p);
    allTrees.add(tree);
  } else if (type === "tree") {
    allTrees.add(oid);
  } else if (type === "tag") {
    const body = gitText(["cat-file", "tag", oid]);
    for (const line of body.split("\n")) {
      if (line.startsWith("object ")) stack.push(line.slice(7).trim());
    }
  } else if (type === "blob") {
    allBlobs.add(oid);
  }
}

// Догружаем поддеревья и blob'ы из всех найденных деревьев.
const treeEntries = new Map();
const tstack = [...allTrees];
while (tstack.length) {
  const t = tstack.pop();
  if (treeEntries.has(t)) continue;
  const entries = parseTree(git(["cat-file", "tree", t]));
  treeEntries.set(t, entries);
  for (const e of entries) {
    if (e.mode === "40000" || e.mode === "040000") tstack.push(e.oid);
    else if (e.mode === "160000") continue;
    else allBlobs.add(e.oid);
  }
}

// --- 3. Перезапись blob'ов -------------------------------------------------
function batchRead(oids) {
  if (oids.length === 0) return [];
  const out = git(["cat-file", "--batch"], Buffer.from(oids.join("\n") + "\n", "utf8"));
  /** @type {[string, Buffer][]} */
  const result = [];
  let pos = 0;
  while (pos < out.length) {
    const nl = out.indexOf(0x0a, pos);
    if (nl === -1) break;
    const parts = out.toString("utf8", pos, nl).split(" ");
    if (parts[1] === "missing") {
      pos = nl + 1;
      continue;
    }
    const size = Number(parts[2]);
    const start = nl + 1;
    result.push([parts[0], out.subarray(start, start + size)]);
    pos = start + size + 1;
  }
  return result;
}

const blobMap = new Map();
let changedBlobs = 0;
for (const [oid, data] of batchRead([...allBlobs])) {
  if (!data.includes(search)) continue;
  const parts = [];
  let cursor = 0;
  let idx;
  while ((idx = data.indexOf(search, cursor)) !== -1) {
    parts.push(data.subarray(cursor, idx), replace);
    cursor = idx + search.length;
  }
  parts.push(data.subarray(cursor));
  blobMap.set(oid, gitText(["hash-object", "-w", "--stdin"], Buffer.concat(parts)));
  changedBlobs++;
}

// --- 4. Перезапись деревьев (снизу вверх) ----------------------------------
const treeMap = new Map();
function rewriteTree(oid) {
  if (treeMap.has(oid)) return treeMap.get(oid);
  const entries = treeEntries.get(oid) || parseTree(git(["cat-file", "tree", oid]));
  let changed = false;
  const next = entries.map((e) => {
    let newOid = e.oid;
    if (e.mode === "40000" || e.mode === "040000") newOid = rewriteTree(e.oid);
    else if (e.mode !== "160000") newOid = blobMap.get(e.oid) || e.oid;
    if (newOid !== e.oid) changed = true;
    return { mode: e.mode, name: e.name, oid: newOid };
  });
  const result = changed
    ? gitText(["hash-object", "-w", "-t", "tree", "--stdin"], serializeTree(next))
    : oid;
  treeMap.set(oid, result);
  return result;
}

let changedTrees = 0;
for (const t of treeEntries.keys()) {
  if (rewriteTree(t) !== t) changedTrees++;
}

// --- 5. Перезапись коммитов (родители раньше детей) ------------------------
const children = new Map();
const indegree = new Map();
for (const oid of commitParents.keys()) indegree.set(oid, 0);
for (const [oid, parents] of commitParents) {
  for (const p of parents) {
    if (!indegree.has(p)) continue; // родитель за пределами достижимого графа
    indegree.set(oid, indegree.get(oid) + 1);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(oid);
  }
}

const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([oid]) => oid);
const commitMap = new Map();
const order = [];
while (queue.length) {
  const oid = queue.shift();
  order.push(oid);
  for (const child of children.get(oid) || []) {
    indegree.set(child, indegree.get(child) - 1);
    if (indegree.get(child) === 0) queue.push(child);
  }
}
if (order.length !== indegree.size) {
  throw new Error("не удалось построить топологический порядок коммитов");
}

for (const oid of order) {
  const body = git(["cat-file", "commit", oid]);
  const text = body.toString("utf8");
  const headerEnd = text.indexOf("\n\n");
  const header = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const rest = headerEnd === -1 ? "" : text.slice(headerEnd);
  const newHeader = header
    .split("\n")
    .map((line) => {
      if (line.startsWith("tree ")) return "tree " + rewriteTree(line.slice(5).trim());
      if (line.startsWith("parent ")) {
        const p = line.slice(7).trim();
        return "parent " + (commitMap.get(p) || p);
      }
      return line;
    })
    .join("\n");
  const newOid = gitText(
    ["hash-object", "-w", "-t", "commit", "--stdin"],
    Buffer.from(newHeader + rest, "utf8")
  );
  commitMap.set(oid, newOid);
}

// --- 6. Перестановка ссылок ------------------------------------------------
let movedRefs = 0;
for (const [ref, tip] of refTip) {
  const newTip = commitMap.get(tip);
  if (!newTip || newTip === tip) continue;
  git(["update-ref", "-m", "token scrub: rewrite history", ref, newTip, tip]);
  movedRefs++;
  console.log("  " + ref + ": " + tip.slice(0, 8) + " -> " + newTip.slice(0, 8));
}

console.log(
  "git-rewrite-blobs: blob'ов изменено " + changedBlobs +
    ", деревьев " + changedTrees +
    ", коммитов " + commitMap.size +
    ", refs " + movedRefs + "/" + refTip.size
);
