# Desktop manual QA

Run before a release on macOS and on Windows. Use a throwaway home so nothing touches your real
settings: `STORYBOARD_HOME=$(mktemp -d) npm run desktop:dev` (or start the packaged app with that
variable set).

## The release scenario

Every step must work in order on both platforms.

1. **First run** — the "Connect an AI service" dialog opens. Pick a service, paste a key, press
   Connect. A wrong key shows why it failed; a good one closes the dialog.
2. **New work** — New work → fill the three steps → Create. The desk opens with the title in the
   top bar. The folder exists under Documents/Storyboard. Versions shows «새 작품: …».
3. **Novel run** — Run → "Check every chapter" → Start. The stage rail moves, the log fills, the
   scene grid fills as drafts appear, the cost rises. At the end of chapter 1 the approval box
   appears; Continue.
4. **Pause and resume** — during chapter 2 press Pause: the status reads "finishing the scene", the
   run stops after that scene. Close and reopen the app, open the work: the drawer offers Resume;
   it continues from the next scene (finished scenes are not rewritten).
5. **Hand edit** — open a finished scene, change a sentence. "Saved" appears after a pause. Switch
   scenes: Versions shows «직접 고침: …», and `.draft/<scene>/` holds the pre-edit copy.
6. **AI edit** — select a sentence → Ask the AI → type an instruction → Get a proposal → Replace.
   The draft changes; Versions shows «AI 수정: …».
7. **Story bible** — change one field of a character, Save. Versions shows «설정집: …».
8. **Restore** — Versions → restore the version before step 5. The edit is gone; the newest version
   is «되돌림: …», and restoring the version above it brings the edit back.

## Other checks

- **Budget** — set this run's budget to 1 and start a run: it pauses on its own after the scene in
  which it passed $1, and the log says so.
- **Another app holds the work** — while the app is open, run `storyboard novel generate` in the
  work's folder: the desk turns read-only with the CLI named in a banner. Starting a run in the app
  is refused. When the CLI finishes, the banner goes away and the new drafts appear.
- **Changed outside** — with a draft open and no unsaved typing, edit the draft file in a text
  editor: the page reloads. With unsaved typing, a banner offers "Keep my edits" or "Load the changed
  draft".
- **Quit during a run** — close the window mid-run: the dialog offers to finish the scene, close now,
  or cancel. "Close now" and reopening offers Resume.
- **Language** — Settings → English: every screen switches; engine messages stay Korean.
- **Dark mode** — switch the OS appearance: the app follows and stays readable.
- **Update (packaged builds only)** — install the previous release, publish a newer one: the banner
  "Version … is downloaded" appears and Restart installs it.
