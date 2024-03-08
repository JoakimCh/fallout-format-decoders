
import {BlobRandomAccessReader, NodejsFileRandomAccessReader, DataReader} from '../misc/dataReaders.js'
import {Mutex} from '../misc/jlc-mutex.js'

const FileReader = globalThis.process?.versions?.node ? NodejsFileRandomAccessReader : BlobRandomAccessReader

// import * as fs from 'node:fs'
// globalThis.fs = fs
// // const fileHandle = fs.openSync('/stor/home/joakim/wine_old/drive_c/Program Files (x86)/Interplay/Fallout/CRITTER.DAT')
// const fileHandle = fs.openSync('/stor/home/joakim/wine_old/drive_c/Program Files (x86)/Interplay/Fallout/MASTER.DAT')
// const entries = await dat_getEntries(fileHandle)
// // for (const entry of entries) {
// //   if (!entry.isCompressed) {
// //     console.log(entry)
// //   }
// // }
// const entry = entries[32]
// console.log(entry)
// console.log(await dat_extract(fileHandle, entry))
// fs.closeSync(fileHandle)

// todo: maybe use a mutex for each filehandle to avoid multiple reads from same
const datMutex = new Map()
/**
  @returns {Mutex}
*/
function getMutex(fileHandle) {
  let mutex = datMutex.get(fileHandle)
  if (!mutex) {
    mutex = new Mutex()
    datMutex.set(fileHandle, mutex)
  }
  return mutex
}
async function lockMutex(fileHandle) {
  const mutex = getMutex(fileHandle)
  const {unlock} = await mutex.lock()
  return unlock
}

/* auto-detects F1 or F2 DAT files */
export async function dat_getEntries(fileHandle) {
  const unlock = await lockMutex(fileHandle)
  try {
    return await dat2_getEntries(fileHandle)
  } catch {
    try {
      return await dat1_getEntries(fileHandle)
    } catch (error) {
      throw Error('Invalid DAT format!', {cause: error})
    }
  } finally {
    unlock()
  }
}

/** Returns a DataView promise. */
export async function dat_extract(fileHandle, {offset, size, isCompressed, compressedSize}) {
  // console.log('dat extract')
  const unlock = await lockMutex(fileHandle)
  try {
    const br = new FileReader(fileHandle)
    switch (isCompressed) {
      // No compression
      default:
      case 0: return (await br.read(size, {offset})).buffer
      // Fallout 1 DAT
      case 1: return new DataView(LZSS_decode(await br.read(compressedSize, {offset}), size).buffer)
      // Fallout 2 DAT
      case 2: return new DataView((await deflate(await br.read(compressedSize, {offset}))).buffer)
    }
  } finally {
    unlock()
  }
}

export async function dat2_getEntries(fileHandle) {
  const br = new FileReader(fileHandle, true)
  br.offset = br.size - 8
  const treeSize = await br.u32() - 4
  const fileSize = await br.u32()
  if (br.size != fileSize) throw Error('Invalid DAT format!')

  const dvr = new DataReader(await br.read(treeSize, {offset: br.size - 8 - treeSize}))
  const entries = []
  while (dvr.offset < treeSize) {
    const pathLength = dvr.u32()
    const entry = {
      fileHandle,
      virtualPath: new TextDecoder('ascii').decode(dvr.bytes(pathLength)).replaceAll('\\','/'),
      isCompressed:   dvr.u8() ? 2 : 0, 
      size:           dvr.u32(), 
      compressedSize: dvr.u32(), 
      offset:         dvr.u32(), // offset in archive file
    }
    if (!entry.isCompressed) {
      if (entry.compressedSize != entry.size) {
        throw Error('Invalid DAT format!')
      } else {
        entry.compressedSize = 0 // it's not compressed, so set to 0
      }
    }
    entries.push(entry)
  }

  return entries
}

