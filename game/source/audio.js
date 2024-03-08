/*
For now I have focused on ACM playback. Other formats will be supported later.
*/

/** The `AudioContext` used. */
export let audioCtx //= new AudioContext()
/** A `Map` of buffered audio. */
export const buffered = new Map()

/** Initialize the `AudioContext` (requires user action like a button click to succeed). */
export async function init() {
  if (!audioCtx) audioCtx = new AudioContext()
  await audioCtx.audioWorklet.addModule('audioWorklet.js')
  if (audioCtx.state == 'suspended') { // (autoplay policy)
    await audioCtx.resume()
  }
}

/** Buffer a sound for instant playback with `playBuffered`. */
export async function buffer(virtualPath, alias = '') {
  if (buffered.has(alias || virtualPath.toLowerCase())) return
  const wavFile = await globalThis.archive.extractFile(virtualPath)
  const buffer = await audioCtx.decodeAudioData(wavFile)
  buffered.set(alias || virtualPath.toLowerCase(), buffer)
}

/** For sounds that needs very instant playback. Buffer them with `buffer` first. */
export function playBuffered(virtualPath, alias = '') {
  const sourceNode = audioCtx.createBufferSource()
  let buffer = buffered.get(alias || virtualPath.toLowerCase())
  if (!buffer) throw Error('Sound must first be buffered.')
  sourceNode.buffer = buffer
  sourceNode.connect(audioCtx.destination)
  sourceNode.start()
  return sourceNode
}

/** Fully decode a sound and play it when ready. See `playBuffered` or `stream` for alternatives to this. */
export async function loadAndPlay(virtualPath) {
  const wavFile = await globalThis.archive.extractFile(virtualPath)
  const buffer = await audioCtx.decodeAudioData(wavFile)
  const sourceNode = audioCtx.createBufferSource()
  sourceNode.buffer = buffer
  sourceNode.connect(audioCtx.destination)
  sourceNode.start()
  return sourceNode
}

/** For large sounds (e.g. music) that should be streamed instead of being fully loaded into memory (might have some latency before playback). */
export async function stream(virtualPath, {loop, mono = virtualPath.startsWith('sound/sfx/')} = {}) {
  // get the compressed audio data (the buffer is transferred from the web worker)
  const acmEncodedData = await globalThis.archive.extractFile(virtualPath, {autoDecode: false})
  // see https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode/AudioWorkletNode
  const audioWorkletNode = new AudioWorkletNode(
    audioCtx,
    'acm-streamer',
    {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], // setup for stereo output
      processorOptions: {loop, mono} // init it with some custom parameters
    }
  )
  // transfer it to the worklet so it can decode it on the fly (again no copying is done)
  audioWorkletNode.port.postMessage(acmEncodedData, [acmEncodedData])
  audioWorkletNode.connect(audioCtx.destination) // start it
  return audioWorkletNode
}


