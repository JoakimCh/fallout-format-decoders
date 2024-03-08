
/** Converts an RGBA (8 bits per channel) bitmap into a PNG. Optionally supply an `offscreenCanvasCtx` to reuse or else one will be created at each call. */
export async function rgbaToPng(bitmap, width, height, offscreenCanvasCtx = null) {
  const ctx = offscreenCanvasCtx || new OffscreenCanvas(width, height).getContext('2d')
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(bitmap)
  ctx.putImageData(imageData, 0, 0)
  const blob = await ctx.canvas.convertToBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
