/*
Hello!
*/

import {indexedToImageBitmap} from 'ffd/decoders/frm_decoder.js'
import {frmLookup, constructId, frmLookupReverse, proLookup} from 'ffd/idLookup.js'
import * as audio from './audio.js'
import {WorkerRFC} from './workerRPC.js'
import {Mutex} from 'ffd/misc/jlc-mutex.js'

globalThis.log = console.log

const backgroundWorker = new WorkerRFC('./backgroundWorker.js')

//#region Whatever that MUST be declared at top.
class ArtHandler {
  /** allows easy lookup of frames within same FRM (for animations) */
  FRMs = new Map()
  /** Map of cached frames. */
  frameCache = new Map()
  // #frameAlias = new Map()
  /** Next batch of frameIds to cache. */
  batchToCache = new Set()
  /** Frame by alias. */
  frame = {}
  frameIdToAlias = new Map()

  /** Cache a "frame" that is outside of a FRM file. Then frameId should be a string identifying it. */
  async loadCustomArt(frameId, xShift, yShift, url) {
    if (typeof frameId != 'string') {
      throw Error(`A custom frame must use a string as its frameId.`)
      // because numerical ones are reserved for those with details about frmId, frameNumber and orientation
    }
    const image = await loadPNG(url)
    const frame = {
      image, 
      width:  image.width, 
      height: image.height,
      xShift, yShift
    }
    this.frameCache.set(frameId, frame)
    return frame
  }

  // aliasToFrame(alias) {
  //   const frameId = this.#frameAlias.get(alias)
  //   if (!frameId) throw Error(`No frameId registered with "${alias}" as alias.`)
  //   const frame = this.frameCache.get(frameId)
  //   if (!frame) throw Error(`The "${alias}" alias pointed to a frameId that isn't cached.`)
  //   return frame
  // }

  /** Register an alias to set when frame is cached (must be registered before its cached!). */
  registerAlias(alias, frameId, override = {}) {
    this.frameIdToAlias.set(frameId, alias)
    this.frame[alias] = override // frame detail reference (will be filled with details on cache)
    return this.frame[alias]
    // this.#frameAlias.set(alias, frameId)
  }

  /** Remove from cache and free the resources of these frameIds. */
  unload(frameIds) { // todo, update FRMs
    for (const frameId of frameIds) {
      const frame = this.frameCache.get(frameId)
      frame.image?.close() // close any ImageBitmap
      this.frameCache.delete(frameId)
      const alias = this.frameIdToAlias.get(frameId)
      if (alias) delete this.frame[alias]
    }
  }

  batch_add(type, name, {frameNumber = 0, orientation = 0, frameCount = 1} = {}) {
    const frmId = frmLookupReverse({type, name})
    for (let i=0; i<frameCount; i++) {
      const frameId = getFrameId({
        frmId,
        frameNumber: frameNumber + i, 
        orientation
      })
      this.batchToCache.add(frameId)
      if (frameCount == 1) return frameId
    }
  }

  /** Cache frames from FRMs (using their frameIds). */
  batch_addFrameIds(frameIds) {
    if (!(frameIds instanceof Set) && !Array.isArray(frameIds)) {
      frameIds = [frameIds]
    }
    for (const frameId of frameIds) {
      this.batchToCache.add(frameId)
    }
  }

  /** Cache all batched frameIds. */
  async batch_loadAndCache() {
    if (!this.batchToCache.size) return
    const batchToCache = this.batchToCache
    this.batchToCache = new Set()
    // console.info('sprites to cache: '+batchToCache.size+'...')

    let frmCache = new Map() // for this batch of frames
    for (const frameId of batchToCache) {
      const {frmId} = parseFrameId(frameId)
      const {path} = frmLookup(frmId)
      frmCache.set(frmId, path)
    }
    // here frmCache is replaced with a Map which has the path values replaced with the content
    frmCache = await archive.extractFiles(frmCache, {
      decoderOptions: {
        palette: null // we just want the indexed (8 bit) color data
      }
    })

    try {
      const result = await backgroundWorker.call('cacheFrames', frmCache, batchToCache)
      for (const [frameId, frame] of result) {
        this.frameCache.set(frameId, frame)
        // initialize if missing bitmaps
        if (frame.indexed) {
          frame.image = await indexedToImageBitmap(frame.indexed, frame.width, palette, performance.now())
        }
        // allow easy lookup of frames within same FRM (for animations)
        const {frmId, orientation, frameNumber} = parseFrameId(frameId)
        let FRM = this.FRMs.get(frmId)
        if (FRM) {
          if (!FRM.orientation[orientation]) {
            FRM.orientation[orientation] = {frame: []}
          }
        } else {
          FRM = {orientation: []}
          FRM.orientation[orientation] = {frame: []}
          this.FRMs.set(frmId, FRM)
        }
        FRM.orientation[orientation].frame[frameNumber] = frame
        // merge into the alias reference (if any)
        const alias = this.frameIdToAlias.get(frameId)
        if (alias) merge(this.frame[alias], frame, false)
      }
      // console.info('done caching sprites')
      return result
    } catch (error) {
      throw error
    }
  }
}; const art = new ArtHandler()

