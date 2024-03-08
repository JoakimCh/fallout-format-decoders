
import {Archive} from '../../source/archive.js'
import {getRfcMessageHandler, registerInstanceFunctions} from './workerRPC.js'

const cmdToFunctionMap = new Map()
onmessage = getRfcMessageHandler(cmdToFunctionMap)

const archive = new Archive()
registerInstanceFunctions(cmdToFunctionMap, archive)
// we're now an archive proxy

postMessage('rfcReady')

