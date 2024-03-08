
import {frmLookup} from './ffd/idLookup.js'
import {indexedToImageBitmap} from './ffd/decoders/frm_decoder.js'
import {getRfcMessageHandler} from './workerRPC.js'

const cmdToFunctionMap = new Map()
onmessage = getRfcMessageHandler(cmdToFunctionMap)

cmdToFunctionMap.set('init', ({frmLists, palette}) => {
  globalThis.palette = palette
  globalThis.frmLists = frmLists
}) // for frmLookup
cmdToFunctionMap.set('cacheFrames', cacheFrames)

postMessage('rfcReady')

async function cacheFrames(frmCache, frameIds) {
  const promises = []
  for (const frameId of frameIds) {
    promises.push(cacheFrame(frmCache, frameId))
  }
  return await Promise.all(promises)
}

async function cacheFrame(frmCache, frameId) {
  const {frmId, frameNumber, orientation} = parseFrameId(frameId)
  // a map critter frmId has no orientation set, for most this is okay since they have all ori in one FRM file, but for corpse I think they are separate frX files. Hence we should then insert the ori in the frmId and then set it to 0 below I guess.
  let frm = frmCache.get(frmId)
  if (!frm) {
    const {path, type} = frmLookup(frmId)
    frm = await archive.extractFile(path, {
      decoderOptions: {palette: null}
    })
    frmCache.set(frmId, frm)
  }
  try {    
    const {frame, xShift, yShift} = frm.orientation[orientation]
    const {indexed, width, height, animInterval} = frame[frameNumber]
    let frameDetails
    if (animInterval.size) { // set not empty
      frameDetails = {indexed, animInterval, width, height, xShift, yShift}
    } else {
      const image = await indexedToImageBitmap(indexed, width, globalThis.palette)
      if (image.width != width || image.height != height) throw 'lol'
      frameDetails = {image, width, height, xShift, yShift, animInterval}
    }
    if (!(width > 0 && height > 0)) throw Error('omg')
    return [frameId, frameDetails] //result.push([frameId, frameDetails])
  } catch (error) {
    console.log(frmLookup(frmId), frmId, frameNumber, orientation)
  }
}

function parseFrameId(frameId) {
  return {
    frmId: Number(frameId & 0xFFFF_FFFFn),
    frameNumber: Number(frameId >> 32n & 0xFFn),
    orientation: Number(frameId >> 40n),
  }
}
