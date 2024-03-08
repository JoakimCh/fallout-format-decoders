/*
Documentation of format:
https://github.com/markokr/libacm/blob/master/src/decode.c
https://github.com/cvet/fonline/blob/master/ThirdParty/Acm/acmstrm.cpp
https://github.com/alexbatalov/fallout1-ce/blob/main/src/sound_decoder.cc
https://github.com/alexbatalov/fallout2-ce/blob/main/src/sound_decoder.cc
*/

import {DataReader} from '../misc/dataReaders.js'
import {SimpleDataWriter} from '../misc/simpleDataWriter.js'

export default decode_acm

export function decode_acm(data, {addWaveHeader = true, correctChannelCount = 2}) {
  const decoder = new ACM_Decoder(data, {addWaveHeader, correctChannelCount})
  return decoder.toArrayBuffer()
}

function createWaveHeader({numSamples, sampleRate, numChannels, bitsPerSample}) {
  const bytesPerSample = bitsPerSample / 8
  const buffer = new ArrayBuffer(44)
  const dw = new SimpleDataWriter(buffer, true)
  dw.string('RIFF')
  dw.u32(36 + numSamples*bytesPerSample)
  dw.string('WAVE')
  dw.string('fmt ')
  dw.u32(16)
  dw.u16(1) // for PCM
  dw.u16(numChannels)
  dw.u32(sampleRate)
  dw.u32((sampleRate * bitsPerSample * numChannels) / 8)
  dw.u16((bitsPerSample * numChannels) / 8)
  dw.u16(bitsPerSample)
  dw.string('data')
  dw.u32(numSamples * bytesPerSample)
  return buffer //dw.dataView
}

// unsigned int to signed conversion tables (for 1 to 3 bit values)
const map_1bit      =             [-1, +1]
const map_2bit      =         [-2, -1, +1, +2]
const map_2bit_far  =         [-3, -2, +2, +3]
const map_3bit      = [-4, -3, -2, -1, +1, +2, +3, +4]
const mul_2x11 = Array(11*11)
const mul_3x3  = Array(3*3*3)
const mul_3x5  = Array(5*5*5)

{ // generate tables
  for (let x2 = 0; x2 < 11; x2++) {
		for (let x1 = 0; x1 < 11; x1++) {
			mul_2x11[x1 + x2*11] = x1 + (x2 << 4)
    }
  }
  for (const rounds of [3,5]) {
    for (let x3 = 0; x3 < rounds; x3++) {
      for (let x2 = 0; x2 < rounds; x2++) {
        for (let x1 = 0; x1 < rounds; x1++) {
          const array = (rounds == 3 ? mul_3x3 : mul_3x5)
          const index = x1 + x2*rounds + x3*rounds*rounds
          array[index] = x1 + (x2 << 4) + (x3 << 8)
        }
      }
    }
  }
}

// this can also be used to handle raw ACM data that we have buffered, e.g. outputting a stream which gives us each block when needed, maybe interact directly with the audio API
export class ACM_Decoder {
  #input // input data
  #block // buffer for current block
  #wrap // buffer used while merging the subbands
  #increment; #maxIncrement // for current block
  // lastCommands = []
  #decodingInProgress
  #addWaveHeader
  // internally useful values
  #numSamples; #sampleRate; #level; #subbandLength; #numSubbands; #blockLength; #wrapLength; #block_samples_per_subband; #block_total_samples
  #headerSize
  /** Last block written to, the first block is number 1. */
  #blockNumber = 0
  #subbandIndex = 0; #currentSubband = 0

  /** Only if you know what you're doing. */
  resetToStart() {
    this.#decodingInProgress = false
    this.#input.bitsLeftover = 0
    this.#input.offset = this.#headerSize // start of data
    this.#blockNumber = 0
    this.#subbandIndex = 0
    this.#currentSubband = 0
    // this.#wrap.fill(0)
    // this.#block.fill(0)
  }

