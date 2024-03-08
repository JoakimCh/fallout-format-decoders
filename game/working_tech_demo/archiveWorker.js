
import {Archive} from './ffd/archive.js'
import {getRfcMessageHandler, registerInstanceFunctions} from './workerRPC.js'

const cmdToFunctionMap = new Map()
// cmdToFunctionMap.set('importMapInit', async importMap => {
//   const Archive = (await import(importMap.imports['ffd/']+'archive.js')).Archive
//   const archive = new Archive()
//   registerInstanceFunctions(cmdToFunctionMap, archive)
//   // we're now an archive proxy
//   postMessage('rfcReady')
// })
onmessage = getRfcMessageHandler(cmdToFunctionMap)

const archive = new Archive()
registerInstanceFunctions(cmdToFunctionMap, archive)
// we're now an archive proxy

postMessage('rfcReady')