function merge(target, object, doOverwrite = true) {
  for (const key in object) {
    if (doOverwrite || !(key in target)) target[key] = object[key]
  }
}

class PaletteAnimation { //palAnimator
  #animationCycle = [0,0,0,0] // ms: 33, 100, 142, 200
  #interval = [33, 100, 142, 200]
  frameInScreen = new Set() // with PAL animation
  
  // frameInScreen(frame) {
  //   if (frame.animInterval.size)
  //     this.#frameInScreen.add(frame)
  // }

  /** Call before every frame */
  async update(elapsedMilliseconds = performance.now()) {
    for (let intervalIndex=0; intervalIndex<4; intervalIndex++) {
      const interval = this.#interval[intervalIndex]
      const animationCycle = Math.trunc(elapsedMilliseconds / interval)
      if (this.#animationCycle[intervalIndex] != animationCycle) {
        this.#animationCycle[intervalIndex] = animationCycle
        for (const frame of this.frameInScreen) {
          if (frame.animInterval.has(interval)) {
            frame.image?.close()
            frame.image = await indexedToImageBitmap(frame.indexed, frame.width, palette, elapsedMilliseconds)
            this.frameInScreen.delete(frame) // we updated its animation, hence we must remove it so we don't do it again
          }
        }
      }
    }
  }

  /** Initialize a batch of frames with their missing RGBA image data (the ones that doesn't have it yet). */
  async initFrames(frames, elapsedMilliseconds = performance.now()) {
    for (const frame of frames) {
      if (frame.indexed) {
        frame.image = await indexedToImageBitmap(frame.indexed, frame.width, globalThis.palette, elapsedMilliseconds)
        log(frame)
      }
    }
  }
}

class MapHandler {
  /** Which CTX to draw the map window to. */
  ctx
  /** Top (y) offset of where to draw the map window. */
  windowYoffset // todo, we might remove these and always use the full size
  /** Left (X) offset of where to draw the map window. */
  windowXoffset
  /** Width of map window. */
  windowWidth
  /** Height of map window. */
  windowHeight
  windowMargin // can be used instead
  /** Top position of map window on the map. */
  mapY = 0
  /** Left position of map window on the map. */
  mapX = 0
  /** Map width in tile columns. */
  tileCols
  /** Map height in tile rows. */
  tileRows
  /** Whether a map is loading or not. */
  loading = false
  // Stuff on the map
  floor; roof; hex
  /** Offset so top tile of row 1 will be Y 0 on the map. */
  yTopCalibration
  // what to display
  tileGrid = false; hexGrid = false; drawFloor = true; drawRoof = false; drawOther = true
  // cursor to draw
  cursor; cursorOverride
  /** keep track of assets used by the current map */
  #usedFrameIDs = new Set()
  /** Canvas scaling factor. */
  scale; smoothing
  // art = {}
  // #loadMutex = new Mutex()
  /** Mouse position within the canvas. */
  mouse = {x: 0, y: 0, isInside: false}

  constructor({
    ctx, scale = 2, smoothing, windowMargin, windowX, windowY, windowWidth, windowHeight, canvasWidth, canvasHeight
  }) {
    this.ctx = ctx
    this.scale = scale
    this.smoothing = smoothing
    this.resize({canvasWidth, canvasHeight, windowMargin, windowX, windowY, windowWidth, windowHeight})
    // init at center
    this.mouse.x = this.windowXoffset + this.windowWidth  / 2 // (already scaled)
    this.mouse.y = this.windowYoffset + this.windowHeight / 2
    this.mouse.isInside = true
    this.#loadNeededArt()
    const canvas = ctx.canvas
    canvas.addEventListener('mouseenter', () => {this.mouse.isInside = true})
    canvas.addEventListener('mouseleave', () => {this.mouse.isInside = false})
    canvas.addEventListener('mousemove', ({offsetX, offsetY}) => {
      this.mouse.x = offsetX / this.scale
      this.mouse.y = offsetY / this.scale
    })
  }

