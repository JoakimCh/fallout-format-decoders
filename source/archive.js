
import {dat_getEntries, dat_extract} from './decoders/dat_decoder.js'
import {getDecoder} from './decoders/getDecoder.js'
// import {ConcurrencyController} from './misc/jlc-mutex.js'

function filePart(path, includeExtension = false) {
  if (includeExtension) {
    return path.split('/').at(-1)
  } else {
    return path.split('/').at(-1).split('.')[0]
  }
}

/** Creates a globalThis.falloutArchive. */
export class Archive {
  useCache = false
  /** Optional file cache. */
  fileCache = new Map()
  fileMap = new Map() // key is case insensitive (else PATCH000.DAT will not overwrite properly)
  
  // #frmLstCache = new Map()

  constructor({autoDecode = true} = {}) {
    if ('falloutArchive' in globalThis) throw Error('Only one Archive can be used.')
    globalThis.falloutArchive = this
    /** Cache for LST files related to FRMs (under art/). */
    globalThis.frmLists = new Map()//this.#frmLstCache
    globalThis.proLists = new Map()
    globalThis.critterArt = new Set()
    // also globalThis.protoMsg in addEntry() on entry.virtualPath == 'text/english/game/proto.msg'
    this.autoDecode = autoDecode
  }

  getLookups() {
    return {
      frmLists: globalThis.frmLists,
      proLists: globalThis.proLists,
      protoMsg: globalThis.protoMsg,
      critterArt: globalThis.critterArt,
    }
  }

  async addFile(fileHandle, virtualPath) {
    let invalidHandle
    switch (typeof fileHandle) {
      default: invalidHandle = true; break
      case 'number': break // (Node.js file handle)
      case 'object':
        if (!(fileHandle instanceof File)) { // (Web File API)
          invalidHandle = true
        }
      break
      case 'string': // then we must fetch it instead of extracting it from a DAT file
        const protEnd = fileHandle.indexOf('://')
        if (protEnd == -1) {invalidHandle = true; break}
        const protocol = fileHandle.slice(0, protEnd).toLowerCase()
        switch (protocol) {
          default: invalidHandle = true; break
          case 'http': case 'https': // remote
          case 'file': // Node.js
        }
    }
    if (invalidHandle) {
      throw Error(`Invalid fileHandle: ${fileHandle}.`)
    }
    const entry = {
      fileHandle,
      virtualPath
    }
    this.#addEntry(entry)
  }

