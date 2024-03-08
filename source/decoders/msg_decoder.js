
/** Decode a MSG (message) file containing indexed strings for in game dialogs and UI. String might include the filename of a matching ACM (sound). Returns a `Map` where the entries are `{message, [soundFile], [comment]}` and the key the index. */
export function decode_msg(data) {
  const msgMap = new Map()
  const text = new TextDecoder().decode(data)
  const elements = Array(3)
  let offset = 0
  out: while (true) {
    for (let b=0; b<3; b++) {
      const open = text.indexOf('{', offset)
      if (open == -1) break out
      const close = text.indexOf('}', open+1)
      if (close == -1) {
        throw Error('Invalid MSG format.')
      }
      elements[b] = text.slice(open+1, close).trim()
      offset = close
    }
    // any more of the line is a comment
    const comment = text.slice(offset+1, text.indexOf('\r\n', offset+1)).trim()
    const [index, soundFile, message] = elements
    const result = {message}
    if (soundFile) result.soundFile = soundFile.toLowerCase()
    if (comment) result.comment = comment
    msgMap.set(+index, result)
  }
  return msgMap
}

export default decode_msg
