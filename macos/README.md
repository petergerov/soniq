# macOS app and signed DMG (CI)

The **Mac app** workflow (`.github/workflows/mac-app.yml`) builds `SONIQ.app` and `SONIQ.dmg` on an Apple Silicon runner,
signs them with your **Developer ID Application** certificate and, if credentials are configured, notarizes the DMG with
Apple. On a version tag (`v1.2.3`) it attaches `SONIQ-1.2.3.dmg` to a GitHub Release.

To make that work, GitHub needs a few **secrets**. This guide walks you through getting every value, step by step.
Already set up **Audio Harbor**? The secrets have the same names and values: repeat steps 3 and 4 in this repository with
the same files.

**Overview**

| Step | What | Required? |
|---|---|---|
| 1 | Check the Developer ID certificate on your Mac | yes |
| 2 | Export it into a `.p12` file | yes |
| 3 | Add `MACOS_CERTIFICATE` + `MACOS_CERTIFICATE_PASSWORD` to GitHub | yes |
| 4 | Set up notarization (API key **or** Apple ID) | recommended |
| 5 | Run the workflow / publish a release | – |
| 6 | Clean up | yes |

Without any secrets the workflow still runs and produces an **ad hoc signed** DMG: fine for testing, but on other Macs it
only opens via *System Settings › Privacy & Security › Open Anyway*.

---

## Where secrets go in GitHub

Repo → **Settings** → **Secrets and variables** → **Actions** → tab **Secrets** → **New repository secret**.

- Use **Secrets**, not *Variables*. The workflow reads `secrets.*`, and variables are visible in plain text.
- Use **Repository secrets**, not *Environment secrets*. The job doesn't declare an `environment:`, so environment secrets would be empty for it.
- Names must match **exactly** (all caps, underscores).

Alternative from the terminal with the GitHub CLI (`gh`):

```bash
gh secret set SECRET_NAME            # prompts for the value
gh secret set SECRET_NAME < file.txt # reads the value from a file
```

---

## Step 1 — Check your Developer ID certificate

Open Terminal and run:

```bash
security find-identity -v | grep "Developer ID"
```

You need this line:

```
"Developer ID Application: Petar Gerov (C9LBGZNZ6P)"
```

The value in parentheses (`C9LBGZNZ6P`) is your **Team ID**. Keep it in mind for step 4 (option B).

> **Which certificate do I need?** Only **Developer ID Application**: SONIQ ships as a DMG with an app inside, not as a
> `.pkg` installer. If your Mac also has *Developer ID Installer* (e.g. for Audio Harbor), it may be in the `.p12` too;
> it is simply not used here.
> Ignore these: *Apple Development* (local debugging), *Apple Distribution* and *3rd Party Mac Developer Installer* (App Store only).

**Missing?** Create it in Xcode: **Xcode → Settings → Accounts** → select your Apple ID → team → **Manage Certificates…** →
**+** → *Developer ID Application*. (Only the account holder of the team may create Developer ID certificates.)

---

## Step 2 — Export the certificate into a `.p12`

1. Open **Keychain Access** (Spotlight: "Keychain Access" / "Schlüsselbundverwaltung").
2. In the sidebar choose the **login** keychain, at the top choose the **My Certificates** tab.
   *Important:* only this tab exports the **private key** together with the certificate. Without the key the file can't sign anything.
3. Type `Developer ID Application` into the search field.
   (Optional check: click the ▸ arrow — there should be a private key underneath.)
4. Right-click → **Export "Developer ID Application: …"…**
5. File format: **Personal Information Exchange (.p12)**. Name: `SONIQ-Certificate.p12`, e.g. on the Desktop.
6. Choose a **password** for the file. Write it down — this is the value of `MACOS_CERTIFICATE_PASSWORD`.
7. macOS asks for your Mac login password to allow exporting the key → enter it, click **Allow**.

Check the file:

```bash
cd ~/Desktop
openssl pkcs12 -in SONIQ-Certificate.p12 -nokeys -legacy | grep "subject="
```

