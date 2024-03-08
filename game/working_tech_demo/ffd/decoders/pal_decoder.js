
import {DataReader} from '../misc/dataReaders.js'

export function decode_pal(palData) { // see https://falloutmods.fandom.com/wiki/Pal_files
  palData = new DataReader(palData)
  const palette = Array(229)
  palData.bytes(3) // discard first index (used for transparent)
  for (let i=1; i < palette.length; i++) { // above 229 are animated (and not stored here)
    palette[i] = [...palData.bytes(3), 255]
    if (palette[i][0] == 255) { // these are not used
      continue
    }
    for (let c=0; c<3; c++) {
      if (palette[i][c] >= 64) {
        throw Error('Invalid PAL file.'+JSON.stringify([i, palette[i]], null, 2))
      }
      palette[i][c] <<= 2 // (*= 4) increase from 6 bits to 8 bits of brightness
    }
  }
  // we will ignore the rest of the file (since I fail to see how any of it can be useful)
  return palette
}

export default decode_pal
