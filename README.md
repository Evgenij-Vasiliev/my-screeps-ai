# newScreeps

Исходники бота для [Screeps](https://screeps.com) (официальный шард, ветка деплоя `test`).

## Токен Screeps

Токен деплоя и API **не хранится в репозитории**. Единая точка получения —
`screeps.token.js`; порядок источников:

1. переменная окружения `SCREEPS_TOKEN` (или legacy `SCREEPS_AUTH_TOKEN`);
2. `.screeps.json` **в корне проекта**;
3. `~/.screeps.json` — fallback самой библиотеки `screeps-api`.

`Gruntfile.js` и все live-тесты (`tests/live.*.js`, `tests/_*.js`) читают токен
через `resolveToken()`/`requireToken()` из `screeps.token.js`.

### Ротация токена (при утечке)

1. Отозвать старый токен: Screeps → **Account → Auth tokens** → удалить
   скомпрометированный.
2. Создать новый токен там же.
3. Прописать новый токен **вне git**, любым из способов:
   - `export SCREEPS_TOKEN=...` (приоритетный и предпочтительный для CI);
   - отредактировать `.screeps.json` в корне проекта (файл в `.gitignore`).
4. Если старый токен лежал в `~/.screeps.json` — заменить его и там
   (файл вне репозитория, но всё ещё содержит секрет).
5. Проверить, что секрет не попал в git:

   ```sh
   git log --all -S'<старый_токен>' --oneline
   git grep '<старый_токен>' $(git rev-list --all)
   ```

### Очистка истории git

Инструмент `scripts/run-history-scrub.sh` переписывает историю всех ветвей и
удаляет секрет из всех объектов (эквивалент `git filter-repo --replace-text`,
реализован на git plumbing без Python):

```sh
scripts/run-history-scrub.sh '<секрет>' '[REDACTED]'
```

Скрипт делает зеркальный клон, заменяет секрет во всех blob'ах, чистит
недостижимые объекты и подменяет `.git`, оставляя бэкап старого `.git`.
**Push после этого требует `--force`.**

## Деплой

```sh
npx grunt screeps
```

Требуется заданный `SCREEPS_TOKEN` или `.screeps.json`; `screeps.token.js`
исключён из выгрузки, чтобы служебный код не попадал на сервер.

## Тесты

`tests/` в `.gitignore` — это локальные live-скрипты, работающие с реальным
сервером:

```sh
node tests/live.dump.rooms.js
```

Без токена они падают с понятной ошибкой из `requireToken()`.