export async function dat1_getEntries(fileHandle) {
  const br = new FileReader(fileHandle, false)
  async function readString() {
    const strSize = await br.u8()
    return new TextDecoder('ascii').decode(
      await br.read(strSize, {asDataView: false})
    )
  }
  const numFolders = await br.u32()
  const magic      = await br.u32() // is related to the folder count
  const flags      = await br.u32() // invalid format if not 0 I guess
  const timestamp  = await br.u32() // what kind?!
  if (magic != dat1_magic(numFolders) || flags) {
    throw Error('Invalid DAT format!')
  }
  const folders = []
  for (let i=0; i<numFolders; i++) {
    let name = await readString()
    if (name.startsWith('.')) name = name.slice(1)
    if (name.length) name += '/'
    folders.push({name: name.replaceAll('\\','/')})
  }
  for (const folder of folders) {
    folder.numFiles  = await br.u32()
    folder.magic     = await br.u32() // is related to the file count
    folder.flags     = await br.u32()
    folder.timestamp = await br.u32() // what kind?!
    if (folder.magic != dat1_magic(folder.numFiles)) {
      throw Error('Invalid DAT format!')
    }
    folder.files = []
    for (let i=0; i<folder.numFiles; i++) {
      const file = {
        name:   await readString(),
        flags:  await br.u32(),
        offset: await br.u32(),
        size:   await br.u32(),
        compressedSize: await br.u32()
      }
      folder.files.push(file)
    }
  }
  const entries = []
  for (const folder of folders) {
    for (const file of folder.files) {
      const entry = {
        fileHandle,
        virtualPath:    folder.name + file.name,
        isCompressed:   (file.flags & 1 << 6) ? 1 : 0,
        size:           file.size,
        compressedSize: file.compressedSize,
        offset:         file.offset, // offset in archive file
      }
      if (entry.compressedSize && !entry.isCompressed) {
        throw Error('Invalid DAT format!')
      }
      entries.push(entry)
    }
  }
  return entries
}

export async function deflate(input) {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  const {readable, writable} = new DecompressionStream('deflate')
  const writer = writable.getWriter()
  const reader = readable.getReader()
  const chunks = []

  await Promise.all([ // wait until done writing and reading
    writer.write(bytes).finally(() => writer.close()),
    (async () => {
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        chunks.push(value)
      }
    })()
  ])

  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

/** I have no idea why they're calculating this... */
function dat1_magic(count) {
  // (we never deal with counts big enough to shuffle bit 32, hence we're fine doing this)
  const bitsNeeded = Math.trunc(Math.log2(count)) + 1
  if (bitsNeeded < 4) {
    return 0b1010
  }
  const mask = (2 ** bitsNeeded) - 1 // or (1 << count) - 1
  let suggested = (mask & ~1) & ~(1 << bitsNeeded-2)
  if (suggested >= count) {
    return suggested
  } else {
    return suggested << 1 | 0b10
  }
}

export function LZSS_decode(input, outputSize) {
  class LZSS_Dictionary {
    #data; #size; #writeOffset
    
    constructor({size = 4096} = {}) {
      this.#size = size
      this.#data = new Uint8Array(size)
    }
  
    clear() {
      this.#writeOffset = this.#size - 18
      this.#data.fill(0x20) // fill with ASCII space
    }
  
    writeByte(byte) {
      // console.log(this.#writeOffset, String.fromCodePoint(byte))
      this.#data[this.#writeOffset++] = byte
      if (this.#writeOffset == this.#size) {
        this.#writeOffset = 0
      }
    }
  
    read(offset, length) {
      const output = new Uint8Array(length)
      // console.log({offset, length})

      // (this is faster than using set() by the way)
      for (let i=0; i<length; i++) {
        if (offset == this.#size) {
          throw Error('shit')
        }
        output[i] = this.#data[offset++]
        if (offset == this.#size) {
          offset = 0
        }
        this.writeByte(output[i])
      }
      // console.log(output, {text: new TextDecoder().decode(output)})
      // for (let i=0; i<length; i++) {
      //   // this.writeByte(output[i])
      // }
      // process.exit()
      return output
    }
  }

  input = new DataReader(input, false)
  const dict = new LZSS_Dictionary()
  let output = new Uint8Array(outputSize)
  let outputOffset = 0
  // console.time('t')
  while (input.offset < input.size) {
    let blockSize = input.i16()
    if (blockSize == 0) {
      throw Error('LZSS format error!')
    } else if (blockSize < 0) { // direct copy
      blockSize = Math.abs(blockSize)
      if (input.offset + blockSize > input.size) {
        // very strange but happens in e.g. ARA_11.ACM
        blockSize = input.size - input.offset // trim it
        // console.log('block trimmed')
      }
      const data = input.bytes(blockSize)
      output.set(data, outputOffset); outputOffset += data.length
    } else { // use dictionary
      dict.clear()
      let blockOffset = 0
      out: while (true) {
        const flags = input.u8(); blockOffset ++
        for (let i=0; i<8; i++) {
          if (flags >> i & 1) { // bit is 1 (odd)
            const u8 = input.u8(); blockOffset ++
            dict.writeByte(u8)
            output[outputOffset++] = u8
          } else { // bit is 0 (even)
            const byte1 = input.u8(); blockOffset ++
            const byte2 = input.u8(); blockOffset ++
            const offset = byte1 | (byte2 & 0xF0) << 4
            const length =         (byte2 & 0x0F) + 3
            // what a weird order...
            const data = dict.read(offset, length)
            output.set(data, outputOffset); outputOffset += length
          }
          if (blockOffset >= blockSize) {
            if (blockOffset > blockSize) {
              throw Error('LZSS format error!')
            }
            break out
          }
        }
      }
    }
  }
  // console.timeEnd('t')
  return output
}
