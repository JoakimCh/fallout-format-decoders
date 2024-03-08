 
export class SimpleDataWriter {
  static dvfMap = new Map([
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

  dataView
  offset = 0
  littleEndian

  constructor(input, {littleEndian = true, byteOffset = 0} = {}) {
    this.dataView = this.#bufferOrViewTo(input, DataView, byteOffset)
    this.littleEndian = littleEndian

    for (const [newName, [orgName, byteWidth]] of SimpleDataWriter.dvfMap.entries()) {
      this[newName] = function(value, littleEndian = this.littleEndian) {
        this.dataView['set'+orgName](this.offset, value, littleEndian)
        this.offset += byteWidth
      }
    }
  }

  #bufferOrViewTo(input, Type, byteOffset = 0) {
    if (input instanceof ArrayBuffer) {
      return new Type(input, byteOffset)
    } else {//if (!(input instanceof DataView)) {
      if (!ArrayBuffer.isView(input)) throw Error('Input must be an ArrayBuffer or an ArrayBuffer view.')
      if (byteOffset % (Type.BYTES_PER_ELEMENT || 1)) {
        throw Error('byteOffset must be aligned to Type.BYTES_PER_ELEMENT')
      }
      const length = (input.byteLength - byteOffset) / (Type.BYTES_PER_ELEMENT || 1)
      return new Type(input.buffer, input.byteOffset + byteOffset, length)
    } 
  }

  bytes(data) {
    const destination = this.#bufferOrViewTo(this.dataView, Uint8Array, this.offset)
    const source = this.#bufferOrViewTo(data, Uint8Array)
    destination.set(source)
    this.offset += source.byteLength
  }

  string(string) {
    this.bytes(new TextEncoder().encode(string))
  }
}
