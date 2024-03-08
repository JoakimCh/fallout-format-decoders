
import {frmCritterId} from './frmCritterId.js'
export {frmCritterId} from './frmCritterId.js'

export const idType = [
  'items', // here to misc is the range of PRO types
  'critters', // in critter.dat
  'scenery',
  'walls',
  'tiles',
  'misc', // end of PRO type range
  'intrface', // string matches asset directory
  'inven',
  'heads',
  'backgrnd',
  'skilldex'
]

export function constructId({typeId, id}) {
  if (typeof typeId == 'string') {
    const index = idType.indexOf(typeId)
    if (index == -1) throw Error(`No such type "${typeId}" in idType.`)
    typeId = index
  }
  return (id & 0x00FF_FFFF) | typeId << 24
}

/** Alt FRM type, mentioned [here](https://falloutmods.fandom.com/wiki/PRO_File_Format#PRO_types). */
// export const frmAltType = [
//   'items',
//   'critters',
//   'scenery',
//   'walls',
//   'tiles',
//   'backgrnd',
//   'intrface',
//   'inven'
// ]

/** Parse an ID into `{type, id}`, `type` can then be looked up in the `idType` array.. Works with most IDs. Even with FRM-critter-IDs read from MAP files (because they don't use the orientation bits). */
export function parseId(data) {
  if (typeof data == 'object' && 'type' in data && 'id' in data) return data
  const int32 = typeof data != 'number' ? data.i32() : data
  return {
    typeId: int32 >> 24,
    id: int32 & 0x00FF_FFFF // e.g. lst index
  }
}

export async function sfxId(objType, byte) {
  // Sound Effect ID (Sound Code ID) is a character in the sound effect file name. The location of this character in the file name varies depending on the type of object. Can take the value '0' - '9','A' - 'Z', '!','@','#','$','_'.
}

export const scrType = [
  'system',
  'spatial',
  'timer',
  'item',
  'critter',
]

/** Script lookup. */
export async function scrLookup(data, noIdLookup) {
  let {typeId, id} = parseId(data)
  // console.log({type, id})
  if (typeId == -1) return false
  typeId = scrType[typeId]
  if (!noIdLookup && falloutArchive) {
    const list = await falloutArchive.extractFile('scripts/scripts.lst', {useCache: true, decoderOptions: {includeComments: true}})
    return {typeId, file: list[id]}
  } else {
    return {typeId, id}
  }
}

/** Lookup a "message" in the `proto.msg` file. */
export function protoMsgLookup(msgId, offset = 0) {
  return protoMsg.get(msgId + offset).message
}

/** PRO file lookup. */
export function proLookup(proId) {
  let {typeId, id} = parseId(proId)
  // id -= 1
  if (typeId == -1) throw Error('proId was -1 (code for none assigned)')
  if (typeId < 0 || typeId > 5) throw Error(`proId with invalid typeId (${typeId}): ${proId}`)
  const type = idType[typeId]
  if (globalThis.proLists) {
    const list = proLists.get('proto/'+type+'/'+type+'.lst')
    return {type, id, path: 'proto/'+type+'/'+list[id-1]}
  } else {
    return {type, id}
  }
}

export function frmLookupReverse({type, name}) {
  type = type.toLowerCase()
  name = name.toLowerCase()
  const list = frmLists.get('art/'+type+'/'+type+'.lst')
  if (!list) throw Error(`No art list found for "${type}" (${'art/'+type+'/'+type+'.lst'}).`)
  const typeId = idType.indexOf(type)
  if (!name.endsWith('.frm')) name += '.frm'
  const id = list.indexOf(name)
  if (id == -1) throw Error(`No list entry found for "${name}" under "${type}".`)
  return constructId({typeId, id})
}

/** Lookup which FRM file is bound to the `frmId`, returns `{path}`. For critter FRMs it will also return some more related details. If an `Archive` is not loaded (allowing the lookup) it will just return `{type, id}`. */
export function frmLookup(frmId) {
  let {typeId, id} = parseId(frmId)
  if (typeId == -1) throw Error('frmId was -1 (code for none assigned)')
  const type = idType[typeId]
  if (typeId == undefined) throw Error(`frmId with invalid typeId (${typeId}): ${frmId}`)
  if (globalThis.frmLists) {
    switch (type) {
      default: {
        const list = frmLists.get('art/'+type+'/'+type+'.lst')
        if (!list || !list[id]) throw Error(`frmId not available: ${frmId}, type: ${type}, id: ${id}`)
        return {type, id, path: 'art/'+type+'/'+list[id]}
      }
      case 'critters': return frmCritterId(frmId)
    }
  } else {
    return {type, id}
  }
}
