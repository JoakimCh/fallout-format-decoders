
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

class Dummy {}

export function findTransferable(obj) {
  const transferable = new Set()
  const objsToSearch = [obj]
  function checkForTransferable(value) {
    if (typeof value !== 'object' || value === null) return
    if (ArrayBuffer.isView(value)) {
      transferable.add(value.buffer) // ArrayBuffer
    } else if (
         value instanceof ArrayBuffer
      || value instanceof MessagePort
      || value instanceof ImageBitmap
      || value instanceof OffscreenCanvas
      || value instanceof ReadableStream
      || value instanceof WritableStream
      || value instanceof TransformStream
      || value instanceof (globalThis.AudioData || Dummy)
      || value instanceof (globalThis.VideoFrame || Dummy)
      || value instanceof (globalThis.RTCDataChannel || Dummy)
      || value instanceof (globalThis.WebTransportSendStream || Dummy)
      || value instanceof (globalThis.WebTransportReceiveStream || Dummy)
    ) {
      transferable.add(value)
    } else objsToSearch.push(value)
  }
  while (objsToSearch.length) {
    const obj = objsToSearch.pop()
    if (Array.isArray(obj)) {
      obj.forEach(checkForTransferable)
    } else if (typeof obj === 'object') {
      if (typeof obj[Symbol.iterator] === 'function') {
        [...obj.values(obj)].forEach(checkForTransferable)
      } else {
        Object.values(obj).forEach(checkForTransferable)
      }
    }
  }
  if (transferable.size) {
    // console.log(transferable)
    return [...transferable]
  }
  return
}
