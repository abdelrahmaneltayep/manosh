# Menna walkthrough — working files

- `vo/01.txt` … `vo/16.txt`: the narration per scene, exactly as in
  `store/listing/Mannon-Screencast-Menna-Script.md` (one phrase per line, `...` = 0.5 s beat,
  blank line = 1 s beat). Source for ElevenLabs or for Menna's own recording.
- `vo/NN.mp3`: generated or recorded takes, −16 LUFS (not committed).
- `raw/NN.mov`: screen recordings per scene (not committed).
- `cut/NN.mp4`, `mannon-walkthrough-menna.mp4`: the edit (not committed).

Consent for the cloned voice was given by Mennatullah on 2026-11-03. The clone lives in the
ElevenLabs workspace; the reference sample is not stored in this repo.

## From the terminal, end to end

```
export ELEVENLABS_API_KEY=your_key
npm run video
```

Or step by step: `npm run video:download`, then `bash scripts/video/menna-video.sh normalise`,
`npm run video:record` (add scene numbers to redo some: `npm run video:record -- 8 9`), and
`npm run video:assemble`. The recorder opens Google Chrome; sign in to the dev store admin in
that window on the first run (someone with access to the store, never by typing credentials
into a script). Scenes 8 and 9 must run together, because 9 opens the link 8 generates.
Captions, slots and the scene order live in `scripts/video/scenes.json`.

To reuse the Chrome you are already signed in to, run the recorder with `--from-chrome`:
`npm run video:record -- --from-chrome 1`. It copies the last-used Chrome profile (cookies,
no caches) into `~/mannon-chrome` and records from that copy; your real Chrome is not
touched. `bash scripts/video/menna-video.sh profiles` lists the profiles; pick one with
`MANNON_VIDEO_CHROME_PROFILE="Profile 1"`.

If the admin sign-in is through Google, use `npm run video:record -- --cdp 1` instead. It
starts a normal Chrome window (no automation flags, so Google allows the sign-in), waits for
you to sign in there, and films each scene through Chrome's own screencast. Later runs reuse
that window while it stays open.
