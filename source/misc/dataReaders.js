
// const dvfTable = [
//   [     'Int8', 1,  'i8'],
//   [    'Uint8', 1,  'u8'],
//   [    'Int16', 2, 'i16'],
//   [   'Uint16', 2, 'u16'],
//   [    'Int32', 4, 'i32'],
//   [   'Uint32', 4, 'u32'],
//   [  'Float32', 4, 'f32'],
//   [  'Float64', 4, 'f64'],
//   [ 'BigInt64', 4, 'i64'],
//   ['BigUint64', 4, 'u64'],
// ]

const dvfMap = new Map([
  [ 'i8',      ['Int8', 1]],
  [ 'u8',     ['Uint8', 1]],
  ['i16',     ['Int16', 2]],
  ['u16',    ['Uint16', 2]],
  ['i32',     ['Int32', 4]],
  ['u32',    ['Uint32', 4]],
  ['f32',   ['Float32', 4]],
  ['f64',   ['Float64', 4]],
  ['i64',  ['BigInt64', 4]],
  ['u64', ['BigUint64', 4]],
])

const dvToTaMap = new Map([
  [Int8Array,     'Int8'],
  [Uint8Array,    'Uint8'],
  [Int16Array,    'Int16'],
  [Uint16Array,   'Uint16'],
  [Int32Array,    'Int32'],
  [Uint32Array,   'Uint32'],
  [Float32Array,  'Float32'],
  [Float64Array,  'Float64'],
  [BigInt64Array, 'BigInt64'],
  [BigUint64Array,'BigUint64'],
])

export class NodejsFileRandomAccessReader {
  fd
  #size
  offset = 0
  littleEndian

  constructor(fileDescriptor, littleEndian = true) {
    this.fd = fileDescriptor
    this.littleEndian = littleEndian
    if (!globalThis.fs?.fstatSync) throw Error('When using Node.js you must expose node:fs as globalThis.fs before using this function.')
    this.#size = globalThis.fs.fstatSync(this.fd).size

    for (const [newName, [orgName, byteWidth]] of dvfMap.entries()) {
      this[newName] = function(littleEndian = this.littleEndian) {
        const dv = this.read(byteWidth)
        return dv['get'+orgName](0, littleEndian)
      }
    }
  }