  #loadNeededArt() {
    const artMap = [
      ['ACTARROW', 'cursor',       {xShift: 2, yShift: 12}],
      ['SCRNORTH', 'scroll up',    {xShift: 0, yShift: 4}],
      ['SCRSOUTH', 'scroll down',  {xShift: 0, yShift: 0}],
      ['SCRWEST',  'scroll left',  {xShift: -5, yShift: 0}],
      ['SCREAST',  'scroll right', {xShift: -15, yShift: 0}],

      ['SCRNWEST', 'scroll up left',    {xShift: -5, yShift: 0}],
      ['SCRNEAST', 'scroll up right',   {xShift: -15, yShift: 0}],
      ['SCRSWEST', 'scroll down left',  {xShift: 0, yShift: 0}],
      ['SCRSEAST', 'scroll down right', {xShift: 0, yShift: 4}],
    ]
    for (const [name, alias, override] of artMap) {
      art.registerAlias(alias, art.batch_add('intrface', name), override)
    }
    this.cursor = art.frame['cursor']
    // 'SCREX','SCRNEX','SCRNWX','SCRNX','SCRSEX','SCRSWX','SCRSX','SCRWX',
  }

  async #loadFalloutMap(name) {
    const f2map = await archive.extractFile('maps/'+name+'.map')
    const hex   = Array(200).fill(0).map(() => Array(200).fill(0))
    const roof  = Array(100).fill(0).map(() => Array(100).fill(0))
    const floor = Array(100).fill(0).map(() => Array(100).fill(0))
    const usedFrameIDs = new Set() // a set (hence no duplicates)
    for (const level of f2map.levels) {
      for (let tileIndex=0; tileIndex<10_000; tileIndex++) {
        const tileX = tileIndex % 100
        const tileY = Math.trunc(tileIndex / 100)
        const roofTileId  = level.roof[tileIndex]
        const floorTileId = level.floor[tileIndex]
        if (roofTileId) {
          const frmId = constructId({typeId: 4, id: roofTileId})
          const frameId = getFrameId({frmId})
          usedFrameIDs.add(frameId)
          roof[tileY][tileX] = frameId
        } else {
          roof[tileY][tileX] = 0
        }
        {
          const frmId = constructId({typeId: 4, id: floorTileId})
          const frameId = getFrameId({frmId})
          floor[tileY][tileX] = frameId
          usedFrameIDs.add(frameId)
        }
      }
      if (1) {
        for (const obj of level.objects) {
          if (obj.position != -1) { // if not inventory
            const hexX = 199 - (obj.position % 200)
            const hexY = Math.trunc(obj.position / 200)
            // log(hexY, hexX)
            // elevation will always match current level
            const {position, frameNumber, orientation, frmId, elevation, proId, x,y, sx, sy} = obj
            const blockedFrm = [
              50331669, 83886081, // ori 4
              33555026, // ori 5
              33554835, // ori 2
              33554453, // ori 5
            ]
            if (blockedFrm.includes(frmId)) continue // this one is trouble
            // sure we should add more details, but for just rendering this is OK
            const frameId = getFrameId({frmId, orientation, frameNumber})
            usedFrameIDs.add(frameId)
            if (hex[hexY][hexX]) {
              hex[hexY][hexX].push(frameId)
            } else {
              hex[hexY][hexX] = [frameId]
            }
          }
        }
      }
      break // only first elevation for now
    }
    // what a weird format they use; lets reverse the order
    for (let y=0; y<100; y++) {
      floor[y].reverse()
      roof[y].reverse()
    }
    return {floor, roof, hex, usedFrameIDs, playerPosition: f2map.player.position}
  }

  async loadFalloutMap(mapTitle, {
    mapX, mapY
  } = {}) {
    if (this.loading) {
      console.warn('Wait before loading a new map!')
      return true
    }
    this.loading = true
    // const {unlock} = this.#loadMutex.lock()
    const map = await this.#loadFalloutMap(mapTitle)
    if (!this.#usedFrameIDs.difference) alertAndThrow('Set.difference')
    const frameIdsToClear = this.#usedFrameIDs.difference(map.usedFrameIDs)
    const frameIdsToLoad  = map.usedFrameIDs.difference(this.#usedFrameIDs)
    log('Clearing unused sprites: '+frameIdsToClear.size)
    art.unload(frameIdsToClear)
    log('Loading new sprites: '+frameIdsToLoad.size)
    art.batch_addFrameIds(frameIdsToLoad)
    this.#usedFrameIDs = map.usedFrameIDs
    await art.batch_loadAndCache() // load and cache map art
    this.floor = map.floor
    this.roof = map.roof
    this.hex = map.hex
    this.tileCols = this.floor[0].length
    this.tileRows = this.floor.length
    this.yTopCalibration = (this.tileCols+1) * hexHeight - tileOffsetY
    if (mapX != undefined || mapY != undefined) {
      this.mapX = mapX ?? 0
      this.mapY = mapY ?? 0
    } else {
      const hexPos = map.playerPosition
      const hexX = 199 - (hexPos % 200)
      const hexY = Math.trunc(hexPos / 200)
      ;[mapX, mapY] = this.tileToPos(hexY/2, hexX/2)
      this.mapX = mapX - this.windowWidth / 2
      this.mapY = mapY - this.windowHeight / 2
    }
    // unlock()
    this.loading = false
  }

  /** Tile row/col to bottom center tile position in the map. */
  tileToPos(row, col, relativeToMapWindow = false) {
    const x = row * hexWidth    + col * tileOffsetX
    const y = row * tileOffsetY - col * hexHeight
    if (relativeToMapWindow) {
      return [
        x + tileHalfWidth - this.mapX, 
        y + tileHeight + this.yTopCalibration - this.mapY
      ]
    }
    return [ // absolute map position
      x + tileHalfWidth, 
      y + tileHeight + this.yTopCalibration
    ]
  }
  
  /** Map x/y position to tile row/col. */
  posToTile(x, y) { // todo add relativeToMapWindow
    const colOffF = tileOffsetX / hexWidth
    const rowOffF = tileOffsetY / hexWidth
    x -= tileHalfWidth, 
    y -= tileHalfHeight + this.yTopCalibration
    const col = (x * rowOffF - y) / (hexHeight + tileOffsetX * rowOffF)
    const row = (x / hexWidth) - (col * colOffF)
    return [Math.round(row), Math.round(col)]
  }

  hexToPos(row, col, relativeToMapWindow) {}
  posToHex(x, y) {}

  /** Get tiles (row / col) within the map window together with their bottom center position (x / y) relative to it. */
  *getTilesWithinWindow() {
    const windowX = this.mapX
    const windowY = this.mapY
    const windowWidth = this.windowWidth
    const windowHeight = this.windowHeight

    // check which tiles are within map view (basically a bruteforce)
    // todo use posToTile() to make it faster
    let pRowHad
    for (let row=0; row<this.tileRows; row++) {
      let rowHas
      const rowXoffset = row * hexWidth
      const rowYoffset = row * tileOffsetY + this.yTopCalibration
      for (let col=this.tileCols-1; col>=0; col--) {
        // mapX/Y is the map position for the top/left of the tile, this allows us to check if any pixel of it should be rendered within the window
        const mapX =  rowXoffset + col * tileOffsetX
        const mapY =  rowYoffset - col * hexHeight
        if (mapX > windowX-tileWidth  && mapX < windowX+windowWidth 
        &&  mapY > windowY-tileHeight && mapY < windowY+windowHeight) {
          rowHas = true
          yield {row, col, // here we return its center bottom position relative to the window
            x: mapX - windowX + tileHalfWidth, // center
            y: mapY - windowY + tileHeight     // bottom
        }
        } else if (rowHas) break // stop searching row
      }
      if (!rowHas && pRowHad) break // stop searching rows
      if (rowHas) pRowHad = true
    }
  }

  /** Get hex tiles (row / col) within the map window together with their center position (x / y) relative to it. */
  *getHexWithinWindow(leftExpand = 0, rightExpand = 0, bottomExpand = 0, topExpand = 0) {
    const windowX = this.mapX - leftExpand
    const windowY = this.mapY - topExpand
    const windowWidth  = this.windowWidth  + leftExpand +  rightExpand
    const windowHeight = this.windowHeight +  topExpand + bottomExpand
    const cols = this.tileCols * 2
    const rows = this.tileRows * 2
    let pRowHad
    for (let row=0; row<rows; row++) {
      let rowHas // the -tileOffsetY not sure why, but aligns them with tiles
      const rowXoffset = row * hexHalfWidth + hexHalfWidth // +hexHalfWidth to align with tile right edge
      const rowYoffset = row * hexHeight + this.yTopCalibration+5 // top tile middle right
      for (let col=cols-1; col>=0; col--) { // we offset col here
        const mapX = rowXoffset + mod2offset(col, hexHalfWidth, hexWidth)
        const mapY = rowYoffset - mod2offset(col, hexHeight, 0)
        if (mapX > windowX-hexWidth  && mapX < windowX+windowWidth 
         && mapY > windowY-hexHeight && mapY < windowY+windowHeight) {
          rowHas = true
          yield {row, col, 
            x: mapX - windowX + hexHalfWidth - leftExpand, // hex X center
            y: mapY - windowY + hexHalfHeight - topExpand  // hex Y center
          }
        } else if (rowHas) break // stop searching row
      }
      if (!rowHas && pRowHad) break // stop searching rows
      if (rowHas) pRowHad = true
    }
  }

  /** x/y relative to map window */
  #drawFrame(frameId, x, y) {
    const frame = (typeof frameId == 'object') ? frameId : art.frameCache.get(frameId)
    if (!frame) throw Error(`No such frameId: ${frameId}.`)
    // apply frame specific offset correction (correct for hex positioned stuff, weird for other)
    x = x - Math.trunc(frame.width / 2) + frame.xShift
    y = y -            frame.height     + frame.yShift
    // clip top/left if outside
    const leftClip = x < 0 ? -x : 0 // source X
    const topClip  = y < 0 ? -y : 0 // source Y
    // clip width/height if outside
    const maxWidth  = this.windowWidth  - x // max source width
    const maxHeight = this.windowHeight - y // max source height
    // find the x/y position inside the canvas
    const screenX = this.windowXoffset + x + leftClip
    const screenY = this.windowYoffset + y + topClip
    if (leftClip < frame.width && topClip < frame.height 
    &&  maxWidth > 0 && maxHeight > 0) { // draw only if visible within the window
      try {
        // if (screenX != Math.trunc(screenX) || screenY != Math.trunc(screenY)) throw Error('sheeet man!')
        // (image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        this.ctx.drawImage(frame.image, leftClip, topClip, maxWidth, maxHeight, screenX, screenY, maxWidth, maxHeight)
        // here we could tell that frame is in screen, it doesn't matter that it doesn't update before next frame
        if (frame.animInterval?.size) { // if it has animated colors
          palAnimator.frameInScreen.add(frame)
        }
      } catch (error) {
        log(frame); throw error      
      }
    }
  }

  /** The margin is to check that no drawing operations try to draw outside of the designated area. This is nice during development to know that we've done things correctly. */
  resize({
    windowX = 0, windowY = 0, 
    windowMargin = this.windowMargin, 
    canvasWidth = canvas.width, canvasHeight = canvas.height, 
    windowWidth = canvasWidth, windowHeight = canvasHeight,
  } = {}) {
    canvas.width  = canvasWidth
    canvas.height = canvasHeight
    if (this.smoothing) {
      canvasCtx.imageSmoothingEnabled = true
      canvasCtx.imageSmoothingQuality = this.smoothing
    } else {
      canvasCtx.imageSmoothingEnabled = false // for x2 this looks best
    }
    canvasCtx.scale(this.scale, this.scale)
    this.windowMargin = windowMargin
    if (windowMargin != undefined) { // then window x/y/width/height is ignored
      this.windowXoffset = windowMargin
      this.windowYoffset = windowMargin
      this.windowWidth  = canvasWidth  - windowMargin*2
      this.windowHeight = canvasHeight - windowMargin*2
    } else { // set to specified
      this.windowXoffset = windowX
      this.windowYoffset = windowY
      this.windowWidth  = windowWidth
      this.windowHeight = windowHeight
    }
    // blue fill visible if window is not filling the canvas
    this.ctx.fillStyle = 'blue'
    this.ctx.fillRect(0, 0, canvas.width/this.scale, canvas.height/this.scale)
    if (this.scale == 1) return
    this.windowXoffset = Math.trunc(this.windowXoffset / this.scale)
    this.windowYoffset = Math.trunc(this.windowYoffset / this.scale)
    this.windowWidth   = Math.trunc(this.windowWidth   / this.scale)
    this.windowHeight  = Math.trunc(this.windowHeight  / this.scale)
  }

  /** Draw a part of the map based on pixel coordinates. */
  draw() {
    // ctx.fillStyle = 'black'
    // ctx.fillRect(this.windowXoffset, this.windowYoffset, this.windowWidth, this.windowHeight)
    this.ctx.clearRect(this.windowXoffset, this.windowYoffset, this.windowWidth, this.windowHeight)
    if (this.loading) {
      const waitPlanetFrmId = constructId({typeId: 6, id: 278})
      const {frame} = art.FRMs.get(waitPlanetFrmId).orientation[0]
      const animationCycle = Math.trunc(performance.now() / 100)
      const cycleOffset = animationCycle % frame.length
      const {image, xShift, yShift} = frame[cycleOffset]
      const x = this.windowWidth  / 2 - Math.trunc(image.width / 2) + xShift
      const y = this.windowHeight / 2 -            image.height     + yShift
      this.ctx.drawImage(image,
        this.windowXoffset + x, 
        this.windowYoffset + y
      )
      return
    }
    /* todo egg
    the intrface/egg.frm is a single channel (no palette) image with just an alpha channel. use it to make walls below player transparent and draw them in another canvas (blending them with egg.frm; globalCompositeOperation XOR maybe) BTW: maybe use offscrCanvas instead
    */
    if (this.drawFloor) {
      for (let {row, col, x, y} of this.getTilesWithinWindow()) {
        const frameId = this.floor[row][col]
        if (frameId) this.#drawFrame(frameId, x, y)
        if (this.tileGrid) this.#drawFrame('tileGrid', x, y)
      }
    }
    if (this.drawOther) {
      for (let {row, col, x, y} of this.getHexWithinWindow(300,300,300,300)) {
        if (this.hex[row][col]) {
          for (const frameId of this.hex[row][col]) {
            this.#drawFrame(frameId, x, y)
          }
        }
        if (this.hexGrid) this.#drawFrame('hexGrid', x, y)
      }
    }
    if (this.drawRoof) {
      for (let {row, col, x, y} of this.getTilesWithinWindow()) {
        const frameId = this.roof?.[row+3]?.[col-2]
        if (frameId) this.#drawFrame(frameId, x, y)
      }
    }
    {
      const mMapX = this.mapX + (this.mouse.x - this.windowXoffset)
      const mMapY = this.mapY + (this.mouse.y - this.windowYoffset)
      this.#drawFrame('tileGrid', ...this.tileToPos(...this.posToTile(mMapX, mMapY), true))
      if (this.cursorOverride || this.cursor) {
        const frame = this.cursorOverride || this.cursor
        this.#drawFrame(frame, this.mouse.x, this.mouse.y)
      }
    }
  }

  mouseScroll() {
    const mouse = this.mouse
    if (!mouse.isInside) {
      this.cursorOverride = false
      return
    } else if (document.activeElement != canvas) {
      canvas.focus()
    }
    const zone = 55, speed = 5 // todo maybe relative speed
    const xStart = this.windowXoffset
    const xEnd   = this.windowXoffset + this.windowWidth
    const yStart = this.windowYoffset
    const yEnd   = this.windowYoffset + this.windowHeight
    if        (mouse.x <= xStart + zone && mouse.y <= yStart + zone) { // up left
      // todo align with roads
      this.cursorOverride = art.frame['scroll up left']
      this.mapX -= speed; this.mapY -= speed
    } else if (mouse.x >=   xEnd - zone && mouse.y <= yStart + zone) { // up right
      this.cursorOverride = art.frame['scroll up right']
      this.mapX += speed; this.mapY -= speed
    } else if (mouse.x <= xStart + zone && mouse.y >=   yEnd - zone) { // down left
      this.cursorOverride = art.frame['scroll down left']
      this.mapX -= speed; this.mapY += speed
    } else if (mouse.x >=   xEnd - zone && mouse.y >=   yEnd - zone) { // down right
      this.cursorOverride = art.frame['scroll down right']
      this.mapX += speed; this.mapY += speed
    } else if (mouse.x <= xStart + zone) {
      this.cursorOverride = art.frame['scroll left']
      this.mapX -= speed
    } else if (mouse.x >=   xEnd - zone) {
      this.cursorOverride = art.frame['scroll right']
      this.mapX += speed
    } else if (mouse.y <= yStart + zone) {
      this.cursorOverride = art.frame['scroll up']
      this.mapY -= speed
    } else if (mouse.y >=   yEnd - zone) {
      this.cursorOverride = art.frame['scroll down']
      this.mapY += speed
    } else { // back to whatever the game wants to display
      this.cursorOverride = false
    }
  }
}

