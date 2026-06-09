# SQLite Trigger Deployment Bug — Root Cause Analysis

## Symptom

Running `cds serve` against `tests/bookshop` fails with:

```
SqliteError: no such table: main.SAP_CAPIRE_BOOKSHOP_BOOKSTORES in:
CREATE TRIGGER IF NOT EXISTS SAP_CAPIRE_BOOKSHOP_BOOKSTORES_ct_create AFTER INSERT
    ON SAP_CAPIRE_BOOKSHOP_BOOKSTORES
    ...
```

when triggers are registered during compile time. Even though the trigger statement is appended **after** the `CREATE TABLE` statements in the DDL array.

## Root Cause

The DDL array is correctly ordered (tables first, triggers last). The issue is not in the ordering, but how `cds.deploy` executes the array.

1. **[`lib/sqlite/register.js`](../lib/sqlite/register.js)** appends the trigger SQL to the DDL array returned by `cds.compile.to.sql`:

   ```js
   // lib/sqlite/register.js
   cds.on('compile.to.dbx', (csn, options, next) => {
     const ddl = next();
     if (options?.kind !== 'sqlite') return ddl;
     const triggers = generateTriggers(csn);
     ddl.push(...triggers); // pushed AFTER all CREATE TABLE / CREATE VIEW
     return ddl;
   });
   ```

2. **`@sap/cds/lib/dbs/cds-deploy.js`** calls `db.run` with the whole array in one go:

   ```js
   // node_modules/@sap/cds/lib/dbs/cds-deploy.js:121-122
   await db.run(drops)
   await db.run(creas) // creas = [CREATE TABLE..., CREATE VIEW..., CREATE TRIGGER...]
   ```

3. **`@sap/cds/lib/srv/srv-dispatch.js`** detects the array and runs `this.dispatch` via `Promise.all`:

   ```js
   // node_modules/@sap/cds/lib/srv/srv-dispatch.js:24
   async dispatch (req) {
     // Handle batches of queries
     if (_is_array(req.query)) return Promise.all (req.query.map (
       q => this.dispatch ({ query:q, context: req.context, __proto__:req })
     ))
     ...
   }
   ```

4. **`@cap-js/db-service/lib/SQLService.js`** prepares each statement.
   Within a single pipeline, `prepare` is awaited and `run` follows
   sequentially — but across pipelines the awaits interleave, so **all
   `prepare()` calls fire before any `run()` executes**:

   ```js
   // node_modules/@cap-js/db-service/lib/SQLService.js:311
   async onPlainSQL({ query, data }, next) {
     // calls Database.prepare() which fails because the referenced table
     // has only been *prepared* — not yet *run* — by another concurrent
     // pipeline, so it does not yet exist in the live schema.
     const ps = await this.prepare(query)
     const exec = this.hasResults(query) ? d => ps.all(d) : d => ps.run(d)
     ...
   }
   ```

### Why CREATE TABLE + CREATE TRIGGER fails but CREATE VIEW does not

SQLite validates references differently for the two DDL types at **prepare time**:

| Statement | Prepare-time validation of referenced table |
|-----------|---------------------------------------------|
| `CREATE VIEW v AS SELECT ... FROM foo` | **No** — the view body is stored as text and only resolved when the view is queried |
| `CREATE TRIGGER t AFTER INSERT ON foo BEGIN ... END` | **Yes** — the `ON <table>` clause requires `foo` to exist in the live schema |

Demonstration:

```js
const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.prepare('CREATE VIEW v1 AS SELECT id FROM foo');                          // OK
db.prepare('CREATE TRIGGER t1 AFTER INSERT ON foo BEGIN SELECT 1; END');     // FAILS: no such table: main.foo
```

So under the parallel `Promise.all` dispatch:

- All `CREATE VIEW` prepares succeed (no dependency check)
- The `CREATE TRIGGER` prepare fails because the `CREATE TABLE` has only been *prepared*, not yet *executed* and SQLite's trigger compiler insists the table exists in the live schema right now

The fix is to keep `CREATE TRIGGER` statements out of the deploy array and run them sequentially **after** `cds.deploy` finishes (e.g. `Promise.all(triggers.map(t => await cds.db.run(t))`). 