  get size() {return this.#size}

  /** Read numBytes from this offset, returns a DataView or Uint8Array. */
  read(numBytes, {offset = this.offset, asDataView = true} = {}) {
    if (offset + numBytes > this.#size) throw Error(`Tried to read past (${offset} + ${numBytes}) the bytes available (${this.#size}).`)
    const buffer = Buffer.allocUnsafe(numBytes)
    globalThis.fs.readSync(this.fd, buffer, {position: offset})
    this.offset += numBytes
    if (asDataView) {
      return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    } else {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    }
  }
}

// random access blob reader (using slice)
export class BlobRandomAccessReader {
  blob
  offset = 0
  littleEndian

  constructor(blob, littleEndian = true) {
    this.blob = blob
    this.littleEndian = littleEndian

    for (const [newName, [orgName, byteWidth]] of dvfMap.entries()) {
      this[newName] = async function(littleEndian = this.littleEndian) {
        const dv = await this.read(byteWidth)
        return dv['get'+orgName](0, littleEndian)
      }
    }
  }

  get size() {return this.blob.size}

  /** Read numBytes from this offset, returns a DataView or Uint8Array promise. */
  async read(numBytes = this.blob.size, {offset = this.offset, asDataView = true} = {}) {
    if (offset + numBytes > this.blob.size) throw Error(`Tried to read past (${offset} + ${numBytes}) the bytes available (${this.blob.size}).`)
    const arrayBuffer = await this.blob.slice(offset, offset + numBytes).arrayBuffer()
    this.offset += numBytes
    if (asDataView) {
      return new DataView(arrayBuffer)
    } else {
      return new Uint8Array(arrayBuffer)
    }
  }
}

// just a simple code to make reading data easier from a dataview
export class DataReader {
  dataView
  offset = 0
  littleEndian
  bitsLeftover = 0
  valueLeftover

  /** Input must be a [BufferSource](https://mdn1.moz.one/en-US/docs/Web/API/BufferSource). */
  constructor(input, littleEndian = true) {
    if (input instanceof ArrayBuffer) {
      input = new DataView(input)
    } else if (!(input instanceof DataView)) {
      if (!ArrayBuffer.isView(input)) throw Error(`Input must be an ArrayBuffer or an ArrayBuffer view. Not ${input}.`)
      input = new DataView(input.buffer, input.byteOffset, input.byteLength)
    }
    this.dataView = input
    this.littleEndian = littleEndian

    for (const [newName, [orgName, byteWidth]] of dvfMap.entries()) {
      this[newName] = function(littleEndian = this.littleEndian) {
        const value = this.dataView['get'+orgName](this.offset, littleEndian)
        this.offset += byteWidth
        return value
      }
    }
  }

  get size() {return this.dataView.byteLength}

  /** Read 1 to 32 bits and return their unsigned value. */
  bits(bitsToRead, littleEndian = this.littleEndian) {
    if (this.bitsLeftover == bitsToRead) {
      this.bitsLeftover = 0
      return this.valueLeftover
    }
    if (this.bitsLeftover > bitsToRead) {
      const result = this.valueLeftover & (2 ** bitsToRead - 1)
      this.valueLeftover >>= bitsToRead
      this.bitsLeftover -= bitsToRead
      return result
    }

    bitsToRead -= this.bitsLeftover
    if (bitsToRead + this.bitsLeftover > 32) throw Error(`Can't read/combine more than 32 bits (bitsToRead + bitsLeftover > 32).`)

    const bytesToRead = Math.ceil(bitsToRead / 8)
    let result, valueRead = 0, leftoverBits = 0, valueLeftover
    // we read them in LittleEndian byte order (it's easier for my mind to deal with)
    switch (bitsToRead) {
      case  8: valueRead =  this.u8(); break
      case 16: valueRead = this.u16(true); break
      case 32: valueRead = this.u32(true); break
      default:
        for (let byteIndex=0; byteIndex<bytesToRead; byteIndex++) {
          valueRead |= this.u8() << byteIndex * 8
          if (byteIndex == 3) {
            valueRead >>>= 0 // convert Int32 to uInt32
          }
        }
        if (bitsToRead % 8) { // not byte aligned
          leftoverBits = 8 - bitsToRead % 8
          valueLeftover = valueRead >>> bitsToRead
          valueRead &= 2 ** bitsToRead - 1 // trim upper bits
        }
    }

    if (this.bitsLeftover) {
      result = this.valueLeftover
      result |= valueRead << this.bitsLeftover
      result >>>= 0 // convert Int32 to uInt32
    } else {
      result = valueRead
    }

    this.bitsLeftover = leftoverBits
    this.valueLeftover = valueLeftover

    if (!littleEndian) { // correct byte order if needed
      const byteSize = Math.ceil((bitsToRead + this.bitsLeftover) / 8)
      return reverseByteOrder(result, byteSize)
    }

    return result
  }

  bytes(bytesToRead, clamped) {
    if (this.offset + bytesToRead > this.dataView.byteLength) {
      console.log({
        readTo: this.offset + bytesToRead,
        end: this.dataView.byteLength
      })
      throw Error('Trying to read past the end.')
    }
    try {
      const bytes = clamped ? 
        new Uint8ClampedArray(this.dataView.buffer, this.dataView.byteOffset + this.offset, bytesToRead) : 
        new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, bytesToRead)
      this.offset += bytesToRead
      return bytes
    } catch (error) {
      console.log(this.dataView)
      throw error
    }
  }

  typedArray(TypedArray, length, littleEndian = this.littleEndian) {
    const typedArray = new TypedArray(length)
    const readFunc = this.dataView['get'+dvToTaMap.get(TypedArray)].bind(this.dataView)
    for (let i=0; i<typedArray.length; i++) {
      typedArray[i] = readFunc(this.offset, littleEndian)
      this.offset += TypedArray.BYTES_PER_ELEMENT
    }
    return typedArray
  }

  array(dataType, length, littleEndian = this.littleEndian) {
    const [funcName, byteWidth] = dvfMap.get(dataType)
    if (!funcName) throw Error("Invalid dataType (must be 'u8', 'i32', etc): "+dataType)
    const readFunc = this.dataView['get'+funcName].bind(this.dataView)
    const array = Array(length)
    for (let i=0; i<array.length; i++) {
      array[i] = readFunc(this.offset, littleEndian)
      this.offset += byteWidth
    }
    return array
  }
  
  /** The endianness selects the input order of the bytes read. If the bytes are stored in a signed integer (two's complement) then set `fromSignedValue`. */
  bigInt(byteSize, signed = false, littleEndian = this.littleEndian) {
    const bytes = this.bytes(byteSize)
    if (signed) {
      return bigIntFromBytes(bytes, littleEndian)
    } else {
      return bigUintFromBytes(bytes, littleEndian)
    }
  }

  /** The endianness selects the input order of the bytes read. If the bytes are stored in a signed integer (two's complement) then set `fromSignedValue`. */
  bitField(byteSize, template, fromSignedValue = false, littleEndian = this.littleEndian) {
    return readBitField(template, this.bigInt(byteSize, fromSignedValue, littleEndian))
  }

  /** The endianness selects the input order of the bytes read. If the bytes are stored in a signed integer (two's complement) then set `fromSignedValue`. */
  flags(byteSize, template, fromSignedValue = false, littleEndian = this.littleEndian) {
    return readFlags(this.bigInt(byteSize, fromSignedValue, littleEndian), template)
  }

  objectByKeys(dataType, keys, littleEndian = this.littleEndian, object = {}) {
    const [funcName, byteWidth] = dvfMap.get(dataType)
    if (!funcName) throw Error("Invalid dataType (must be 'u8', 'i32', etc): "+dataType)
    const readFunc = this.dataView['get'+funcName].bind(this.dataView)
    for (const key of keys) {
      object[key] = readFunc(this.offset, littleEndian)
      this.offset += byteWidth
    }
    return object
  }

  objectByTemplate(template, littleEndian = this.littleEndian, object = {}) {
    for (const [key, dataType] in Object.entries(template)) {
      const [funcName, byteWidth] = dvfMap.get(dataType)
      if (!funcName) throw Error("Invalid dataType (must be 'u8', 'i32', etc): "+dataType)
      const readFunc = this.dataView['get'+funcName].bind(this.dataView)
      object[key] = readFunc(this.offset, littleEndian)
      this.offset += byteWidth
    }
    return object
  }

  // indexed (replace val with array at index)
  // mapped (replace val with value in map)
}

/** Read an unsigned BigInt from an array of bytes. */
export function bigUintFromBytes(bytes, littleEndian) {
  const lastIndex = BigInt(bytes.length-1)
  let bigInt = 0n
  for (let i=lastIndex; i>=0; i--) {
    bigInt |= BigInt(bytes[littleEndian ? i : lastIndex-i]) << 8n * i
  }
  return bigInt
}

/** Read a "two's complement" BigInt (meaning it supports signed numbers) from an array of bytes. */
export function bigIntFromBytes(bytes, littleEndian) {
  const bigInt = bigUintFromBytes(bytes, littleEndian)
  const bitSize = BigInt(bytes.length * 8)
  if (bigInt >> bitSize - 1n) { // check the sign bit
    const mask = (2n ** bitSize) - 1n // mask all but the sign bit
    return (-bigInt - 1n) ^ mask // convert to negative number
  }
  return bigInt
}

export function readBitField(template, bigInt) {
  if (typeof template != 'object') throw Error(`A bit-field's template must be an object.`)
  const templateArr = Object.entries(template)
  const result = {...template} // (to copy key order)
  let bitIndex = 0n
  for (let [key, bitWidth] of templateArr.reverse()) {
    if (typeof bitWidth != 'number') throw Error('The bit width must be a number.')
    bitWidth = BigInt(bitWidth)
    const mask = (2n ** bitWidth) - 1n
    const value = (bigInt >> bitIndex) & mask
    if (value > Number.MAX_SAFE_INTEGER) {
      result[key] = value
    } else {
      result[key] = Number(value)
    }
    bitIndex += bitWidth
  }
  bitFieldCheckMisalignment(bitIndex)
  return result
}

function bitFieldCheckMisalignment(bitIndex) {
  let misalignment = bitIndex % 8n
  if (misalignment) {
    misalignment = 8n - misalignment
    throw Error(`The total number of bits in a bit-field must be aligned with a byte boundary, we're missing ${misalignment} of the most significant (leftmost) bits. This can be fixed by adding a padding field, e.g. "reserved: ${misalignment}" at the start.`)
  }
}

export function readFlags(inBigInt, template) {
  const result = {}
  for (const key in template) {
    const flag = BigInt(template[key])
    result[key] = !!(inBigInt & flag)
  }
  return result
}

/** Read elements from an array and automatically move an internal offset forward. It returns the wanted elements using `.subarray` (so a TypedArray will return a subarray viewing a different part of the same underlying buffer). */
export class ArrayReader {
  #array = this.#array
  offset = 0

