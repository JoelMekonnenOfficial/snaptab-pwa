# SnapTab Privacy Policy

**Effective date:** 2026-06-02 _(initial release — update if you ship a materially different build)_

This is the privacy policy for SnapTab, a personal receipt and expense
tracker. The short version, in plain English:

> SnapTab does not have a server. We do not collect anything. We do not
> upload your photos. We do not ask for your bank account. We do not run
> analytics or advertising. Everything you put into SnapTab stays in your
> browser's storage on the device you used.

---

## 1. Data we collect from you

**None.** SnapTab is fully local. We do not operate any service that receives
your data. No account creation is required and no account exists.

Specifically, we do **not** collect:

- Names, email addresses, phone numbers, or any other contact information.
- Payment information, card numbers, or bank account credentials.
- Bank, credit-card, or financial-institution transaction data.
- Device identifiers, advertising IDs, IP addresses, or location data.
- Crash reports, telemetry, or analytics events.
- The contents of any receipt, note, tag, or photo you enter into the app.

There is no sign-up, sign-in, or "send to support" feature that transmits
your data off the device.

---

## 2. Data stored on your device

When you use SnapTab, the following information is written to your browser's
local storage (specifically the IndexedDB API) **on your device only**:

- Receipt records you create (date, merchant, amount, currency, category,
  payment method, project/client tag, notes).
- Photos you attach, after on-device compression to a reasonable size.
- Mileage entries with miles, optional odometer readings, and the rate per
  mile you entered.
- Your preferences (theme, large-text mode, currency, default mileage rate,
  custom categories, autocomplete history for merchants and tags).

This data never leaves your device through SnapTab. It is readable only by
SnapTab on the same browser profile and the same device. Clearing your
browser's site data, uninstalling the app, or using the in-app "Erase all
data" control will delete it.

---

## 3. Photos

Photos you attach to receipts are stored as compressed JPEG blobs in
IndexedDB on your device. SnapTab never uploads them anywhere. If you use
the share or export features (see section 5), the photos leave SnapTab only
through actions you explicitly initiate, to destinations you choose.

---

## 4. Cookies, tracking, analytics

SnapTab uses **no** cookies, **no** tracking pixels, **no** analytics
products, and **no** advertising SDKs. There is no first-party or
third-party tracking inside the app.

The application requires no runtime network calls to function. The only
network activity is during initial download of the app shell itself (HTML,
CSS, JavaScript, icons), which is then cached by the Service Worker for
offline use.

---

## 5. Third-party services

**There are none.** SnapTab does not integrate with any third-party service
during normal use. We do not embed third-party SDKs, fonts, CDNs, social
logins, advertising networks, or analytics tools.

The only times your data may leave the app are when **you** choose to:

- **Export a CSV file.** A file is generated locally and saved through your
  browser's standard download dialog or the system file picker. Where the
  file goes after that is up to you.
- **Download the photo archive (ZIP).** Generated locally and saved through
  your browser's standard download flow.
- **Use the "Share" button** on an individual receipt or CSV export. This
  invokes your operating system's Web Share dialog. Whatever destination
  you pick (email, messages, cloud storage, etc.) will receive that file
  according to that service's own policy, not ours.

---

## 6. Data retention

SnapTab keeps your data on your device **for as long as you keep it there**.
There is no automatic expiry. You may delete individual receipts at any
time. To remove all data, use **Settings → Erase all data** inside the app,
or clear site data for SnapTab in your browser's settings.

Because we never receive your data, there is nothing for us to retain.

---

## 7. Backups

SnapTab can produce a JSON backup file containing every receipt, every
attached photo (encoded), and your preferences. The backup file is saved
through your browser's normal download flow and is stored wherever you put
it. **Backup files are your responsibility.** Anyone who can read a backup
file can read your receipt data. Store them somewhere you trust.

---

## 8. Your rights (GDPR, UK GDPR, CCPA, and similar laws)

Because SnapTab does not collect, process, or store personal data on any
server we control, the data-subject rights granted by laws such as the
GDPR, the UK GDPR, the California Consumer Privacy Act, and equivalent
statutes are satisfied locally:

- **Access:** All your data is on your device. Open SnapTab to view it.
- **Portability:** Export a JSON backup or a CSV export at any time.
- **Rectification:** Edit any receipt directly inside the app.
- **Erasure:** Delete individual receipts or use **Erase all data** for a
  full wipe.
- **Objection / Restriction:** SnapTab does not process your data for any
  purpose other than displaying it back to you on the same device.

We do not sell or "share" personal information (as those terms are defined
under the CCPA/CPRA) because we have no personal information to sell or
share.

---

## 9. Children

SnapTab is a general-audience productivity tool not directed at children
under 13 (or under 16, where local law sets a higher age of consent for
data processing). The app does not collect any data and contains no
advertising or behavioral content. Parents and guardians who choose to let
a child use the app should know that the child's data, like any other
user's, remains on the device.

---

## 10. Security

Your data is protected by the same browser-level isolation that protects
any other website's storage on your device: another website cannot read
SnapTab's IndexedDB. Beyond that, the security of the device — your screen
lock, your account password, your operating system updates — is what
protects the data. We recommend keeping your device updated and using a
device passcode.

---

## 11. Changes to this policy

If we change this policy in a way that materially affects users (for
example, if a future optional feature ever did involve sending data
somewhere), we will update this page, raise the effective date, and call
the change out clearly in the app's "What's New" notes for the version
that introduces it. The default position of SnapTab is and will remain
local-only.

---

## 12. Contact

Questions about this policy can be sent to:

privacy+snaptab@joelmekonnen.com

(If this address is not yet configured as a forwarder on joelmekonnen.com,
either set up the forwarder before publishing OR replace this line with your
preferred public contact — Apple and Google both require a working email.)