function alertAndThrow(impl, customMsg = '') {
  const msg = `Your stupid ass browser hasn't implemented ${impl} yet! Please use a Chromium based browser instead!`
  alert(customMsg || msg)
  throw Error(customMsg || msg)
}

async function initArchive(localDir) {
  let archive
  if (!localDir) { // use remote assets
    // since they can be handled within a worker we also setup a worker to handle them
    const archiveWorker = new WorkerRFC('archiveWorker.js')
    await archiveWorker.ready
    archive = archiveWorker.proxy() // proxy calls to archive through this worker
    await archive.mergeRemoteAssets('../assets/fallout2.js')
  } else { // use local assets from DAT files
    // these can't be handled within a worker since they use the File System API (will hopefully change in the future)
    const f2_directory = new (await import('./jlc-directory-handler.js')).DirectoryHandler(localDir)
    archive = new (await import('ffd/archive.js')).Archive()
    // load remote entries to load stuff not included in the DAT files (e.g. the music)
    await archive.mergeRemoteAssets('../assets/fallout2.js')
    await archive.mergeDatFile( // overwrite those entries with local ones
      await f2_directory.getFile('MASTER.DAT'),
      await f2_directory.getFile('CRITTER.DAT'),
      await f2_directory.getFile('PATCH000.DAT'),
    )
  }  
  globalThis.archive = archive // share it with any other scripts
  const {protoMsg, frmLists, proLists, critterArt} = await archive.getLookups()
  // also make this globally available (for our engine)
  globalThis.palette = await archive.extractFile('color.pal')
  globalThis.protoMsg = protoMsg
  globalThis.frmLists = frmLists
  globalThis.proLists = proLists
  globalThis.critterArt = critterArt
  return archive
}

