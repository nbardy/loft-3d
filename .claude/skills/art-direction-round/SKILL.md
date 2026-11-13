---
name: art-direction-round
description: Run a round of art direction on a Loft creature or scene - a new look, a new face, a new part, a redesign. Use when the owner asks for variants, new designs, "more identity", a different style of some part, or reacts to pictures with taste feedback. Covers the order of work that avoids building things the owner rejects at a glance.
---

# An art direction round

The owner's taste is found by reaction, and a reaction costs them one glance. So the whole method is: get the glance
on the cheapest thing that can earn it, and write down what the glance checks before building.

Rounds 2 to 4 of the crab are recorded in `docs/art_direction/DIRECTION.md`. What went wrong there is why each step
below exists.

## Order of work

1. **Say back what is wanted, in parts.** A request is usually a mix: "the low body, the island back, the fiddler's
   face". List which slot each phrase belongs to (`docs/variants.md`). Quote the owner's words in the brief.
2. **Concept pictures first, and the owner picks.** Six designs by five views from the Flux Klein model cost minutes
   (`tools/crab_concepts.py`, `tools/crab_faces.py`). Show the sheet and wait for the pick. Do not pick for the owner
   and port three: in round 2 two of three ports (an hour of work each, and a hand merge) were not the direction, and
   one sentence from the owner at the sheet would have said so.
   - The model will not draw everything (it refused eyes on stalks). Its pictures are for shape and mood, not a
     specification.
   - Another session may be using `~/git/flux-klein-fast`. Check for a running job first; never edit that repo.
3. **Offer mixes, not only whole characters.** The owner's answer is often "this body with that face". Render the
   mixes the slots already allow (`--variant "fiddler,carapace=base,back=base"`) before designing anything new. If a
   mix breaks because a part is placed by typed coordinates, fix the part to attach to a named place.
4. **Write the glance as checks before building.** What the owner will judge at a glance must be a number:
   - it reads at game size: a part's size in pixels from the `game` camera at 1280x800 (`minScreenSize`; the dandy
     face's eyes are held to 50 and 38 px);
   - light against what is behind it (the old face was dark eyes on a dark body: two dots);
   - states that must be told apart are told apart (`expressionsRead`);
   - the base variant's pictures do not change (three `rgba` hashes from `render --views game`).
   A passing number is necessary, not sufficient: the contrast figure passed while shut eyes were dark balls.
5. **Predict, build, look, score.** Predictions go in `DIRECTION.md` under the round before the first render. Then
   look at the pictures yourself, from the `game` camera first, and list what is wrong before reporting what is right.
6. **An action has a consequence in the world.** A grab that sets the boat back down, or a slam nothing responds to,
   will come back as "I'd love to see it really toss the boat". Ask of every attack: what does the other boat feel?
7. **End on a page, opened.** Every round ends with one HTML page under `out/<round>/index.html`: clips first, then
   the comparison sheet (before and after, or variants side by side), the measured numbers, the weak spots, and the
   choices the owner may want to reverse. Open it (`open out/<round>/index.html`). A list of file paths is not a
   deliverable.

## Reporting

Lead with what it looks like and what is weak. Name each choice the owner might reverse in one line with what it would
take ("the moustache: two lines to remove"). Counts of passing checks come last.

## Parked directions

A rejected variant stays in the repo untouched unless the owner says to delete it. Say that it is parked.
