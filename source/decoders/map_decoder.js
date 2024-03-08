// useful https://fallout.fandom.com/wiki/Category:Fallout_2_game_files
import {msgLookup, lstLookup} from '../archive.js'
import {parseId, idType, scrType, frmLookup, scrLookup, proLookup, frmCritterId} from '../idLookup.js'
import {DataReader, merge, modify} from '../misc/dataReaders.js'
import {proSubtypeOfInterestMap} from '../proSubtypeOfInterest.js'

/*
Let's not do any lookups here if not needed (I don't think we need any).
Instead let us do it later if we want to, maybe with some helper functions.
*/

/** If a map object has any of these subtypes then we need to read some specific data. */
const proSubtypeOfInterest = {
  none: 0,
  item_ammo: 1,
  item_key: 2,
  item_misc: 3,
  item_weapon: 4,
  scenery_stairLike: 5, // and ladders
  scenery_doorLike: 6, // or portal
  scenery_elevator: 7,
  misc_exitGrid: 8,
}

/*
The MAP file format consists of 5 parts:
  Header of the MAP file
  Global and Local Variables
  Tiles
  MAP Scripts
  MAP Objects

A 200 by 200 hex grid, for a total of 40000 possible positions
*/
function decodeString(bytes, zeroTerminated = true) {
  let i=0
  for (const byte of bytes) {
    if (byte == 0) break
    i ++
  }
  return new TextDecoder().decode(bytes.subarray(0, i))
}

// export function map_scrnameMsgIdLookup(scrnameMsgId)

export function decode_map(data, {skipProLookup = true} = {}) {
  data = new DataReader(data, false)
  const map = { // header
    version: data.i32(),
    fileName: decodeString(data.bytes(16)).toLowerCase(),
    player: {
      position: data.i32(), // 0x00_00_XX_YY,
      elevation: data.i32(),
      orientation: data.i32(),
    },
    localVars: Array(data.i32()),
    scrnameMsgId: modify(data.i32(), v => v + 100),
    ...data.flags(4, { // signed?
      isSavegameMap: 0b0001,
      noLevel0:     0b0010, // elevation levels
      noLevel1:     0b0100,
      noLevel2:     0b1000,
    }), // e.g. elevation
    darkness: data.i32(), // unused?
    globalVars: Array(data.i32()),
    mapsId: data.i32(), // in the MAPS.TXT (ini file), map name and info about music/ambient and other minor stuff
    // REDMENT.MAP is missing an id, but is in MAPS.TXT though
    gameTime: data.i32() // the time in a savegame map
  }
  // if (map.scrnameMsgId > 0) {
  //   map.scrnameMsgId = msgLookup('scrname', 100 + map.scrnameMsgId)
  // } else map.scrnameMsgId = false
  if (map.version == 19) throw Error('Only Fallout 2 maps are supported for now.')
  if (map.version != 20) throw Error('Invalid MAP file, wrong version number: '+map.version)
  data.offset += 4 * 44 // or = 0x00EC // skip the unknown (or reserved?) space
  // variables
  for (let i=0; i<map.globalVars.length; i++) {
    map.globalVars[i] = data.i32()
  }
  for (let i=0; i<map.localVars.length; i++) {
    map.localVars[i] = data.i32()
  }
  const numLevels = !map.noLevel0 + !map.noLevel1 + !map.noLevel2
  let startLevel
  if      (!map.noLevel0) startLevel = 0
  else if (!map.noLevel1) startLevel = 1
  else if (!map.noLevel2) startLevel = 2
  // tiles
  map.levels = Array(numLevels).fill(0).map(v => {return {
    roof:  Array(10_000).fill(0),
    floor: Array(10_000).fill(0), // iso grid, not the hex grid
  }})
  for (let l=0; l<numLevels; l++) {
    for (let t=0; t<10_000; t++) {
      map.levels[l].roof[t] = data.i16()
      map.levels[l].floor[t] = data.i16()
    }
  }
  // scripts
  map.scripts = readScripts(data)
  // objects
  const totalObjects = data.i32()
  let objectsRead = 0
  for (let l=0; l<3; l++) {
    const objectsThisLevel = data.i32()
    const objects = Array(objectsThisLevel)
    for (let o=0; o<objectsThisLevel; o++) {
      objects[o] = readObject(data, skipProLookup)
      objectsRead++
    }
    if (objectsThisLevel) map.levels[l-startLevel].objects = objects
  }
  if (objectsRead != totalObjects) throw Error('Object count mismatch.')
  if (data.offset != data.size) throw Error('Did not read the whole MAP, format mismatch.')
  return map
}; export default decode_map

