# SplitSnap: user guide

SplitSnap is a Splitwise-style app for sharing bills with friends, built for iPhone and Android.
You can photograph a restaurant bill and SplitSnap reads the items, prices and taxes. Then you
tap who had each item, and it works out what everyone owes, tax included.

It is a prototype. It runs in **Expo Snack** (Expo's free online editor) and in the free
**Expo Go** app on your phone. Nothing is installed on your PC.

---

## 1. Open the app

1. Open `open-in-snack.html` (in this folder) in **Microsoft Edge or Chrome**.
   - Don't open it in a preview pane (Outlook, Teams, a file viewer). Previews block the page's
     script, so the button does nothing.
   - In File Explorer: right-click the file → **Open with** → **Microsoft Edge**.
2. Click **Run SplitSnap in Expo Snack**. After about 30 seconds the app runs in the **Web**
   preview next to the code.
3. Click the **↗** icon at the top of the Snack to open Snack's full editor in a new tab. From
   there you can:
   - switch the preview to **iOS** or **Android**: Snack's in-browser phone simulators (they can
     take a minute to start), or
   - use **My Device** to run the app on your own phone (see below).

### On an iPhone (published app: your data is kept)
The App Store's Expo Go now runs **SDK 58**, which Snack can't build, so the iPhone uses the
**published** app instead. Every push to GitHub publishes it automatically through Expo's free
update service (`.github/workflows/publish.yml`). Your data stays on the phone across restarts
and new versions.
1. In **Expo Go**, sign in to your free Expo account.
2. On expo.dev, open **SplitSnap → Over-the-air updates → Update groups**, open the newest
   update and scan its QR code with the iPhone **Camera**. After that it is under **Recently
   opened** in Expo Go.
3. Snack's in-browser iPhone simulator (**iOS** in the full editor) still works for quick looks,
   but it doesn't keep data.

