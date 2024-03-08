
// https://falloutmods.fandom.com/wiki/FRM_File_Format
/*
An FRM may contain image data for one or all of the 6 orientations used in Fallout. If an FRM has the extension .fr[0-5] instead of the usual .frm, then that file contains image data for the orientation given by the last digit in the extension. 0 represents the northeast direction and each subsequent suffix rotates in the clockwise direction (5 representing the northwest direction). Otherwise, the FRM contains image data for either orientation 0, or all 6 orientations.
*/
import {DataReader} from '../misc/dataReaders.js'

/** Decode an FRM file. FRM is short for "frames file" it seems, which contains one or more uncompressed image frames (requiring a palette). `palette` defaults to `globalThis.palette`, if unset indexed values are returned instead of RGBA data. */
export function decode_frm(data, {
  palette = globalThis.palette, 
  orientation = null, 
  transparentColor = [0,0,0,0], 
  elapsedMilliseconds = 0,
} = {}) {
  data = new DataReader(data, false)
  const frm = {}
  const version = data.i32()
  if (version != 4) throw Error('Invalid FRM file; version not 4, read: '+version)
  frm.framesPerSecond = data.i16()
  frm.actionFrameIndex = data.i16()
  frm.framesInAnimation = data.i16()
  const xShift = data.array('i16', 6)
  const yShift = data.array('i16', 6)
  const offset = data.array('i32', 6) // ori. offset in data
  data.i32() // data size
  const oriArr = []
  frm.orientation = oriArr
  for (let ori=0; ori<6; ori++) {
    const frames = []
    oriArr.push({
      orientation: ori,
      xShift: xShift[ori],
      yShift: yShift[ori],
      frame: frames,
    })
    for (let frameId=0; frameId < frm.framesInAnimation; frameId++) {
      if (data.offset >= data.size) throw Error('Invalid FRM file; tried to read past end.')
      const frame = {number: frameId}
      frames.push(frame)
      frame.width  = data.i16()
      frame.height = data.i16()
      const size   = data.i32()
      frame.xShift = data.i16() // from prev frame
      frame.yShift = data.i16()
      if (size != frame.width * frame.height) throw Error('Invalid FRM file; frame data size != num pixels.')
      const indexed = data.bytes(size, true)
      frame.animInterval = new Set()
      for (const index of indexed) {
        if (index < 229) {
        } else if (index < 233) {
          frame.animInterval.add(200)
        } else if (index < 238) {
          frame.animInterval.add(100)
        } else if (index < 243) {
          frame.animInterval.add(200)
        } else if (index < 248) {
          frame.animInterval.add(142)
        } else if (index < 254) {
          frame.animInterval.add(200)
        } else if (index == 254) {
          frame.animInterval.add(33)
        }
      }
      if (palette) { // then convert indexed to RGBA
        throw 'hah'
        frame.bitmap = indexedToRGBA(indexed, palette, elapsedMilliseconds, transparentColor)
      } else {
        frame.indexed = indexed
      }
    }
    if (data.offset >= data.size) break
  }
  if (data.offset != data.size) throw Error('Invalid FRM file; bogus data at end of file.')
  if (orientation != null) {
    oriArr[0].orientation = +orientation
  }
  return frm
}

export default decode_frm

export function getFrxDecoder(orientation) {
  return (data, options) => decode_frm(data, {...options, orientation})
}

/** Convert an FRM with indexed frames (needing a palette) to bitmap frames (with RGBA data). */
export function frm_convertIndexedToBitmap(frm, palette, elapsedMilliseconds = 0,transparentColor = [0,0,0,0]) {
  for (const frame of frm.frames) {
    frame.bitmap = indexedToRGBA(frame.indexed, palette, elapsedMilliseconds,transparentColor)
    delete frame.indexed
  }
}

/** Convert indexed color data (needing a palette) into an RGBA (8 bits per channel) bitmap. */
export function indexedToRGBA(indexed, palette, elapsedMilliseconds = 0, transparentColor = [0,0,0,0]) {
  const bitmap = new Uint8ClampedArray(indexed.length * 4)
  let offset = 0
  for (const index of indexed) {
    if (index == 0) { // transparent
      bitmap.set(transparentColor, offset)
    } else if (index < 229) { // within the palette
      bitmap.set(palette[index], offset)
    } else { // the hardcoded animated palette part
      bitmap.set(getAnimatedColor(index, elapsedMilliseconds), offset)
    }
    offset += 4
  }
  return bitmap
}

export function indexedToImageBitmap(indexed, width, palette, elapsedMilliseconds = 0, transparentColor = [0,0,0,0]) {
  const data = indexedToRGBA(indexed, palette, elapsedMilliseconds, transparentColor)
  const imageData = new ImageData(data, width)
  return createImageBitmap(imageData)
}

const wasteGreen = [ // slime 200 ms
  [ 0, 108,  0, 255],
  [11, 115,  7, 255],
  [27, 123, 15, 255],
  [43, 131, 27, 255]
]
const monitors = [ // monitors 100 ms
  [107, 107, 111, 255],
  [ 99, 103, 127, 255],
  [ 87, 107, 143, 255],
  [  0, 147, 163, 255],
  [107, 187, 255, 255]
]
const fireSlow = [ // fireSlow 200 ms
  [255,   0,  0, 255],
  [215,   0,  0, 255],
  [147,  43, 11, 255],
  [255, 119,  0, 255],
  [255,  59,  0, 255]
]
const fireFast = [ // fireFast 142 ms
  [ 71, 0, 0, 255],
  [123, 0, 0, 255],
  [179, 0, 0, 255],
  [123, 0, 0, 255],
  [ 71, 0, 0, 255]
]
const brown = [ // shoreline 200 ms
  [83, 63, 43, 255],
  [75, 59, 43, 255],
  [67, 55, 39, 255],
  [63, 51, 39, 255],
  [55, 47, 35, 255],
  [51, 43, 35, 255]
]

function getColor(palStart, colorIndex, elapsedMilliseconds, updateInterval, palette) {
  const palIndex = colorIndex - palStart
  const animationCycle = Math.trunc(elapsedMilliseconds / updateInterval)
  // (had to reverse the cycleOffset for some reason)
  const cycleOffset = palette.length-1 - animationCycle % palette.length
  const index = (cycleOffset + palIndex) % palette.length
  return palette[index]
}

// todo: see https://falloutmods.fandom.com/wiki/Pal_animations
function getAnimatedColor(colorIndex, elapsedMilliseconds) {
  if (colorIndex < 233) {
    return getColor(229, colorIndex, elapsedMilliseconds, 200, wasteGreen)
  } else if (colorIndex < 238) {
    return getColor(233, colorIndex, elapsedMilliseconds, 100, monitors)
  } else if (colorIndex < 243) {
    return getColor(238, colorIndex, elapsedMilliseconds, 200, fireSlow)
  } else if (colorIndex < 248) {
    return getColor(243, colorIndex, elapsedMilliseconds, 142, fireFast)
  } else if (colorIndex < 254) {
    return getColor(248, colorIndex, elapsedMilliseconds, 200, brown)
  } else if (colorIndex == 254) { // red alarm
    // it goes from 0 to 60 with step 4 (33 ms) then back
    const cycleOffset = Math.trunc(elapsedMilliseconds / 33) % (60 / 2)
    if (cycleOffset <= 15) {
      return [(cycleOffset*2) << 2, 0, 0, 255]
    } else {
      return [(30-(cycleOffset*2)) << 2, 0, 0, 255]
    }
  } else {
    throw Error('No animated color at index: '+colorIndex)
  }
}