function readScripts(data) {
  /*
  https://falloutmods.fandom.com/wiki/MAP_File_Format#Tiles
  https://github.com/JanSimek/geck-map-editor/blob/master/src/format/map/MapScript.h
  https://github.com/JanSimek/geck-map-editor/blob/master/src/reader/map/MapReader.cpp
  */
  const scripts = []
  let totalScripts = 0
  for (let block=0; block<5; block++) {
    const scriptsInBlock = data.i32()
    if (scriptsInBlock > 0) {
      totalScripts += scriptsInBlock
      let blockCountCheck = 0, scriptsRead = 0
      const blockSize = Math.ceil(scriptsInBlock / 16) * 16
      for (let i=0; i<blockSize; i++) {
        scriptsRead ++
        const script = readScript(data, scriptsRead, scriptsInBlock)
        if (script) scripts.push(script)
        if (i % 16 == 15) { // read the count variable
          blockCountCheck += data.i32()
          data.offset += 4 // unknown
        }
      }
      if (blockCountCheck != scriptsInBlock) {
        throw Error('Error reading details about the MAP scripts, block blockCountCheck != scriptsInBlock.')
      }
      // also check that it didn't skip valid scripts
      if (scripts.length != totalScripts) throw Error('scripts.length != totalScripts')
    }
  }
  return scripts
}

function readScript(data, scriptsRead, scriptsInBlock) {
  // -858993460 is a value for data not used
  const header = data.u32()
  if (header == 0xCCCC_CCCC) {
    data.offset += 4 * 15
    return false
  } // else we must parse it (even if outside of scriptsInBlock)
  const script = parseId(header)
  script.nextScript = data.i32()
  switch (scrType[script.typeId]) {
    case 'timer':
      script.time = data.i32()
    break
    case 'spatial':
      script.elevation = data.i16()
      // data.flags(2, {
      //   nd :          0xFF + 0b0000,
      //   noLevel10:    0xFF +0b0001,
      //   noLevel0:     0xFF +0b0010,
      //   noLevel1:     0xFF +0b0100,
      //   noLevel2:     0xFF +0b1000,
      // }, true)
      script.hexPos = data.i16()
      script.radius = data.i32()
    break
  }
  // text/english/game/scrname.msg from 101
  data.objectByKeys('i32', [
    'flags',
    'lstId',
    'unknown5',
    'oid',
    'lvaroffset',
    'numvars'
  ], undefined, script)
  for (let i=9; i<=16; i++) {
    script['unknown'+i] = data.i32()
  }
  if (script.nextScript != -1 || script.lvaroffset != -1 || script.unknown12 != -1) {
    return false
  }
  // script.lstId = await lstLookup('scripts/scripts.lst', script.lstId, false)
  if (script.oid != -858993460) { // it's set for critters, don't know what it points to
    // script.oid = //await lstLookup('proto/critters/critters.lst', script.oid)
  } else script.oid = false
  if (scriptsRead > scriptsInBlock) return false
  return script
}

