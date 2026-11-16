---
name: eva-chores
description: Use for the scheduled chores sync (copying the kitchen board's chore activity into the Notion ledger), when anyone asks about chores, allowance, pocket money, what the girls are owed or paying the girls, and when Michael asks to add, change or retire a chore or change an amount. Moves data between the board (through the script) and Notion and Todoist (through your own tools).
---

# Chores and allowance

## The family and the money

The family is Michael and Nozomi (the parents), Mariko (11) and Sarina (8), at
home in Tokyo. Only the girls have chores. The chores are on the kitchen board
(an Echo Show 15 on the wall). A girl taps a chore there when she has done it,
and taps it again to undo it.

Each chore earns its own amount, in yen (¥100 each today). The board adds it
up and shows each girl "¥N to pay". When a parent pays her, they tap "Mark
paid" on the board, or tell you and you record it. Money is yen only, whole
numbers, no coins and no other currency.

## Who owns what

- **Notion owns the chore definitions**: names, who, icon, amount, schedule,
  active or not. You change them in Notion and push them to the board.
- **The board owns the activity**: every tick, undo and payment, in order. You
  copy it into the Notion Ledger. The copy is a record for Michael to browse.

So:

- **Never edit or delete a Ledger row.** Each one is a copy of a board event.
  An edited row makes Notion disagree with the board about money, and nothing
  would ever notice.
- **Never "fix" activity in Notion.** If a girl ticked by mistake, she undoes it
  on the board; the undo arrives as its own row. If a payment was wrong, record
  a correction with `pay` (below).
- **Never mark a chore done** for anyone. There is no command for it on purpose.
- **Never compose an amount, a balance or a Ledger row yourself.** Copy the
  script's rows exactly as printed, every property, every character. Quote
  balances from `balances`, not from Notion sums. The arithmetic lives in code
  so it is the same every time.
- **Never write HTTP to the board by hand.** Use the script. It checks what it
  sends, and refuses rather than sending something half right.

## The tool

`scripts/eva_chores.py` in this skill's folder (installed:
`~/.hermes/skills/eva-chores/scripts/eva_chores.py`). Python standard library
only. It needs `WALLBOARD_TOKEN` in the environment (and optionally
`WALLBOARD_URL`). It talks only to the board. Notion and Todoist are yours,
through your own tools.

```bash
python3 eva_chores.py activity --log-id <Board log id> --after <Last seq>   # new board events as Ledger rows
python3 eva_chores.py activity                                             # first run only: no cursor yet
echo '<JSON array of Chores rows>' | python3 eva_chores.py push-chores      # replace the board's chore list
python3 eva_chores.py balances                                             # what each girl is owed
python3 eva_chores.py pay sarina 500 --note "Michael: paid Sarina 500 yen"  # record a payment
python3 eva_chores.py new-chore-id "Feed the fish" --taken chore-dishes chore-bed   # a Board id for a new chore
```

Output is JSON on stdout. On an error it prints `error: ...` on stderr and
exits non-zero; nothing was changed on the board in that case.

## One-time setup

Do this once, with your Notion tools, when Michael asks you to set up the
chores ledger. Use these names exactly, including capitals, spaces and the ¥
sign. The script reads and writes these exact names; a renamed property is
read as missing.

Create a page **"Chores & allowance"** with three databases in it.

**Chores**, one row per chore:

| Property | Type | Notes |
|---|---|---|
| `Name` | title | What the board shows, e.g. "Unload the dishwasher" |
| `Board id` | text | Made once by `new-chore-id`, never changed |
| `Who` | select | Mariko, Sarina |
| `Icon` | select | dishes, clear-table, tub-clean, vacuum, dust, garbage, windows, living-room, toilet, bed, bag, table, shoes, laundry, plants |
| `Amount ¥` | number | Whole yen, 0 or more |
| `Every` | number | Whole number, 1 or more |
| `Unit` | select | day, week |
| `Start` | date | The first day it is due; sets which days it falls on |
| `Active` | checkbox | Only ticked chores go to the board |

**Ledger**, one row per board event, never edited or deleted:

| Property | Type | Notes |
|---|---|---|
| `Event id` | title | The board's id for the event |
| `Type` | select | done, undone, payment |
| `Who` | select | Mariko, Sarina |
| `Chore` | text | The chore's name at the time |
| `Chore id` | text | The chore's Board id |
| `Amount ¥` | number | Signed: plus for earned, minus for paid or undone |
| `At` | date | Date and time, Tokyo |
| `Cancels` | text | For an undo: the Event id it cancels |
| `Source` | select | board, eva (payments only) |
| `Note` | text | Payments only |
| `Board log id` | text | Which board log the event came from |

Add two views of the Ledger, **"Mariko"** and **"Sarina"**: each filtered to
that `Who`, grouped by month, showing the sum of `Amount ¥`. That sum is what
she is owed. It is for Michael to browse; you quote `balances`.

**Settings**, exactly one row:

| Property | Type | Value at setup |
|---|---|---|
| `Name` | title | Settings |
| `Default amount ¥` | number | 100 |
| `Board log id` | text | empty |
| `Last seq` | number | empty |
| `Alarm` | text | empty |
| `Alarm at` | date | empty |

`Board log id` and `Last seq` together are the cursor: how far into the board's
log the Ledger has been copied. It lives in Notion so it survives a reinstall
of you.

Then enter the chores with Michael (see "Changing chores") and run the sync
once by hand.

The scheduled job to add: every 15 minutes, with the prompt *"Run the chores
sync, using the eva-chores skill."*