  async #addEntry(entry) {
    entry.virtualPath = entry.virtualPath.toLowerCase()
    this.fileMap.set(entry.virtualPath, entry)
    if (entry.virtualPath == 'text/english/game/proto.msg') {
      globalThis.protoMsg = await this.extractFile(entry.virtualPath, {autoDecode: true})
    } else if (entry.virtualPath.startsWith('art/') && entry.virtualPath.endsWith('.lst')) {
      const list = await this.extractFile(entry.virtualPath, {autoDecode: true})
      frmLists.set(entry.virtualPath, list)
    } else if (entry.virtualPath.startsWith('proto/') && entry.virtualPath.endsWith('.lst')) {
      const list = await this.extractFile(entry.virtualPath, {autoDecode: true})
      proLists.set(entry.virtualPath, list)
    } else if (entry.virtualPath.startsWith('art/critters/')) {
      globalThis.critterArt.add(filePart(entry.virtualPath, true))
    }
  }

  /** Add the files from the selected DAT file (overwriting any with the same virtual path). */
  async mergeDatFile(...fileHandles) {
    for (const fileHandle of fileHandles) {
      const entries = await dat_getEntries(fileHandle)
      for (const entry of entries) {
        await this.#addEntry(entry)
      }
    }
    return this
  }

  /** Remote as in not from a local DAT file. Must be an URL to a module exporting (default) an array with filenames matching what the `virtualPath` in the archive should be. These files must then reside within a subdirectory with the same title as the `fileListUrl`. */
  async mergeRemoteAssets(fileListUrl) {
    let fullUrl
    if (fileListUrl.startsWith('http')) {
      fullUrl = fileListUrl
    } else { // for assets on same server
      const baseUrl = location.href // of HTML file running the script
      fullUrl = new URL(fileListUrl, baseUrl).toString()
    }
    const fileList = (await import(fullUrl)).default
    const assetDir = fullUrl.slice(0, fullUrl.lastIndexOf('.'))+'/'
    for (const filePath of fileList) {
      await this.#addEntry({
        virtualPath: filePath,
        fileHandle: assetDir+filePath // the full URL to the asset
      })
    }
  }

  /** Extract multiple files from the archive. */
  async extractFiles(virtualPaths, options = {}) {
    // I actually think the browser will adjust max concurrency itself in a sane manner for the fetch requests I make. Hence fetching cached resources will be faster if we just allow it to control this itself. But I left the code here commented out; should I change my mind...
    // const maxConcurrency = options?.maxConcurrency || 10
    // const cc = new ConcurrencyController(maxConcurrency) // so we can avoid killing the server
    // if a Map then replace the virtualPath value with the related data and return it
    const promises = []
    if (virtualPaths instanceof Map) {
      for (const [key, virtualPath] of virtualPaths) {
        promises.push(new Promise(async (resolve) => {
          const data = await this.extractFile(virtualPath, options)
          virtualPaths.set(key, data)
          resolve()
        }))
        // cc.pushJob(async () => {
        //   const data = await this.extractFile(virtualPath, options)
        //   virtualPaths.set(key, data)
        // })
      }
      // await cc.donePromise
      await Promise.all(promises)
      return virtualPaths
    }
    if (Array.isArray(virtualPaths)) {
      const result = []
      for (const virtualPath of virtualPaths) {
        promises.push(new Promise(async (resolve) => {
          const data = await this.extractFile(virtualPath, options)
          virtualPaths.set(key, data)
          resolve()
        }))
        // cc.pushJob(async () => {
        //   const data = await this.extractFile(virtualPath, options)
        //   result.push(data)
        // })
      }
      // await cc.donePromise
      await Promise.all(promises)
      return result
    }
    throw Error(`Expected an an Array or a Map.`)
  }

  /** Extract a file from the archive. */
  async extractFile(virtualPath, {nullIfNotFound = false, useCache = this.useCache, autoDecode = this.autoDecode, decoderOptions = {}} = {}) {
    virtualPath = virtualPath.toLowerCase()
    const entry = this.fileMap.get(virtualPath)
    if (!entry) {
      if (nullIfNotFound) return null
      throw Error('No such entry: '+virtualPath)
    }
    if (useCache) {
      const data = this.fileCache.get(virtualPath)
      if (data) return data
    }
    let data, invalidHandle
    switch (typeof entry.fileHandle) {
      default: invalidHandle = true; break
      case 'object':
        if (!(entry.fileHandle instanceof File)) {
          invalidHandle = true; break
        }
      case 'number': data = await dat_extract(entry.fileHandle, entry); break
      case 'string': // then we must fetch it instead of extracting it from a DAT file
        const protEnd = entry.fileHandle.indexOf('://')
        if (protEnd == -1) {invalidHandle = true; break}
        const protocol = entry.fileHandle.slice(0, protEnd).toLowerCase()
        switch (protocol) {
          default: invalidHandle = true; break
          case 'http': case 'https':
            data = await (await fetch(entry.fileHandle)).arrayBuffer()
            if (!data.byteLength) throw Error(`Error fetching: ${entry.fileHandle}`)
          break
          case 'file':
            data = globalThis.fs.readFileSync(entry.fileHandle.slice(7))
          break
        }
      break
    }
    if (invalidHandle) {
      throw Error(`Invalid entry.fileHandle: ${entry.fileHandle}.`)
    }
    if (autoDecode) {
      let extension
      const dotIndex = virtualPath.lastIndexOf('.')
      if (dotIndex) extension = virtualPath.slice(dotIndex+1)
      const decoder = await getDecoder(extension)
      if (decoder) {
        data = decoder(data, decoderOptions) // await in case it is async
        if (data instanceof Promise) {
          log('Try to avoid if/where realistic.')
          data = await data
        }
      } else {
        console.info('autoDecode is on but the decoder for .'+extension+' is missing, returning raw data instead.')
      }
    }
    if (useCache) this.fileCache.set(virtualPath, data)
    return data
  }

  /** Get an array with info about the entries, optionally only the entries matching the filter. */
  entries(endsWith, includes) {
    if (endsWith || includes) {
      const result = []
      for (let [key, entry] of this.fileMap.entries()) {
        const mustFind = (endsWith?1:0) + (includes?1:0)
        let found = 0
        if (includes && key.includes(includes.toLowerCase())) {
          found ++
        }
        if (endsWith && key.endsWith(endsWith.toLowerCase())) {
          found ++
        }
        if (found == mustFind) result.push(entry)
      }
      return result
    } else {
      return this.fileMap.values()
    }
  }

  // so `for (const entry of archive)` will work
  *[Symbol.iterator]() {
    yield* this.fileMap.values() // (delegate to another generator)
  }

  printEntries(endsWith, includes) {
    for (const virtualPath of this.entries(endsWith, includes).map(({virtualPath}) => virtualPath).sort((a, b) => {a > b})) {
      console.log(virtualPath)
    }
  }

  /*
  text/english/game/pro_crit.msg
  text/english/game/pro_item.msg
  text/english/game/pro_misc.msg
  text/english/game/pro_scen.msg
  text/english/game/pro_tile.msg
  text/english/game/pro_wall.msg
  */



  // async proMsgLookup(type, id, useCache = true) {
  //   if (id == -1) return ''
  //   id++
  //   const typeMap = new Map([
  //     ['critter', 'text/english/game/pro_crit.msg'],
  //     ['item', 'text/english/game/pro_item.msg'],
  //     ['misc', 'text/english/game/pro_misc.msg'],
  //     ['scenery', 'text/english/game/pro_scen.msg'],
  //     ['tile', 'text/english/game/pro_tile.msg'],
  //     ['wall', 'text/english/game/pro_wall.msg'],
  //   ])
  //   const msg = await this.extractFile(typeMap.get(type), false, useCache)
  //   return msg.get(id).message
  // }

  async printList(virtualPath) {
    const list = await this.extractFile(virtualPath)
    let i=0
    for (const entry of list) {
      console.log(i++, ...entry)
    }
  }

  async printMsg(virtualPath) {
    const msg = await this.extractFile(virtualPath)
    for (const [key, {message}] of msg.entries()) {
      console.log(key, message)
    }
  }
}

