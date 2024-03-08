
# A "Fallout like" game for the browser.

This is the home for my:
* Fallout format decoders.
* "Fallout like" game.
* "Fallout like" game engine.

Basically it's 3 projects that are so closely tied together that (at least for now) I will keep them all in this repository.

All the code here is written by me in JavaScript from scratch and MIT licensed.

## The Fallout format decoders.

Format decoders for the "classic" [Fallout](https://en.wikipedia.org/wiki/Fallout_(video_game)) games (1 & 2).

With these decoders we can extract game assets from their DAT files and decode their content into something usable in the browser (they're also compatible with Node.js by the way).

Assets can be loaded from local DAT files using the [Web File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API) or from a web server (where they have already been extracted).

### Decoders implemented so far:

* DAT - Fallout 1 & 2 DAT archives.
* FRM - Indexed bitmaps containing 1 or more frames.
* ACM - The sound/music format.
* PAL - Palettes used together with FRMs.
* LST - Lists used to numerically index other files.
* MSG - Strings mapped to numerical IDs.
* MAP - The design of a location in the game.
* PRO - Defines properties of objects.
* Most ID decoders (e.g. the one defining critters on a MAP).

## The "Fallout like" game.

The game will be able to run in at least any Chromium based browser (Chrome, Edge, Brave, etc) and I'll also try to make it compatible with Firefox (unless too troublesome).

It's not going to be a Fallout clone though (since my project is NOT about making the original game run in the browser)! Others might use the engine for that, but I will not.

[Click here to go the the page for the game and to try the current tech demo.](./game/readme.md)

## The "Fallout like" game engine.

The resulting game engine will eventually be made in a way where others can easily use it to make their own "Fallout inspired" games. This will be a nice alternative to creating a real Fallout 2 mod; because using my engine and JavaScript will be a "much better and friendlier experience" (at least that's my goal)! 😃

Soon anyone will be able to make their own post apocalyptic role playing games!
Even granny! 🥳

## The development process.

[Read about it here.](./development.md)

## The End.

That was it! 
No more of readme. Go home. Nothing more to see here. Beat it!
