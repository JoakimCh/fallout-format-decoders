
/** Used to get the decoders for content inside of DAT archives. The decoder should take one argument which is a [BufferSource](https://mdn1.moz.one/en-US/docs/Web/API/BufferSource). */
export async function getDecoder(forExtension) {
  try {
    if (forExtension.startsWith('fr')) {
      const ori = +forExtension.slice(-1)
      if (ori >= 0 && ori <= 5) {
        return (await import('./frm_decoder.js')).getFrxDecoder(ori)
      }
    }
    // I guess this is already perfectly cached and that adding another cache would be stupid
    return (await import('./'+forExtension+'_decoder.js')).default
  } catch (error) {
    // console.log(error)
    if (error instanceof SyntaxError
    || error instanceof ReferenceError) throw error
    return null
  }
}