  constructor(array) {
    this.#array = array
  }

  read(numElements) {
    if (this.offset >= this.#array.length || this.offset + numElements > this.#array.length) throw Error('Tried to read past the end of array.')
    const result = this.#array.subarray(this.offset, this.offset + numElements)
    this.offset += numElements
    return result
  }

  readIntoObject(keys) {
    if (this.offset >= this.#array.length || this.offset + keys.length > this.#array.length) throw Error('Tried to read past the end of array.')
    const obj = {}
    for (const name of keys) {
      obj[name] = this.#array[this.offset]
      this.offset ++
    }
    return obj
  }
}

export function arrayToObject(array, keys) {
  const obj = {}
  for (let i=0; i<keys.length; i++) {
    obj[keys[i]] = array[i]
  }
  return obj
}

/** Intercept an object to replace a value in it. */
export function intercept(obj, replacer) {
  for (const key in obj) replacer(obj, key)
  return obj
}

export function modify(input, modifier) {
  return modifier(input)
}

export function merge(target, source) {
  for (const key in source) {
    target[key] = source[key]
  }
}

export function indexToString(index, strings) {
  return strings[index]
}

// export function indexToMap(index, map) {
//   return strings[index]
// }

/** Return an object with the `keys` enumerated from the `start` offset. */
export function enumerate(keys, start=0) {
  const result = {}
  for (let i=0; i<keys.length; i++) {
    result[keys[i]] = i + start
  }
  return result
}

function reverseByteOrder(value, bytes) {
  let result = 0
  for (let i=0; i<bytes; i++) {
    const byte = value >> i*8 & 0xFF
    result |= byte << (bytes-1-i)*8
  }
  return result >>> 0
}
