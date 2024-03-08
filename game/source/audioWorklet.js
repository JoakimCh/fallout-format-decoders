
import {ACM_Decoder} from '../../source/decoders/acm_decoder.js'

class AcmStreamer extends AudioWorkletProcessor {
  #decoder
  #loop; #mono
  /** Calling next() on it decodes a new block. */
  #blockIterator
  /** Blocks buffered. */
  #bufferedBlocks = []
  /** Current block */
  #block = {length: 0}
  /** Offset in current block. */
  #blockOffset = 0
  /** Total samples buffered. */
  #samplesBuffered = 0
  /** If playback is finished or not. */
  #done = false

  constructor({numberOfInputs, numberOfOutputs, processorOptions}) {
    super(...arguments)
    this.port.onmessage = ({data}) => {
      this.#decoder = new ACM_Decoder(data, {
        addWaveHeader: false, // just get the samples
      })
      this.#blockIterator = this.#decoder.blocks()
      this.#loop = processorOptions.loop
      this.#mono = processorOptions.mono
    }
  }

  // (it should be guaranteed 0 inputs and 1 output with 2 channels)
  process(inputs, outputs, parameters) {
    if (!this.#blockIterator) return true // Firefox fix
    if (this.#done) return false
    const output = outputs[0]
    if (output.length != 2) throw Error(`Channel count not 2.`)

    const channelLength = output[0].length
    const samplesWanted = this.#mono ? channelLength : channelLength * 2
    while (this.#samplesBuffered < samplesWanted) {
      const {value: block, done} = this.#blockIterator.next() // decode another block
      if (block) {
        if (!this.#mono && block.length % 2) {
          throw Error('Odd block length encountered during stereo playback, sound must be mono.')
        }
        this.#bufferedBlocks.push(block)
        this.#samplesBuffered += block.length
      } else { // (then done == true)
        if (this.#loop) {
          this.#blockIterator = this.#decoder.blocks() // restart
        } else break
      }
    }

    let samplesConsumed = 0
    for (let channelOffset=0; channelOffset<channelLength; channelOffset++) {
      samplesConsumed += this.#mono ? 1 : 2
      if (samplesConsumed > this.#samplesBuffered) {
        this.#done = true // (can only happen when done)
        break
      }
      if (this.#blockOffset == this.#block.length) {
        this.#block = this.#bufferedBlocks.shift()
        this.#blockOffset = 0
      }
      // normalize input to -1.0 to 1.0 and write it to the correct channel in the output
      if (this.#mono) {
        const value = this.#block[this.#blockOffset++] / 0xFFFF 
        output[0][channelOffset] = value
        output[1][channelOffset] = value
      } else {
        output[0][channelOffset] = this.#block[this.#blockOffset++] / 0xFFFF 
        output[1][channelOffset] = this.#block[this.#blockOffset++] / 0xFFFF 
      }
    }
    this.#samplesBuffered -= samplesConsumed

    return !this.#done // "returning true forces the browser to keep the node alive"
  }
}

registerProcessor('acm-streamer', AcmStreamer)