function readObject(data, skipProLookup) {
  const obj = {
    unknown1: data.i32(),
    position: data.i32(), // -1 == in an inventory
    x: data.i32(),
    y: data.i32(),
    sx: data.i32(),
    sy: data.i32(),
    frameNumber: data.i32(), // of FRM
    orientation: data.i32(),
    frmId: data.i32(),//await frmId(data),
    // frm: data.i32(), //await frmId(data),
    ...data.bitField(1, {
      reserved: 5,
      inRightHand: 1,
      inLeftHand: 1,
      onBody: 1,
    }),
    unknown2: data.bytes(3), // more flags it seems, e.g. [ 0, 128, 24 ],
    elevation: data.i32(),
    proId: data.i32(),
    // protoFile: await proId(data),
    critterIndex: data.i32(), // -1 if not
    lightRadius: data.i32(),
    lightBrightness: data.i32(),
    outline: data.i32(),
    mapScriptId: data.i32(),//await scrId(data), // what is this?
    relatedScriptId: data.i32(),//await scrId(data), // in script.lst or -1
    inventoryObjects: data.i32(),
    // inventoryObjects: Array(data.i32()),
    inventorySlots: data.i32(),
    unknown3: data.i32(),
    unknown4: data.i32(),
  }
  delete obj.unknown2
  obj.type = idType[parseId(obj.frmId).typeId]
  // merge(obj, await proId(obj.proId))
  // in every map readTypeAndId(obj.frm) (the u32) will have a type 1 (critter) for critters (I guess because orientation is set elsewhere)
  // obj.frm = obj.type == 'critters' ? 
  //   await frmCritterId(obj.frm) : await frmId(obj.frm)
  if (obj.inventoryObjects > 0) obj.inventoryObjects = Array(obj.inventoryObjects)
  // if (!skipProLookup) obj.pro = await loadPro(obj)
  // extra fields for different objects
  if (obj.type == 'critters') {
    data.objectByKeys('i32', [
      'sav_reactionToPlayer',
      'sav_mp',
      'sav_combatResult',
      'sav_dmgLastTurn',
      'aiPacket', // Packet number of critter AI, found in data/AI.txt.
      'groupId', // or teamId?
      'sav_whoHitMe',
      'hitPoints',
      'radiation',
      'poison'
    ], undefined, obj) // merges to obj
  } else {
    switch (proSubtypeOfInterestMap.get(obj.proId)) {
      case proSubtypeOfInterest.item_ammo:
        obj.inMagazine = data.i32()
      break
      case proSubtypeOfInterest.item_key:
        obj.keyCode = data.i32()
      break
      case proSubtypeOfInterest.item_misc:
        obj.charges = data.i32()
      break
      case proSubtypeOfInterest.item_weapon:
        obj.inMagazine = data.i32()
        obj.ammoProId = data.i32()// = await proId(data) // proto/items/items.lst 
      break
      case proSubtypeOfInterest.scenery_stairLike:
        obj.destination = {
          position: data.i16(), // in HEX grid
          elevation: data.i16(),
          mapNumber: data.i32()// only in MAP version 20?
        }
      break
      case proSubtypeOfInterest.scenery_doorLike:
        obj.walkThrough = data.i32()
      break
      case proSubtypeOfInterest.scenery_elevator:
        obj.elevator = {
          type: data.i32(),
          level: data.i32()
        }
      break
      case proSubtypeOfInterest.misc_exitGrid:
        obj.exit = {
          destination: data.objectByKeys('i32', [
            'mapId',
            'position',
            'elevation',
            'orientation'
          ])
        }
      break
    }
  }

  // switch (obj.proto.type) {
  //   case 'critters': {
  //     data.objectByKeys('i32', [
  //       'sav_reactionToPlayer',
  //       'sav_mp',
  //       'sav_combatResult',
  //       'sav_dmgLastTurn',
  //       'aiPacket', // Packet number of critter AI, found in data/AI.txt.
  //       'groupId', // or teamId?
  //       'sav_whoHitMe',
  //       'hitPoints',
  //       'radiation',
  //       'poison'
  //     ], undefined, obj) // merges to obj
  //   }; break
  //   case 'items': {
  //     switch (obj.proto.item.type) {
  //       case 'Ammo': {
  //         obj.inMagazine = data.i32()
  //       }; break
  //       case 'Key': {
  //         obj.keyCode = data.i32()
  //       }; break
  //       case 'Misc Item': {
  //         obj.charges = data.i32() // or inMagazine?
  //       }; break
  //       case 'Weapon': {
  //         obj.inMagazine = data.i32()
  //         obj.ammoProto = await proId(data) // proto/items/items.lst 
  //       }; break
  //     }
  //   }; break
  //   case 'scenery': {
  //     switch (obj.proto.scenery.type) {
  //       case 'Ladder Bottom':
  //       case 'Ladder Top':
  //       case 'Stairs': {
  //         obj.destination = {
  //           position: data.i16(), // in HEX grid
  //           elevation: data.i16(),
  //           mapNumber: data.i32()// only in MAP version 20?
  //         }
  //       }; break
  //       case 'Portal': {
  //         obj.walkThrough = data.i32()
  //       }; break
  //       case 'Elevator': {
  //         obj.elevator = {
  //           type: data.i32(),
  //           level: data.i32()
  //         }
  //       }; break
  //     }
  //   }; break
  //   case 'misc': {
  //     if (obj.proto.title == 'Exit Grid') {
  //       obj.exit = {
  //         destination: data.objectByKeys('i32', [
  //           'mapId',
  //           'position',
  //           'elevation',
  //           'orientation'
  //         ])
  //       }
  //     }
  //   }; break
  // }

  if (obj.inventoryObjects.length) {
    for (let i=0; i<obj.inventoryObjects.length; i++) {
      obj.inventoryObjects[i] = {
        count: data.i32(),
        object: readObject(data, skipProLookup)
      }
    }
  }
  return obj
}

async function loadPro({type, file}) {
  const path = 'proto/'+type+'/'+file
  const pro = await falloutArchive.extractFile(path)
  return pro
}
