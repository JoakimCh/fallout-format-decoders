 
export function decode_lst(data, {includeComments = false} = {}) {
  const result = []
  const text = new TextDecoder().decode(data)
  for (const line of text.split('\r\n')) {
    const commentPos = line.indexOf(';')
    if (commentPos != -1) {
      const entry = line.slice(0, commentPos).trim().toLowerCase()
      if (!includeComments) {
        result.push(entry)
        continue
      }
      const comment = line.slice(commentPos+1).trim().toLowerCase()
      result.push([entry, comment])
    } else { // no comment found
      const entry = line.trim().toLowerCase()
      if (!includeComments) {
        result.push(entry)
        continue
      }
      result.push([entry])
    }
  }
  if (result.at(-1) == '') result.pop()
  return result
}

export default decode_lst
