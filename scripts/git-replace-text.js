#!/usr/bin/env node
"use strict";

/**
 * Потоковый фильтр содержимого для `git fast-export | <этот скрипт> | git fast-import`.
 *
 * Функциональный эквивалент `git filter-repo --replace-text` без зависимости от
 * Python (в этой системе python3 сломан, git-filter-repo недоступен).
 *
 * Заменяет токен ТОЛЬКО в blob'ах (содержимое файлов). Сообщения коммитов не
 * трогаются, но их совпадения печатаются в stderr как предупреждение.
 *
 * Использование:
 *   git fast-export --all --signed-tags=strip --reencode=yes \
 *     | node scripts/git-replace-text.js <search> <replace> \
 *     | git fast-import --force --quiet
 */

const SEARCH = process.argv[2];
const REPLACE = process.argv[3] === undefined ? "***REMOVED***" : process.argv[3];

if (!SEARCH || SEARCH.length < 8) {
  process.stderr.write(
    "usage: git fast-export ... | node scripts/git-replace-text.js <search> [replace]\n"
  );
  process.exit(2);
}

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const buf = Buffer.concat(chunks);
  const search = Buffer.from(SEARCH, "utf8");
  const replace = Buffer.from(REPLACE, "utf8");

  const out = [];
  let pos = 0;
  let blobId = 0;
  let blobHits = 0;
  let messageHits = 0;

  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) {
      out.push(buf.subarray(pos));
      break;
    }
    const line = buf.toString("utf8", pos, nl);
    const dataMatch = /^data (\d+)$/.exec(line);

    if (!dataMatch) {
      // Служебная строка. Проверяем, не лежит ли токен в тексте (message/data
      // помеченные иначе не бывает), просто пропускаем дальше.
      if (line.includes(SEARCH)) messageHits++;
      out.push(buf.subarray(pos, nl + 1));
      pos = nl + 1;
      continue;
    }

    const len = Number(dataMatch[1]);
    const start = nl + 1;
    const end = start + len;
    let data = buf.subarray(start, end);

    if (data.includes(search)) {
      const parts = [];
      let cursor = 0;
      let idx;
      while ((idx = data.indexOf(search, cursor)) !== -1) {
        parts.push(data.subarray(cursor, idx));
        parts.push(replace);
        cursor = idx + search.length;
      }
      parts.push(data.subarray(cursor));
      data = Buffer.concat(parts);
      blobId++;
      blobHits++;
    }

    out.push(Buffer.from("data " + data.length + "\n", "utf8"));
    out.push(data);
    if (buf[end] === 0x0a) out.push(buf.subarray(end, end + 1));
    pos = end + 1;
  }

  const result = Buffer.concat(out);
  process.stdout.write(result);
  process.stderr.write(
    "git-replace-text: blob'ов изменено " + blobHits +
      ", служебных строк с совпадением " + messageHits +
      ", вход " + buf.length + " Б -> выход " + result.length + " Б\n"
  );
});
