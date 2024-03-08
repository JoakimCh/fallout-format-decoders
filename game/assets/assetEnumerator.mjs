
import * as fs from 'node:fs'
const log = console.log

const fallout2 = []

for (const entry of fs.readdirSync('./', {recursive: true})) {
  if (entry.at(-4) != '.') continue
  if (entry.startsWith('fallout2/')) {
    fallout2.push(entry.slice(9))
  }
}

if (fallout2.length) {
  let script = 'export default [\n'
  for (const file of fallout2) {
    script += "'"+file+"',\n"
  }
  script += ']\n'
  fs.writeFileSync('fallout2.js', script)
}
