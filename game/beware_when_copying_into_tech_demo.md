
That import maps [for insanely stupid and ridiculous reasons](https://github.com/WICG/import-maps/issues/2#issuecomment-1984767595) are not supported in workers or worklets!

Hence we need to fix imports manually in these files:
* audioWorklet.js
* backgroundWorker.js
* archiveWorker.js
