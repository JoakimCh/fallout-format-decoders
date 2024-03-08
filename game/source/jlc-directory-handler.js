
/** Easily read/write files to a directory without having to manage handles other than the main directory handle. Just use a string based file path and any sub-directories and files will automatically be created for you, ready for you to read/write. */
export class DirectoryHandler {
  #root
  #useCache
  #handleCache = new Map()
  #closePromises = []

  get root() {return this.#root}
  /** Whether to cache the all the `FileSystemDirectoryHandle` we fetch to speed up repeated path resolving. When turned off the cache is cleared. Trying to use a cached handle after the directory has been deleted will result in an error. Hence only use it when it is safe to do so and clear it when needed. */
  get dirHandleCaching() {return this.#useCache}
  set dirHandleCaching(useIt) {
    this.#useCache = useIt
    if (!useIt) this.clearDirectoryHandleCache()
  }

  constructor(directoryHandle) {
    this.#root = directoryHandle
  }

  /** Wait for any pending closes of files written with `earlyClose` set to `true`. */
  async waitPendingCloses() {
    await Promise.all(this.#closePromises)
    this.#closePromises = []
  }

  /** Clear the cache of all the directoryHandles automatically created. */
  clearDirectoryHandleCache() {
    this.#handleCache.clear()
  }
  
  /** Get the `FileSystemDirectoryHandle`. */
  async getDirectoryHandle(path, create = false) {
    while (path.startsWith('/')) path = path.slice(1)
    while (path.endsWith('/')) path = path.slice(0, -1)
    if (path.length == 0) return this.#root
    const parts = path.split('/')
    if (!parts.length) throw Error('Invalid directory path: '+path)
    if (!this.#useCache) {
      let directoryHandle = this.#root
      for (const part of parts) {
        directoryHandle = await directoryHandle.getDirectoryHandle(part, {create})
      }
      return directoryHandle
    } else { // use what we can from the cache
      let directoryHandle = this.#handleCache.get(path)
      if (directoryHandle) return directoryHandle
      // get closest directory handle
      let end
      for (end = parts.length-1; end > 0; end--) {
        const directoryPath = parts.slice(0, end).join('/')
        directoryHandle = this.#handleCache.get(directoryPath)
        if (directoryHandle) {
          if (end == parts.length) { // all of them has handles
            // console.log('has dir handle', directoryPath)
            return directoryHandle
          } else {
            // console.log('closest dir handle', directoryPath)
            break // some are missing
          }
        }
      }
      // create any missing sub directories
      directoryHandle = directoryHandle || this.#root
      for (let p = end; p < parts.length; p++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(parts[p], {create})
        const directoryPath = parts.slice(0, p+1).join('/')
        // console.log('create dir handle', directoryPath, parts[p])
        this.#handleCache.set(directoryPath, directoryHandle)
      }
      return directoryHandle
    }
  }

  /** Check if the file exist, returns the `FileSystemFileHandle` if it does, else `false`. */
  async hasFile(filePath) {
    try {
      return await this.getFileHandle(filePath)
    } catch (error) {
      return false
    }
  }

  /** Returns {directoryHandle, fileName} */
  async getDirectoryHandleForFile(filePath, create = false) {
    if (typeof filePath != 'string') throw Error('filePath must be a string, e.g. "file.txt" or "dir/subdir/file.txt".')
    const parts = filePath.split('/')
    const fileName = parts.pop()
    if (parts.length) {
      return {fileName, directoryHandle: await this.getDirectoryHandle(parts.join('/'), create)}
    } else {
      return {fileName, directoryHandle: this.#root}
    }
  }

  /** Get a `FileSystemFileHandle`. If `create = true` then create the file if needed else throw an error if the file doesn't exist. */
  async getFileHandle(filePath, create = false) { // 'test' 'test/test'
    if (filePath instanceof FileSystemFileHandle) return filePath
    try {
      const {fileName, directoryHandle} = await this.getDirectoryHandleForFile(filePath, create)
      return await directoryHandle.getFileHandle(fileName, {create})
    } catch (error) {
      throw Error('getFileHandle failed for: '+filePath+'. Missing file or permission?', {cause: error})
    }
  }

  async deleteFile(filePath) {
    try {
      const {fileName, directoryHandle} = await this.getDirectoryHandleForFile(filePath)
      return await directoryHandle.removeEntry(fileName)
    } catch (error) {
      throw Error('deleteFile failed for: '+filePath+'. Missing file?', {cause: error})
    }
  }

  /** Writes data to a file (erasing existing). In Chrome there is an issue with a slow close (chromium issue 1472581), hence `earlyExit` can be used to skip waiting for the file to close (then just use `waitPendingCloses()` to wait for any pending closes later). */
  async writeFile(filePath, data, {create = true, earlyExit} = {}) {
    const fileHandle = await this.getFileHandle(filePath, create)
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    if (earlyExit) {
      const closePromise = writable.close()
      this.#closePromises.push(closePromise)
      // return closePromise
    } else {
      await writable.close()
    }
  }

  /** Return a `WritableStream`. */
  async getWritableStream(filePath, create = true) {
    const fileHandle = await this.getFileHandle(filePath, create)
    return await fileHandle.createWritable()
  }

  /** Get the `Blob` like `File` object. This doesn't actually read the file, you do that when accessing its content from the blob (where `slice()` can seek to any offset within it). */
  async getFile(filePath, nullOnError) {
    try {      
      const fileHandle = await this.getFileHandle(filePath)
      return await fileHandle.getFile() // get the File blob like object
    } catch (error) {
      if (nullOnError) return null
      throw error
    }
  }

  /** Read the whole file into an `ArrayBuffer`. */
  async readFile(filePath, {asText, asJSON, nullOnError} = {}) {
    const file = await this.getFile(filePath, nullOnError)
    if (!file) return null
    try {
      if (asJSON) return JSON.parse(await file.text())
      if (asText) return await file.text()
      return await file.arrayBuffer()
    } catch (error) {
      if (nullOnError) return null
      throw error
    }
  }

  /** Return a `ReadableStream`. */
  async getReadableStream(filePath) {
    const file = await this.getFile(filePath)
    return file.stream()
  }

} 