## The scheduled sync

1. **Push the definitions.** Read every row of the Chores database. Pipe them
   all, as a JSON array keyed by the property names above, into
   `push-chores`. Include every row, not only the ones you think changed:
   the board replaces its whole list with what you send, so a missing row is a
   chore that disappears from the wall. (The script skips rows whose `Active`
   is not ticked.) If it fails, note the error and carry on; the next run
   pushes again.
2. **Read the cursor** from the Settings row: `Board log id` and `Last seq`.
3. **Read the activity.** Run
   `activity --log-id <Board log id> --after <Last seq>`. If both are empty
   (the very first run), run `activity` with no flags. The output is
   `{"alarm", "rows", "cursor"}`. If `alarm` is not null, follow "The one
   alarm" and stop here.
4. **Copy the rows**, in the order given. For each row, query the Ledger for a
   row with that `Event id`. If there is one, skip it and do not change it. If
   there is none, create it with exactly the properties and values printed.
   This check is what makes a retried or half-finished run safe.
5. **Write the cursor** to the Settings row: `cursor.logId` into
   `Board log id`, `cursor.seq` into `Last seq`. Only do this after every row
   is in. If any row failed, stop without writing the cursor; the next run
   starts from the old cursor and the `Event id` check skips what is already
   there. Writing the cursor early would skip the missing rows forever.

When there are no new rows and nothing failed, there is nothing to report.

## The one alarm

`alarm` is set when the board has lost history: its log was replaced
(`"kind": "log-replaced"`) or its count went backwards (`"kind":
"seq-went-back"`). It is the only thing this skill flags, because it is the
only thing that can lose money records. When it is set, `rows` is empty and
`cursor` is the old one.

1. **Stop copying.** Do not create Ledger rows and do not write the cursor.
   (Step 1 still pushed the definitions, so the board keeps working for the
   girls.)
2. **Read the Settings row's `Alarm`.** It is already recorded if it holds an
   alarm with the same `kind` and the same `expected` as this one. (`found`
   moves as the girls keep ticking; that is the same alarm, not a new one.)
3. **If it is already recorded, do nothing more.** One alarm, one task. Never a
   task every 15 minutes.
4. **If `Alarm` is empty or holds a different alarm**: write the `alarm` JSON,
   exactly as printed, into `Alarm`, and now into `Alarm at`. Then create one
   Todoist task for Michael:
   - title: **Chores ledger: the board lost history — check Notion**
   - priority: p1 (urgent)
   - due: today
   - description: the link to the Settings page, and the alarm JSON.

**Never repair it.** Don't reset the cursor, don't copy anyway, don't
re-create anything on the board. Michael decides what happened and fixes it by
hand. When he clears `Alarm` and resets the cursor, the next sync carries on
by itself.

## Changing chores

Michael (only Michael) can ask you to add a chore, change one, retire one, or
change an amount or the default. Write Notion first, then push. Notion is the
truth; the board is a copy of it.

- **New chore**: run `new-chore-id "<Name>" --taken <every existing Board id>`
  and put the result in `Board id`. Pass every Board id in the Chores database,
  active or not, so an old id is never reused. `Amount ¥` is the Settings
  row's `Default amount ¥` unless he says otherwise. Ask for anything you
  can't work out (who, how often, which day it starts). Pick the `Icon` that
  fits best from the list; leave it empty if none does. Tick `Active`.
- **Change a chore**: edit its row. Never change its `Board id`: the board and
  every Ledger row know the chore by it.
- **Retire a chore**: untick `Active`. Never delete the row; its Ledger rows
  still point at its `Board id`.
- **Change the default**: edit `Default amount ¥` on the Settings row. It only
  applies to chores added from now on. Change existing chores' `Amount ¥` only
  if he asks.

Then re-read the whole Chores database and pipe it into `push-chores`, as in
step 1 of the sync. The change is not done until both have succeeded. If the
push fails, say so plainly: "Notion has the change, but the board didn't take
it: <error>. The next sync will try again." If the script refused a row
(`Nothing was sent.`), fix that row in Notion and push again.

Never change the board's activity to match a change. A new amount applies to
ticks from now on; what was already earned stays as it was.

## Payments told to Eva

When a parent tells you they paid a girl, record it on the board, never
straight into Notion:

```bash
python3 eva_chores.py pay sarina 700 --note "Nozomi: gave Sarina her 700 yen"
```

`WHO` is lowercase: `mariko` or `sarina`. `AMOUNT` is whole yen. `--note` is
what they said, in their words. Then run the sync, so the payment reaches the
Ledger now rather than in 15 minutes.

If `pay` fails, check `balances` before trying again: if the payment is already
in `paid`, it got through and only the answer was lost. Paying twice would
take money off a girl that she is still owed.

**An opening balance or a correction** is a payment with a negative amount,
which is a credit (it adds to what she is owed). Always with a note saying why:

```bash
python3 eva_chores.py pay mariko -1200 --note "Opening balance from Michael"
python3 eva_chores.py pay sarina -100 --note "Correction: paid 100 too much on Friday"
```

Do this only when Michael asks for it.

## Answering

For "How much does Sarina have coming?", "Have the girls been paid?" and the
like, run `balances`. Per girl it gives `owed`, `earned` and `paid` in yen and
`lastPaid` (a date, or null). Answer in one sentence, in yen, with the date in
words:

- "Sarina has ¥700 coming; she was last paid on Friday."
- "Mariko is owed ¥300 and Sarina ¥500."

Quote `balances`, not the Notion views or your own sums. For what was done
when, read the Ledger.
