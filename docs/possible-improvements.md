# Possible improvements

Ideas that are not yet scheduled. Each one goes through the Spec Kit workflow
(`/speckit-specify` …) before any work starts; the notes here only record what was found when the
idea came up.

## Voice chat in live sessions

**Status:** idea, not specified. Client only, no media server.

### What and why

People in a live session (feature 004) often are not in the same room. Today they need a separate
call app next to Deci. A voice channel inside the live session would let the owner and guests
talk while they add ideas, grade and vote, with the same invite link and the same
"owner ends it, everyone leaves" lifecycle.

Sketch of the user-facing behaviour:

- Anyone in a live session can press **Join voice**; nobody is put on the mic automatically.
- Each participant can mute and unmute themselves; others see who is muted and who is speaking.
- Leaving voice does not leave the session; ending or revoking the session ends voice too.
- A participant whose browser has no microphone or refuses permission can still listen.

### Feasibility notes

Most of the hard work already exists in `plugins/share-inpage`:

- Every guest has an `RTCPeerConnection` to the owner's tab (`src/rtc.ts`), signaled through
  sealed offers over Nostr relays or `BroadcastChannel`. Audio can share that connection.
- STUN is configured and TURN can be set in Live network settings, so any guest who can connect
  today can also carry audio. Voice adds no new NAT failure cases.
- The hosting session lives in `LiveShareProvider`, so a call survives page navigation.
- GitHub Pages is HTTPS, which `getUserMedia` requires.

Open design points:

1. **Avoid renegotiation.** Signaling is non-trickle: one offer, one answer, then the relay is no
   longer used. Cheapest route: add an audio transceiver when the connection is created
   (`pc.addTransceiver("audio")` in `dialHost`, no track) and call `sender.replaceTrack(mic)` on
   unmute. No signaling change; the SDP grows by about 1 KB. If tracks must be added later,
   renegotiate over the open data channel ("perfect negotiation").
2. **Star topology.** Guests connect only to the owner, so guests cannot hear each other directly.

   | Approach | How | Limits |
   |---|---|---|
   | Owner mixes (preferred) | The owner's tab builds a Web Audio mix per guest (everyone except that guest), one fixed outgoing track per guest. | Owner uploads N Opus streams (~32 kbps each); comfortable for 10–15 people. |
   | Owner forwards tracks | The owner re-sends each guest's track to every other guest. | Renegotiation on every join; owner upload grows with N×(N−1). |
   | Audio mesh | Guests connect to each other, signaled over the owner's data channel. | Most new code; upload per guest grows with the room. |

3. **Voice depends on the owner's tab.** With a star, the call ends when the owner leaves —
   consistent with live sessions today. Talking without the owner would need a mesh.
4. **Browser quirks.** Autoplay rules need a user gesture ("Join voice"). Chrome does not feed
   remote WebRTC audio into Web Audio unless the stream is also attached to a muted `<audio>`
   element. iOS Safari is the most fragile target.
5. **Privacy.** Audio is never recorded or stored in the project; only mute and speaking state
   travels over the data channel.

### Scope estimate

MVP (join/leave, mute, speaking indicators, mute state over the data channel): a few days to a
week. Playwright can test it with Chrome's fake devices
(`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`). It changes
`specs/004-live-share-network/contracts/live-share.md`, so it needs a contract version bump and a
changeset, and it stays inside `share-inpage` on the public plugin API.
