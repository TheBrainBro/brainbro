# Audio

Recordings are items of their own (`kind: "audio"`), with a player in their card, in the
viewer and on boards. Their name is their title, like files, and they can be renamed and
captioned in the viewer.

## Where they come from

- **Uploads**: an audio file pasted, dropped, picked or shared, from the app or the API.
- **Telegram**: audio and voice messages sent or forwarded to the bot (see
  [Telegram](telegram.md)).
- **Voice notes**: *Voice note* under the capture box in the inbox, or *Record* on the
  phone's quick capture (`/capture`). *Stop* keeps it, *Cancel* throws it away. It is
  uploaded like any capture: if that fails, its card stays with *Retry*, so the recording is
  never lost. Browsers only give the microphone to secure pages, so the button only shows on
  HTTPS (or `localhost`).

## Telling audio apart

What a file is comes from its content, never its name (`apps.items.uploads`). MP3, Ogg
(Opus, Vorbis), WAV, FLAC, M4A and AAC are audio. Browsers record in WebM (Chrome, Firefox)
or MP4 (Safari), which libmagic names as video whatever they hold: those are audio when
their own track list (`apps.items.audio`) has an audio track and no video one. Videos stay
files, played in the viewer.

The stored type is the one browsers play (`audio/x-wav` is kept as `audio/wav`, a WebM
recording as `audio/webm`). Files are served as downloads like every upload, in parts when
the player asks for a range (`apps.items.ranges`).

Browsers don't write the length of a WebM recording, so the player sends it to the end once
to find it out, and back to the start (`AudioPlayer`).

Audio and voice messages that Telegram saved as files before this became audio items in
migration `0015_audio_items`. Recordings in a WebM or MP4 container stay files.

## Not yet

Transcription: recordings aren't searchable by what is said in them yet.