  constructor(data, {addWaveHeader = true, correctChannelCount = 2}) {
    this.#input = new DataReader(data, true) // (littleEndian=true)
    this.#addWaveHeader = addWaveHeader
    try {
      this.#readHeader()
      if (correctChannelCount) {
        this.header.numChannels = correctChannelCount
      }
    } catch (error) {
      if (error == 1 || error instanceof RangeError) {
        throw Error(`ACM format error, invalid header.`)
      }
      throw error
    }
  }

  toArrayBuffer() {
    const output = new Uint16Array(this.#numSamples + (this.#addWaveHeader ? 22 : 0))
    for (const block of this.blocks(output)) {}
    return output.buffer
  }

  toReadable() {
    const iterator = this.blocks()
    return new ReadableStream({
      pull(controller) {
        const {value, done} = iterator.next()
        if (done) {
          controller.close()
        } else {
          controller.enqueue(value)
        }
      }
    })
  }

  // so `for (const block of ACM_Decoder_instance)` will work
  *[Symbol.iterator](writeInto = false) {
    yield* this.blocks(writeInto) // (delegate to another generator)
  }

  /** Iterate through the output blocks (generated on the fly from the input). */
  *blocks(writeInto = false) {
    if (writeInto) {
      if (!(writeInto instanceof Uint16Array)) {
        throw Error(`writeInto must be a Uint16Array.`)
      } else if (this.#addWaveHeader) {
        if (writeInto.length < this.#numSamples + 22) {
          throw Error(`writeInto must be a Uint16Array big enough to hold the ${this.#numSamples} samples plus the 22 values for the WAVE header.`)
        }
      } else if (writeInto.length < this.#numSamples) {
        throw Error(`writeInto must be a Uint16Array big enough to hold the ${this.#numSamples} samples.`)
      }
    }
    if (this.#decodingInProgress) throw Error(`The decoding iterator is already engaged and must complete before we can iterate from block 1 again.`)
    this.#decodingInProgress = true
    if (this.#addWaveHeader) {
      const buffer = createWaveHeader(this.header)
      const header = new Uint16Array(buffer)
      if (writeInto) writeInto.set(header)
      yield header
    }
    // setup buffers, todo check if we must reset them?
    if (!this.#wrap)  this.#wrap  = new Int32Array(this.#wrapLength)
    if (!this.#block) this.#block = new Int32Array(this.#blockLength)
    let eof
    while (!eof) {
      try {
        this.#readBlock()
      } catch (error) {
        if (error instanceof RangeError) { // end of input
          eof = true
        } else throw error
      }
      this.#juggleBlock()
      yield this.#outputBlock(writeInto)
    }
    this.resetToStart()
  }

  #subbandWrite(value) {
    if (this.#subbandIndex == 0 && this.#currentSubband == 0) {
      this.#blockNumber ++
    }
    // const blockIndex = (this.#subbandIndex << this.level) + this.#currentSubband
    const blockIndex = (this.#subbandIndex * this.#numSubbands) + this.#currentSubband
    // write the subband sample amplitude for this index
    this.#block[blockIndex] = value * this.#increment
    // if (Math.abs(value) > this.#maxIncrement) throw Error(`ACM format error.`)
    if (++this.#subbandIndex == this.#subbandLength) {
      this.#subbandIndex = 0
      if (++this.#currentSubband == this.#numSubbands) {
        this.#currentSubband = 0 // done with block
      }
      return true // if the subband is complete
    }
    return false // if more can be written to the subband
  }

  /** Correct the amplitude and encode the output into 16 bits wide samples. */
  #outputBlock(out) {
    const mustTrim = this.#subbandIndex || this.#currentSubband || this.#blockNumber * this.#blockLength > this.#numSamples
    const numSamples = mustTrim ? this.#numSamples % this.#blockLength : this.#blockLength
    const output = out ? // write into pre-allocated or not?
      new Int16Array(out.buffer, out.byteOffset + (this.#addWaveHeader ? 44 : 0) + ((this.#blockNumber-1) * this.#blockLength) * 2, numSamples) :
      new Int16Array(numSamples)
    // adjust amplitude to correct level and write to output
    for (let i=0; i < numSamples; i++) {
      output[i] = this.#block[i] >>= this.#level
    }
    return output
  }

  #juggle(wrapOffset, blockOffset, subLen, subCount) {
    for (let i=0; i < subLen; i++) {
      let r0, r1, r2, r3
      r0 = this.#wrap[wrapOffset+0]
      r1 = this.#wrap[wrapOffset+1]
      let offset = blockOffset
      for (let j=0; j < subCount/2; j++) {
        r2 = this.#block[offset]
             this.#block[offset] = r1*2 + (r0 + r2)
                         offset += subLen
        r3 = this.#block[offset]
             this.#block[offset] = r2*2 - (r1 + r3)
                         offset += subLen
        r0 = r2
        r1 = r3
      }
      this.#wrap[wrapOffset+0] = r2
      this.#wrap[wrapOffset+1] = r3
      wrapOffset += 2
      blockOffset++
    }
  }

  /** Merge the subbands to produce the final PCM data. */
  #juggleBlock() {
    if (!this.#level) return

    let blockOffset = 0, remaining = this.#subbandLength
    while (remaining > 0) {
      let wrapOffset = 0
      let subLen, subCount = Math.min(remaining, this.#block_samples_per_subband)

      subLen = this.#numSubbands // alt. to the code commented out (doesn't affect the audible result IMHO)
      // subLen = this.#numSubbands / 2
      // subCount *= 2
      // this.#juggle(wrapOffset, blockOffset, subLen, subCount)
      // wrapOffset += subLen*2

      // for (let i=0; i<subCount; i++) { // WTF?
      //   this.#block[subLen * i]++
      // }

      while (subLen > 1) {
        subLen   /= 2
        subCount *= 2
        this.#juggle(wrapOffset, blockOffset, subLen, subCount)
        wrapOffset += subLen*2
      }
      
      remaining -= this.#block_samples_per_subband
      blockOffset += this.#block_total_samples
    }
  }

  #readWavcHeader() { // todo read values into this.wavc
    const version = this.#input.bits(32)
    if (version != 0x3156_302E) { // 'V1.0'
      throw 1
    }
    for (let i=0; i<10; i++) {
      const value = this.#input.bits(16)
      if (i == 4 && value != 28) { // check this, ignore rest
        throw 1
      }
    }
  }

  #readHeader() {
    const MAGIC_WAVC = 0x56_4157
    const MAGIC_ACM  = 0x03_2897
    let magicBytes = this.#input.bits(24)
    if (magicBytes == MAGIC_WAVC) { // WAVC header follows
      throw 'WAVC header detected' // to see if I find them
      this.wavc = {}
      const byte = this.#input.bits(8)
      if (String.fromCharCode(byte) != 'C') throw 1
      this.#readWavcHeader()
      magicBytes = this.#input.bits(24)
    }
    if (magicBytes != MAGIC_ACM) throw 1
    const version       = this.#input.bits( 8)
    this.#numSamples    = this.#input.bits(32) // num samples
    const numChannels   = this.#input.bits(16) // can NOT be trusted
    this.#sampleRate    = this.#input.bits(16) // in hertz
    this.#level         = this.#input.bits( 4) // packAttrs
    this.#subbandLength = this.#input.bits(12) // rows / samples per sub band
    this.#numSubbands   = 1 << this.#level           // cols / sub bands
    this.#blockLength   = this.#numSubbands * this.#subbandLength
    this.#wrapLength    = this.#numSubbands * 2 - 2
    if (version != 1) throw 1
    if (numChannels != 1 && numChannels != 2) throw 1
    if (this.#sampleRate < 4096) throw 1
    // what exactly does the below represent?
    this.#block_samples_per_subband = 2048 / this.#numSubbands - 2
    if (this.#block_samples_per_subband < 1) {
      this.#block_samples_per_subband = 1
    }
    this.#block_total_samples = this.#block_samples_per_subband * this.#numSubbands
    this.header = { // expose useful info to user
      numSamples: this.#numSamples,
      sampleRate: this.#sampleRate,
      numChannels,
      bitsPerSample: 16
    }
    this.#headerSize = this.#input.offset
  }

  /** Decode input (subband data) into the block. */
  #readBlock() {
    // block header
    this.#maxIncrement = 1 << this.#input.bits( 4)
    this.#increment    =      this.#input.bits(16)
    // block data
    for (let subband = 0; subband < this.#numSubbands; subband++) {
      const decoder = this.#input.bits(5) // the decoder for this subband in the block
      // then run the decoder until every sample in the subband is received (or EOF)
      switch (decoder) {
        case 0: this.#rf_zero(); break

        case 17: this.#rf_func1(1, 2); break
        case 18: this.#rf_func1(1, 1); break
        case 19: this.#rf_shift(5, mul_3x3, 8, 1); break
  
        case 20: this.#rf_func1(2, 2); break
        case 21: this.#rf_func1(2, 1); break
        case 22: this.#rf_shift(7, mul_3x5, 8, 2); break
        
        case 26: this.#rf_func1(3, 2); break
        case 27: this.#rf_func1(3, 1); break
        case 29: this.#rf_shift(7, mul_2x11, 4, 5); break

        case 23: this.#rf_func2(2); break
        case 24: this.#rf_func2(1); break
  
        default: {
          if (decoder >= 3 && decoder <= 16) {
            this.#rf_linear(decoder)
          } else { // not implemented
            throw Error(`ACM format error, decoder for code ${decoder} not implemented.`)
          }
        }
      }
    }
  }

  /** True if zero was set. */
  #setZero(variant = 1) {
    if (variant == 2 && !this.#input.bits(1)) {
      if (this.#subbandWrite(0)) return true
      this.#subbandWrite(0)
    } else if (!this.#input.bits(1)) {
      this.#subbandWrite(0)
    } else {
      return false
    }
    return true
  }

  #rf_zero() {
    while (!this.#subbandWrite(0)) {}
  }

  #rf_linear(bitLength) {
    const middle = 1 << (bitLength - 1)
    for (let done; !done;) {
      done = this.#subbandWrite(this.#input.bits(bitLength) - middle)
    }
  }

  #rf_func1(bits, zero) {
    for (let subband = this.#currentSubband; subband == this.#currentSubband;) {
      if (this.#setZero(zero)) continue
      let map
      switch (bits) {
        case 1: map = map_1bit; break
        case 2: map = map_2bit; break
        case 3: map = map_3bit; break
      }
      this.#subbandWrite(map[this.#input.bits(bits)])
    }
  }

  #rf_func2(zero) {
    for (let subband = this.#currentSubband; subband == this.#currentSubband;) {
      if (this.#setZero(zero)) continue
      if (!this.#input.bits(1)) {
        this.#subbandWrite(map_1bit[this.#input.bits(1)])
      } else {
        this.#subbandWrite(map_2bit_far[this.#input.bits(2)])
      }
    }
  }

  #rf_shift(bitsToRead, arrToUse, maxShift, valToMinus) {
    for (let done; !done;) {
      const v = this.#input.bits(bitsToRead)
      for (let shift=0; !done && shift <= maxShift; shift += 4) {
        done = this.#subbandWrite(((arrToUse[v] >> shift) & 0x0F) - valToMinus)
      }
    }
  }

  // cmd 31 (russian extension)
  // static int ReadBand_Fmt31(SoundDecoder* soundDecoder, int offset, int bits)
  // {
  //     int* samples = (int*)soundDecoder->samples
  
  //     int remaining_samples = soundDecoder->total_samples
  //     while (remaining_samples != 0) {
  //         soundDecoderRequireBits(soundDecoder, 16)
  //         int value = soundDecoder->hold & 0xFFFF
  //         soundDecoderDropBits(soundDecoder, 16)
  
  //         *samples++ = (value << 16) >> (16 - soundDecoder->levels)
  
  //         remaining_samples--
  //     }
  
  //     return 0
  // }
}