/** Do a MSG lookup if `archive` in `globalThis`. Can be used with the full path to a MSG file or shorter versions like e.g. just "combatai" for "text/english/game/combatai.msg" or "dialog/sckarl" for "text/english/dialog/sckarl". */
export async function msgLookup(file, id, {offset = 0, onlyMessage} = {}) {
  if (id == -1) return false
  if (globalThis.falloutArchive) {
    id += offset
    file = file.toLowerCase()
    let msgPath
    if (file.startsWith('dialog/')) { // short dialog path
      msgPath = 'text/english/'+file+'.msg'
    } else if (!file.includes('/')) { // short path for files under text/english/game/
      msgPath = 'text/english/game/'+file+'.msg'
    } else { // full path
      msgPath = file
    }
    const msgMap = await falloutArchive.extractFile(msgPath, {useCache: true})
    const msg = msgMap.get(id)
    if (!msg || msg.message.length == 0) { // e.g. most tiles
      return false
    }
    if (onlyMessage) return msg.message
    if (msgPath.endsWith('scrname.msg')) { // the comments contains data then
      const hashPos = msg.comment.indexOf('#') // # script.int  ; comment
      const semiPos = msg.comment.indexOf(';')
      if (hashPos != -1 && semiPos != -1) {
        const scriptFile = msg.comment.slice(hashPos+1, semiPos).trim()
        const comment = msg.comment.slice(semiPos+1).trim()
        msg.scriptFile = scriptFile
        msg.comment = comment
      }
    } else if (msgPath.includes('pro_')) { // then next index (if any) contains a description
      const msg2 = msgMap.get(id+1)
      if (msg2 && msg2.length == 0) msg.description = msg2.message
    }
    return msg
  } else {
    return id
  }
}

export async function lstLookup(file, id, includeComments = false) {
  if (id == -1) return false
  const list = await falloutArchive.extractFile(file, {useCache: true, decoderOptions: {includeComments}})
  return list[id]
}
