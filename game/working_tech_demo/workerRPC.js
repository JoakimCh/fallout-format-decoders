
import {findTransferable} from './findTransferable.js'

export class WorkerRFC {
  /** The registered worker. */
  worker; 
  /** Register own functions callable by the worker here (if any). */
  cmdToFunctionMap = new Map()
  ready
  #msgId = 1; #workerReply = new Map()

  constructor(workerPath, {workerOptions = {type: 'module'}} = {}) {
    this.worker = new Worker(workerPath, workerOptions)
    // const importMap = document.querySelector('script[type="importmap"]')
    // if (importMap) {
    //   this.worker.postMessage({importMap: JSON.parse(importMap.textContent)})
    // }
    this.worker.addEventListener('message', this.#workerOnMessage.bind(this))
    this.ready = new Promise(resolve => {
      this.worker.addEventListener('message', ({data}) => {
        resolve(true)
      }, {once: true})
    })
  }

  proxy() {
    const self = this
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
    return new Proxy({}, {
      get: function(target, method) {
        // console.log(method)
        switch (method) {
          case 'then': return // (await can try to read this)
        }
        return function(...args) {
          return self.call(method, ...args)
        }
      }
    })
  }
  
  /** Call a function bound to the given command. */
  call(cmd, ...args) {
    let replyResolve, replyReject, replyPromise = new Promise((resolve, reject) => {
      replyResolve = resolve
      replyReject = reject
    })
    this.#workerReply.set(this.#msgId, {replyResolve, replyReject})
    // console.log({cmd, args})
    this.worker.postMessage({cmd, args, msgId: this.#msgId}, findTransferable(args))
    this.#msgId ++
    return replyPromise
  }

  async #workerOnMessage({data}) {
    if (typeof data != 'object') return
    if (data.reply) {
      const {replyResolve, replyReject} = this.#workerReply.get(data.reply)
      if     ('result' in data) replyResolve(data.result)
      else if ('error' in data) replyReject(data.error)
      else throw Error('Worker reply without result or error.')
    } else if (data.cmd) {
      const {cmd, args, msgId} = data
      const func = this.cmdToFunctionMap(cmd)
      if (!func) throw Error(`Command '${cmd}' was called but did not have a function registered.`)
      try {
        const result = await func(...args)
        postMessage({reply: msgId, result}, findTransferable(result))
      } catch (error) {
        postMessage({reply: msgId, error})
      }
    }
  }
}

export function getRfcMessageHandler(cmdToFunctionMap) {
  if (!(cmdToFunctionMap instanceof Map)) throw Error(`cmdToFunctionMap must be a Map where callable functions are registered.`)
  return async function({data}) {
    if (typeof data != 'object') return
    if (data.importMap) {
      return cmdToFunctionMap.get('importMapInit')?.(data.importMap)
    }
    const {cmd, args, msgId} = data
    const func = cmdToFunctionMap.get(cmd)
    if (!func) throw Error(`Command '${cmd}' was called but did not have a function registered.`)
    try {
      const result = await func(...args)
      postMessage({reply: msgId, result}, findTransferable(result))
    } catch (error) {
      postMessage({reply: msgId, error})
    }
  }
}

export function registerInstanceFunctions(cmdToFunctionMap, instance) {
  const proto = Object.getPrototypeOf(instance)
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key == 'constructor') continue
    // console.log(key)
    if (typeof instance[key] == 'function') {
      cmdToFunctionMap.set(key, instance[key].bind(instance))
    }
  }
}