/** Allows a value to be debugged in a "rate limited way". */
class DebugInterval {
  #intervalId
  #valueMap = new Map()
  constructor(interval) {
    this.start(interval)
  }
  add(id, value) {
    this.#valueMap.set(id, value)
  }
  #atInterval() {
    for (const [id, value] of this.#valueMap) {
      console.log(id, value)
    }
  }
  start(interval) {
    clearInterval(this.#intervalId)
    this.#intervalId = setInterval(this.#atInterval.bind(this), interval)
  }
  stop() {
    clearInterval(this.#intervalId)
  }
}//; const debugEverySecond = new DebugInterval(1000)
//#endregion

// the magic numbers for Fallout tile rendering
const tileWidth  = 80
const tileHeight = 36
/** Hex grid width. */ 
const hexWidth  = tileWidth  / 2.5        // 80 / 2.5 = 32
/** Hex grid height (not hex tile height). For each column a tile Y must decrease this much. */
const hexHeight = tileHeight / 3.0        // 36 / 3.0 = 12
/** For each column X must increase this much. */
const tileOffsetX = hexWidth  * 1.5 // 32 * 1.5 = 48
/** For each row Y must increase this much. */
const tileOffsetY = hexHeight * 2.0 // 12 * 2.0 = 24
const tileHalfWidth  = tileWidth  / 2 // 40
const tileHalfHeight = tileHeight / 2 // 18
/** Hex grid half width (not hex tile half width). */ 
const hexHalfWidth  = hexWidth  / 2 // 16
/** Hex grid half height (not hex tile half height). */ 
const hexHalfHeight = hexHeight / 2 //  6
// const hexHalfVisualHeight = 16 / 2

const palAnimator = new PaletteAnimation()
/** The canvas where the game is drawn. */
let canvas, canvasCtx
const startMap = 'denbus1'
const startMusic = 'akiss'
let streamNode

const btn_local = document.createElement('button')
const btn_remote = document.createElement('button')
document.body.append(btn_remote, btn_local)
btn_remote.textContent = 'Use assets from server'
btn_local.textContent = 'Use local Fallout 2 assets'
btn_local.addEventListener('click', selectF2dir)
btn_remote.addEventListener('click', () => initGame())

async function selectF2dir() {
  log('/home/joakim/.wine/drive_c/Games/Fallout 2/')
  if (!window.showDirectoryPicker) alertAndThrow('window.showDirectoryPicker')
  try {
    const dir_f2 = await window.showDirectoryPicker({
      id: 'fallout2dir', // to remember picked dir for next pick?
      mode: 'read',
      startIn: 'downloads'
    })
    initGame(dir_f2)
  } catch (error) {
    if (error.name == 'AbortError') {
      console.warn('Directory picker aborted:', error)
    } else throw error
  }
}

let doAnim = false
const frameTime60fps = 16.6
let lastTime
/** Handles drawing of the screen. */
async function frameHandler(time) { // time = timestamp at end of last frame (so undefined at first call)
  const delta = time ? (time - lastTime) / frameTime60fps : 1
  if (doAnim) {
    map.mapX = Math.trunc(map.mapX + 1 * delta)
  }
  if (!map.loading) await palAnimator.update()
  map.mouseScroll()
  map.draw()
  lastTime = time ?? performance.now()
  requestAnimationFrame(frameHandler)
}

async function initGame(localDir) {
  document.body.removeChild(btn_local)
  document.body.removeChild(btn_remote)
  await initArchive(localDir)
  backgroundWorker.call('init', {
    frmLists: globalThis.frmLists,
    palette: globalThis.palette
  })
  ;[canvas, canvasCtx] = await initGameHtml()
  // canvasCtx.fillStyle = 'blue'
  // canvasCtx.fillRect(0, 0, canvas.width, canvas.height)
  await audio.init()
  streamNode = await audio.stream('sound/music/'+startMusic+'.acm', {loop: true, mono: true}) // (mono)
  // audio.stream('sound/music_hq/akiss.acm', {loop: true}) // pretty damn fast in my opinion
  // cacheCustomFrame('hexGrid', 0, 8, '../assets/hexOutline.png')
  art.loadCustomArt('hexGrid', 0, 8, '../assets/hexOutlineOverlap.png')
  // cacheCustomFrame('tileGrid', 0, 0, '../assets/tileOutlineOverlap.png')
  art.loadCustomArt('tileGrid', 0, 0, '../assets/tileOutlineOverlap.png')
  // cache planet wait frames
  art.batch_add('intrface', 'wait', {frameCount: 7})
  
  const map = new MapHandler({
    ctx: canvasCtx,
    windowMargin: 10, // (of the map drawing window inside the parent ctx)
    canvasWidth:  canvas.clientWidth,
    canvasHeight: canvas.clientHeight
  })
  globalThis.map = map

  await art.batch_loadAndCache()
  map.loadFalloutMap(startMap)
  
  document.addEventListener('keydown', keyboardHandler)

  frameHandler()
}

window.addEventListener('resize', () => {
  map.resize({
    canvasWidth:  canvas.clientWidth,
    canvasHeight: canvas.clientHeight
  })
})

/** Handles keyboard input */
async function keyboardHandler(e) {
  const cSpeed = 40
  switch (e.key) {
    case 'ArrowUp':    map.mapY -= cSpeed; break
    case 'ArrowDown':  map.mapY += cSpeed; break
    case 'ArrowLeft':  map.mapX -= cSpeed; break
    case 'ArrowRight': map.mapX += cSpeed; break
    case ' ': log(map.mapX, map.mapY); break
    case 'Enter': doAnim = !doAnim; break
    case 'h': map.hexGrid = !map.hexGrid; break
    case 'g': map.tileGrid = !map.tileGrid; break
    case 'r': map.drawRoof = !map.drawRoof; break
    case 'o': map.drawOther = !map.drawOther; break
    case 'f': {
      if (!document.fullscreenElement) {
        canvas.requestFullscreen().catch()
      } else {
        document.exitFullscreen().catch()
      }
    } break
  }
}

async function loadPNG(url) {
  const response = await fetch(url)
  if (!response.ok) throw Error('Bad response.')
  return createImageBitmap(await response.blob())
}

function filePart(path, includeExtension = false) {
  if (includeExtension) {
    return path.split('/').at(-1)
  } else {
    return path.split('/').at(-1).split('.')[0]
  }
}

async function initGameHtml() {
  const scaleNumber = document.createElement('input')
  scaleNumber.type = 'number'
  scaleNumber.value = 2
  scaleNumber.min = 1
  scaleNumber.max = 4
  scaleNumber.onchange = () => {
    map.scale = +scaleNumber.value
    map.resize() // apply it
  }
  const scaleLabel = document.createElement('label')
  scaleLabel.textContent = 'Graphics scale: '
  scaleLabel.append(scaleNumber)

  const musicSelect = document.createElement('select')
  musicSelect.id = 'musicSelect'
  for (const {virtualPath} of await archive.entries('.acm', 'sound/music/')) {
    const option = document.createElement('option')
    option.textContent = filePart(virtualPath)
    if (option.textContent == startMusic) option.selected = true
    musicSelect.append(option)
  }
  musicSelect.addEventListener('change', async e => {
    const selectedMusic = musicSelect.selectedOptions[0].textContent
    streamNode?.disconnect()
    streamNode = await audio.stream('sound/music/'+selectedMusic+'.acm', {loop: true, mono: true})
  })
  const musicLabel = document.createElement('label')
  musicLabel.textContent = 'Play music file: '
  musicLabel.append(musicSelect)

  const mapSelect = document.createElement('select')
  mapSelect.id = 'mapSelect'
  for (const {virtualPath} of await archive.entries('.map')) {
    const option = document.createElement('option')
    option.textContent = filePart(virtualPath)
    if (option.textContent == startMap) option.selected = true
    mapSelect.append(option)
  }
  let previousMap = mapSelect.value
  mapSelect.addEventListener('change', async e => {
    const currentMap = e.target.value
    const selectedMap = mapSelect.selectedOptions[0].textContent
    const options = selectedMap == 'jlctest' ? {mapX: 4450, mapY: 0} : undefined
    const r = await map.loadFalloutMap(selectedMap, options)
    if (!r) {
      e.target.value = currentMap
      previousMap = currentMap
    } else {
      e.target.value = previousMap
    }
  })
  const guiContainer = document.createElement('div')
  guiContainer.id = 'guiContainer'
  const mapLabel = document.createElement('label')
  mapLabel.textContent = 'Load MAP file: '
  mapLabel.append(mapSelect)
  guiContainer.append(mapLabel, musicLabel, scaleLabel)
  
  const canvas = document.createElement('canvas')
  canvas.tabIndex = 0 // makes it able to have focus
  canvas.id = 'screen'
  const canvasCtx = canvas.getContext('2d', {alpha: false})

  const mainContainer = document.createElement('div')
  mainContainer.id = 'mainContainer'
  mainContainer.append(canvas, guiContainer)
  globalThis.mainContainer
  document.body.append(mainContainer)

  return [canvas, canvasCtx]
}

/** So we can ID and cache individual frames, even of the same FRM file. */
function getFrameId({frmId, frameNumber = 0, orientation = 0}) {
  const frameId
    = BigInt(frmId) // reserve 32 bits for it
    | (BigInt(frameNumber) & 0xFFn) << 32n
    | (BigInt(orientation) & 0xFFn) << 40n
  return frameId
}
function parseFrameId(frameId) {
  return {
    frmId: Number(frameId & 0xFFFF_FFFFn),
    frameNumber: Number(frameId >> 32n & 0xFFn),
    orientation: Number(frameId >> 40n),
  }
}

function mod2offset(col, offEven, offOdd) {
  const evenCols = Math.trunc(col / 2)
  const oddCols = col - evenCols
  return (evenCols * offEven) + (oddCols * offOdd)
}