It asks for the `.p12` password. You should see a line with *Developer ID Application*.
(If `-legacy` gives an error, run the command without it.)

---

## Step 3 — Add the signing secrets to GitHub

**`MACOS_CERTIFICATE`** — the `.p12` file as Base64 text:

```bash
cd ~/Desktop
base64 -i SONIQ-Certificate.p12 | pbcopy
```

This copies a long block of text to the clipboard (nothing is printed — that's normal). In GitHub: **New repository
secret** → Name `MACOS_CERTIFICATE` → paste with ⌘V → **Add secret**.

**`MACOS_CERTIFICATE_PASSWORD`** — the password you chose in step 2, item 6.

With only these two secrets the workflow already produces a **signed** DMG (hardened runtime). Without notarization,
however, macOS Gatekeeper still warns when users open it — so do step 4 as well.

---

## Step 4 — Notarization (recommended)

Choose **one** of the two options. Option A is preferred for CI.

### Option A — App Store Connect API key (preferred)

You need three values: the key file (`.p8`), the **Key ID** and the **Issuer ID**.

1. Open [appstoreconnect.apple.com](https://appstoreconnect.apple.com) and sign in.
2. Go to **Users and Access** → tab **Integrations** → **App Store Connect API** (left) → **Team Keys**.
   (First time: you may have to click **Request Access** and accept the terms — account holder only.)
3. At the top of that page you'll see the **Issuer ID** (looks like `69a6de7e-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Copy it → this is `APPLE_API_ISSUER`.
4. Click **+** (Generate API Key). Name: e.g. `GitHub notarization`. Access: **Developer** is enough. → **Generate**.
5. The new key appears in the list. The **Key ID** column (10 characters, e.g. `AB12CD34EF`) → this is `APPLE_API_KEY_ID`.
6. Click **Download** next to the key. You get a file `AuthKey_AB12CD34EF.p8`.
   ⚠️ **You can download it only once.** If you lose it, revoke the key and create a new one.
7. Convert the file to Base64:

   ```bash
   cd ~/Downloads
   base64 -i AuthKey_AB12CD34EF.p8 | pbcopy
   ```

   → paste as `APPLE_API_KEY_BASE64`.

| Secret | Value | Where from |
|---|---|---|
| `APPLE_API_KEY_BASE64` | Base64 of the `.p8` file | step 7 |
| `APPLE_API_KEY_ID` | e.g. `AB12CD34EF` | step 5 |
| `APPLE_API_ISSUER` | UUID | step 3 |

One key can notarize for all your projects; the Audio Harbor key works here as well.

### Option B — Apple ID + app-specific password

1. Open [account.apple.com](https://account.apple.com) (formerly appleid.apple.com) and sign in.
2. **Sign-In and Security** → **App-Specific Passwords** → **+** / Generate.
3. Label: e.g. `GitHub notarization` → you get a password like `abcd-efgh-ijkl-mnop`. Copy it right away; it's shown only once.

| Secret | Value |
|---|---|
| `APPLE_ID` | your Apple ID email (the one in your developer account) |
| `APPLE_APP_SPECIFIC_PASSWORD` | the `abcd-efgh-ijkl-mnop` password from step 3 |
| `APPLE_TEAM_ID` | `C9LBGZNZ6P` (from step 1) |

### How the workflow decides

- `MACOS_CERTIFICATE` set → it signs with Developer ID; otherwise ad hoc.
- Additionally `APPLE_API_KEY_BASE64` **or** `APPLE_ID` set → it **must** notarize (fails if notarization fails). The API key wins if both are set.
- Manual run with **skip_notary** checked → it only signs, even if the secrets exist.
- Release notes say "Not notarized …" when a tag was built without signing or notarization.

---

## Step 5 — Run the workflow

**Test build** (no release): GitHub → **Actions** → **Mac app** → **Run workflow** → branch `develop` or `main`.
It also runs by itself on pushes to `main` / `develop` that touch `macos/`, the workflow or `scripts/common.sh`.
The DMG is attached to the run under **Artifacts**.

**Release**: set the version in `package.json`, merge to `main`, then tag and push:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The workflow builds `SONIQ-0.3.0.dmg` (the version comes from the tag) and creates the GitHub Release **SONIQ 0.3.0**.
The installed app finds it via **Gear › Check for updates** and marks the gear at start.

In the log, the step **Import signing certificate** lists the Developer ID identity, and **Notarize** ends with
`The staple and validate action worked!` and `source=Notarized Developer ID`.

---

## Step 6 — Clean up

The `.p12` and `.p8` files contain your **private keys**. Once the secrets are in GitHub:

```bash
rm ~/Desktop/SONIQ-Certificate.p12
rm ~/Downloads/AuthKey_*.p8
```

(Or store them in a password manager.) **Never commit them to the repo.**

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `zsh: command not found: pbcop` | Typo — it's `pbcopy`. |
| Step *Import signing certificate* is skipped | `MACOS_CERTIFICATE` is missing, misspelled, or stored as *Variable* / *Environment secret* instead of *Repository secret*. |
| `No 'Developer ID Application' identity in MACOS_CERTIFICATE` | The `.p12` contains a different certificate (e.g. only *Developer ID Installer*) → repeat step 2. |
| `security import` fails / wrong password | `MACOS_CERTIFICATE_PASSWORD` doesn't match the password from step 2. |
| Signing fails with "no private key" | Exported from the *Certificates* tab instead of *My Certificates* → repeat step 2. |
| Notarization: 401 / unauthorized | Key ID / Issuer swapped, or key revoked. With option B: use an app-specific password, not your normal Apple ID password. |
| Notarization "Invalid", log mentions *hardened runtime* or *signature* | Something in the app was changed after signing; run `macos/build-app.sh` again (it signs everything inside out). |
| App opens, but songs fail and `data/ace-server.log` says *Library not loaded* | Model server libraries not found → rebuild; `build-app.sh` sets the `rpath` to `Contents/Frameworks`. |

---

## What is inside

`macos/SONIQ/main.swift` is the **menu bar app** (Swift / AppKit, macOS 13.5+, no Dock icon). It starts the backend with
`MG_PACKAGED=1`; the backend starts the model server and shows the setup (download models, graphics self-test) while
models are missing. Quitting the app stops everything. Songs, settings and models live in
`~/Library/Application Support/SONIQ`.

| Path in `SONIQ.app/Contents` | Content |
|---|---|
| `MacOS/SONIQ` | menu bar app |
| `MacOS/node` | Node.js (checksum from `scripts/common.sh`), signed with JIT entitlements (`macos/node.entitlements`) |
| `MacOS/ace-server` | model server, own portable build (`engine/acestep.cpp/build-app`, `GGML_NATIVE=OFF`, macOS 13.5+) |
| `Frameworks/libggml*.dylib` | its libraries |
| `Resources/app/` | backend, shared types, `scripts/common.sh`, built interface |

## Local build

```bash
macos/build-app.sh            # dist-mac/SONIQ.app, signed ad hoc (runs on this Mac)
macos/build-app.sh --dmg      # plus dist-mac/SONIQ.dmg
```

Signed with your Developer ID from the login keychain, and notarized with the same variables as in CI, or with a stored
notarytool profile:

```bash
SIGN_IDENTITY="Developer ID Application: Petar Gerov (C9LBGZNZ6P)" macos/build-app.sh --dmg
xcrun notarytool store-credentials SONIQ      # one-time, interactive
SONIQ_NOTARY_PROFILE=SONIQ macos/notarize.sh dist-mac/SONIQ.dmg
```

Testing next to a running SONIQ from the project folder (other port, own data folder, other model server ports):

```bash
SONIQ_PORT=8793 SONIQ_HOME=/tmp/soniq-test MG_SYNTH_PORT=8185 MG_LM_PORT=8186 dist-mac/SONIQ.app/Contents/MacOS/SONIQ
```
