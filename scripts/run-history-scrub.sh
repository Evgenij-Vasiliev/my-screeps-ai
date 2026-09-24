#!/bin/bash
# Полная очистка секрета из git-истории репозитория.
#
# Схема (безопасная, без Python и git-filter-repo):
#   1. бэкап текущего .git;
#   2. зеркальный клон во временный каталог (переносятся ровно достижимые объекты
#      и все refs, включая refs/cline/*);
#   3. scripts/git-rewrite-blobs.js заменяет секрет во всех blob'ах;
#   4. reflog expire + gc --prune=now: старые объекты удаляются;
#   5. проверка: ни в одном объекте нет секрета;
#   6. подмена .git на очищенный.
#
# Секрет передаётся аргументом и в файле не хранится:
#   scripts/run-history-scrub.sh <secret> [replace]
#
# ВНИМАНИЕ: переписывает историю всех ветвей. Push потребует --force.

set -euo pipefail

SECRET="${1:?usage: scripts/run-history-scrub.sh <secret> [replace]}"
REPLACE="${2:-[REDACTED-SCREEPS-TOKEN]}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${TMPDIR:-/tmp}/ns-scrub-$STAMP"
CLONE_DIR="$BACKUP_DIR/clone.git"

echo "== 1/6 бэкап .git -> $BACKUP_DIR/git-backup"
mkdir -p "$BACKUP_DIR"
cp -a "$REPO_ROOT/.git" "$BACKUP_DIR/git-backup"
echo "   размер: $(du -sh "$BACKUP_DIR/git-backup" | cut -f1)"

echo "== 2/6 зеркальный клон"
git clone --mirror --no-local --quiet "$REPO_ROOT/.git" "$CLONE_DIR"

echo "== 3/6 замена секрета во всех blob'ах"
(
  cd "$CLONE_DIR"
  node "$REPO_ROOT/scripts/git-rewrite-blobs.js" "$SECRET" "$REPLACE" | tail -3
)

echo "== 4/6 очистка недостижимых объектов"
(
  cd "$CLONE_DIR"
  rm -f info/refs 2>/dev/null || true
  git reflog expire --expire=now --expire-unreachable=now --all
  git gc --prune=now --quiet
)

echo "== 5/6 проверка"
(
  cd "$CLONE_DIR"
  node - "$SECRET" <<'NODE'
const { execFileSync } = require("child_process");
const secret = process.argv[2];
const git = (args, input) => {
  const opts = { maxBuffer: 1 << 30 };
  if (input !== undefined) opts.input = input;
  return execFileSync("git", args, opts);
};
const list = git(["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"])
  .toString().trim().split("\n").filter(Boolean);
const needle = Buffer.from(secret, "utf8");
let blobs = 0;
const hits = [];
for (const line of list) {
  const [oid, type] = line.split(" ");
  if (type !== "blob") continue;
  blobs++;
  if (git(["cat-file", "blob", oid]).includes(needle)) hits.push(oid);
}
console.log("   объектов всего:", list.length, "| blob'ов:", blobs);
if (hits.length) {
  console.log("   ОШИБКА: секрет найден в blob'ах:", hits.slice(0, 5).join(", "));
  process.exit(1);
}
console.log("   OK: секрет не найден ни в одном объекте");
NODE
)

echo "== 6/6 подмена .git"
rm -rf "$REPO_ROOT/.git"
cp -a "$CLONE_DIR/" "$REPO_ROOT/.git"
rm -f "$REPO_ROOT/.git/info/refs" 2>/dev/null || true
git -C "$REPO_ROOT" config core.bare false
# Индекс bare-клона пуст: перечитываем его из HEAD, чтобы рабочее дерево
# не выглядело как «все файлы удалены».
git -C "$REPO_ROOT" reset --quiet
echo "   готово. Бэкап: $BACKUP_DIR/git-backup"