### On an Android phone
1. Install **Expo Go for SDK 54**. Use the Play Store version if it supports SDK 54. If it is
   for a newer SDK, download the free SDK 54 build from [expo.dev/go](https://expo.dev/go).
   No login is needed.
2. In the full editor open **My Device** and scan the QR code with Expo Go.

If the phone shows an error screen, tap **View error log** to see the details.

---

## 2. What you can do

**Groups**
- Create groups (Trip, Home, Couple, Other) with a picture, members, a default currency and a
  "simplify debts" setting.
- Each group has a timeline by month, its balances (who owes whom, with Settle up and Remind),
  totals with charts (by category, month and payer) and a CSV export.
- Groups can be archived, and deleted once everyone is settled up.
- **Import from Splitwise** (Groups tab or Settings): choose a group's Splitwise
  "Export as spreadsheet" CSV (or paste its text). Pick which column is you, name the group, and
  bring over every expense and payment, or only the final balances. The preview checks the result
  against the file's "Total balance" row before anything is saved.

**Friends**
- Add, edit and remove friends, and add a removed friend back.
- Each friend shows your balance with them overall and by group, plus your shared history.
- **Remind** shares a reminder message. **Pay via UPI** opens a UPI app and then records the
  payment.

**Expenses**
- Add an expense to a group or with friends, in 25 currencies.
- The category is guessed from the description (18 categories), and you can change it.
- Set the date and notes, and attach a bill photo.
- Repeat it weekly, every 2 weeks, monthly or yearly.
- **Paid by:** you, someone else, or several people.
- **Split:** equally, exact amounts, percentages, shares, adjustments, or **item by item**.
- Expense details show who paid, who owes what, the full per-person bill breakdown and the bill
  photo. You can also comment.
- Deleted expenses can be restored.

**Settling up**
- Record payments by Cash, UPI, Bank or Other, from a group, a friend or the overall
  "who owes whom" list.
- Payments can be viewed and deleted.

**Also**
- An **Activity** feed of everything that happened.
- **Search** across descriptions, bill items, notes and people.
- **Account:** your name and colour, default currency, **Appearance** (System / Light / Dark mode), and your totals.
- **Settings:** bill scanning key and engine, defaults, export everything as CSV, import a
  Splitwise group, reset the demo data, or clear all data.

---

## 3. Bill scanning

From **Add expense** (or a group's **Scan bill**) choose one of these:
- **Take photo**: on a phone this opens the camera; in the web preview it opens a file picker.
- **Choose from gallery**: pick a photo or screenshot of the bill.
- **Try a sample bill**: a built-in restaurant bill. It needs no photo and no internet.

Reading the text is done by **OCR.space**, a free online service. Your photo is shrunk to fit its
1 MB limit and sent to OCR.space, and nothing else is sent. SplitSnap's own parser then finds
the items, quantities, prices, taxes and the printed total. You can check and edit everything on
the review screen before splitting.

- **Demo key (default):** works with no setup, but it is shared by everyone and rate-limited, so
  scans can fail at busy times.
- **Your own free key:** get one in a minute at
  [ocr.space/ocrapi/freekey](https://ocr.space/ocrapi/freekey) (email only, no payment). Paste it
  in **Account → Settings → OCR.space API key**. The free plan allows about 25,000 scans a month.
- **OCR engine** (in Settings): Engine 2 is the default and is best for receipts. Engine 1 is
  faster, and Engine 3 is the most accurate but slower.

---

## 4. Splitting a bill item by item (worked example)

This uses the sample bill: **SPICE GARDEN**, items ₹1,390.00, CGST 2.5% + SGST 2.5% + round off
₹70.00, **total ₹1,460.00**.

1. **Groups → Goa Trip → Scan bill → Try a sample bill.**
2. Check the bill: 6 Naan ₹360, Butter Chicken ₹420, Chicken Lababdar ₹450, 2 Gulab Jamun ₹160,
   and the two GST lines plus round off. Tap **Continue to split**.
3. Every item starts with everyone ticked. Tap a name to take that person off the item:

   | Item | Price | Shared by |
   |---|---|---|
   | 6 Naan | ₹360 | Aarav, Bhavna, Chirag, Diya |
   | Butter Chicken | ₹420 | Aarav, Chirag |
   | Chicken Lababdar | ₹450 | Bhavna, Chirag, Diya |
   | 2 Gulab Jamun | ₹160 | Bhavna, Diya |

   (Untick **You** on every item, since you didn't eat.)
4. Tap **Bill total · tap for breakdown**. Tax and round off are shared in proportion to what each
   person had, like tax on the real bill:

   | Person | Items | + GST & round off | Pays |
   |---|---|---|---|
   | Aarav | ₹300.00 | ₹15.11 | **₹315.11** |
   | Bhavna | ₹320.00 | ₹16.12 | **₹336.12** |
   | Chirag | ₹450.00 | ₹22.66 | **₹472.66** |
   | Diya | ₹320.00 | ₹16.11 | **₹336.11** |
   | **Total** | ₹1,390.00 | ₹70.00 | **₹1,460.00** |

5. Tap **Done**, then **Save**. You paid, so Goa Trip now shows you are owed ₹1,460.00 more.

**Unequal portions:** on an item, tap **Split unequally** and use the steppers. For example, if
Aarav and Chirag ate 2 naan each and Bhavna and Diya 1 each (A:2, B:1, C:2, D:1), the ₹360 of naan
splits as ₹120 / ₹60 / ₹120 / ₹60.

**Other options:**
- **Add item:** type in a bill by hand. Under the price, tick who shared the item before you
  tap **Add item** (it starts on **Everyone** each time; **Clear** then one name for a dish only
  one person had), so you don't have to scroll back up.
- **Add tax, tip or discount:** Tax %, Service %, Tip, Discount or Other. Each charge can be
  shared **Proportionally** or **Equally**.
- **Split the unassigned items among everyone:** shares out items nobody has been ticked on.
- **Edit items:** reopens the split later from the expense.

---

## 5. Your data

Everything is stored **only on the device or browser** that runs the app: no account, no server,
no sync. The only thing that leaves the device is a bill photo when you scan it (it goes to
OCR.space).

An imported Splitwise file is read on the phone; it is not uploaded anywhere.

To start over, use **Account → Settings**:
- **Reset demo data** loads the sample groups and friends again and keeps your name and key.
- **Clear all data** gives you an empty app.

---

## 6. Limitations

- It is a prototype for one device. Friends don't get the app or see your entries, and there are
  no logins or sync.
- No real money moves. "Settle up" only records a payment. **Pay via UPI** opens a UPI app only on
  phones that have one; in the web preview it just offers to record the payment.
- Scans depend on photo quality and on OCR.space. Always check the review screen.
- Snack's web preview has no real camera, so **Take photo** opens a file picker there.

## 7. Costs

None beyond the Claude subscription. Expo Snack, Expo Go, the Expo account and the OCR.space key
are all free. Publishing to the App Store or Play Store would cost money (developer accounts), so
it has not been done.

## 8. Future ideas

Parked feature ideas live in `novelty-features\`. They are **not part of this build** and won't be
built without your approval. For example, `01` (Remind sends a ping to the other person's phone)
is only a plan.

---

## 9. Folder layout and developer tools

| Path | What it is |
|---|---|
| `open-in-snack.html` | The launcher page (section 1) |
| `app\` | The app source (React Native + Expo SDK 54, TypeScript), sent to Snack |
| `docs\ARCHITECTURE.md` | Module contract and design decisions (§10: why SDK 54) |
| `tests\` | Unit tests |
| `tools\` | PowerShell tools; they run in hidden Microsoft Edge, with no installs |
| `novelty-features\` | Parked ideas (section 8) |

Run the tools from this folder with
`powershell -NoProfile -ExecutionPolicy Bypass -File tools\<script>.ps1`:

- `run-tests.ps1`: runs all unit tests (`-Filter money` runs only matching files).
- `typecheck.ps1`: strict TypeScript check. `-Sdk 54` is the default; `-Sdk 55` also works.
- `build-snack-launcher.ps1`: rebuilds `open-in-snack.html`. `-SdkVersion` defaults to `54.0.0`.
  **Re-run this after any change under `app\`.**
- `cdp-drive.ps1`: drives the app in Snack's web preview for testing (tap, type, screenshot).
  See its header for the steps.
