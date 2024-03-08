
import {DataReader, merge, intercept, indexToString} from '../misc/dataReaders.js'
import {proLookup, frmLookup, scrLookup, protoMsgLookup} from '../idLookup.js'
import {msgLookup, lstLookup} from '../archive.js'
import {idToWeaponMap} from '../frmCritterId.js'

/*
Every PRO (Prototype) file resides in /proto within sub-dirs like items, critters, walls, tiles, etc.
*/
const msgOffset = { // in PROTO.MSG
  materialType: 100,
  itemType: 150,
  sceneryType: 200,
  damageTypes: 250,
  caliberTypes: 300,
  bodyType: 400,
  killType: 1450
}
const sceneryType = {
  portal: 0,
  stairs: 1,
  elevator: 2,
  ladderBottom: 3,
  ladderTop: 4,
  genericScenery: 5
}
const itemType = {
  armor: 0,
  container: 1,
  drug: 2,
  weapon: 3,
  ammo: 4,
  miscItem: 5,
  key: 6,
}
// const sceneryTypes = [
//   'Portal',
//   'Stairs',
//   'Elevator',
//   'Ladder Bottom',
//   'Ladder Top',
//   'Generic Scenery',
// ]
const damageTypes = [
  'normal_dam',
  'laser',
  'fire',
  'plasma',
  'electrical',
  'emp',
  'explosion',
]
const resistanceTypes = [
  ...damageTypes,
  'radiation',
  'poison', 
]
// https://github.com/JanSimek/geck-map-editor/blob/master/src/reader/pro/ProReader.cpp#L42

// todo: support to extend some items with more info? async
export function decode_pro(data) {
  data = new DataReader(data, false)
  const pro = {
    proId: data.i32(),
    msgId: data.i32(),
    frmId: data.i32(),
    lightRadius: data.i32(),
    lightStrength: data.i32(), // max is 0xFFFF
    flags: data.flags(4, {
      flat:         0x00000008, // (rendered first, just after tiles)
      noBlock:      0x00000010, // (doesn't block the tile)
      multiHex:     0x00000800, 
      noHighlight:  0x00001000, // (doesn't highlight the border; used for containers) 
      transRed:     0x00004000,
      transNone:    0x00008000, // (opaque)
      transWall:    0x00010000,
      transGlass:   0x00020000,
      transSteam:   0x00040000,
      transEnergy:  0x00080000,
      wallTransEnd: 0x10000000, // (changes transparency egg logic. Set for walls with 1144 - 1155 pid)
      lightThru:    0x20000000,
      shootThru:    0x80000000,
    })
  }
  merge(pro, proLookup(pro.proId))
  // const msg = await msgLookup('pro_'+pro.type.slice(0,4), pro.msgId)
  // pro.frm = frmLookup(pro.frmId)
  // if (msg) { // lots of tiles doesn't have any related messages
  //   pro.title = msg.message
  //   pro.description = msg.description
  // }
  //https://www.nexusmods.com/fallout2/mods/52
  pro.typeSpecific = typeSpecific(data, pro)
  if (data.offset != data.size) throw Error('Wrong data end.')
  return pro
}; export default decode_pro

function typeSpecific(data, pro) {
  switch (pro.type) {
    default: throw Error('Invalid PRO type: '+pro.type)
    case 'items': { // size: 129, 125, 122, 81, 69, 65, or 61, depending on type
      const item = read_item(data)
      pro.subType = item.type.toLowerCase()
      return item
    }
    case 'critters': { // size: 416 in Fallout 2, 412 in Fallout 1
      return read_critter(data)
    }
    case 'scenery': { // 	49 or 45, depending on type
      const scenery = {
        wallLightOrientation: data.flags(2, wallLightFlags),
        action: data.flags(2, actionFlags),
        scriptId: data.i32(),//await scrLookup(data),
        typeId: data.i32(),
        material: protoMsgLookup(data.i32(), msgOffset.materialType),
        soundId: data.u8()
      }
      scenery.type = protoMsgLookup(scenery.typeId, msgOffset.sceneryType)
      pro.subType = scenery.type.toLowerCase()
      switch (scenery.typeId) {//pro.scenery.type) { // PROTO.MSG 201
        default: throw Error('Invalid PRO scenery.typeId: '+scenery.typeId)
        case sceneryType.portal: //'Portal': 
          scenery.typeSpecific = {
            walkThrough: data.i32(),
            unknown: data.i32()
          }
          if (data.offset != 49) throw Error('data.offset != 49: '+data.offset)
        break
        case sceneryType.stairs://'Stairs':
          scenery.typeSpecific = {
            destination: {
              tile: data.i16(),
              elevation: data.i16(),
              mapNumber: data.i32() // a number in data/maps.txt, -1 goes to the worldmap
            }
          }
          if (data.offset != 49) throw Error('data.offset != 49: '+data.offset)
        break
        case sceneryType.elevator://'Elevator':
          scenery.typeSpecific = {
            type: data.i32(),
            currentLevel: data.i32()
          }
          if (data.offset != 49) throw Error('data.offset != 49: '+data.offset)
        break
        case sceneryType.ladderTop://'Ladder Top':
          scenery.typeSpecific = {
            destination: {
              tile: data.i16(),
              elevation: data.i16()
            }
          }
          if (data.offset != 45) throw Error('data.offset != 45: '+data.offset)
        break
        case sceneryType.ladderBottom://'Ladder Bottom':
          scenery.typeSpecific = {
            destination: {
              tile: data.i16(),
              elevation: data.i16()
            }
          }
          if (data.offset != 45) throw Error('data.offset != 45: '+data.offset)
        break
        case sceneryType.genericScenery://'Generic Scenery':
          scenery.typeSpecific = {unknown: data.i32()}
          if (data.offset != 45) throw Error('data.offset != 45: '+data.offset)
        break
      }
    } break
    case 'walls': { // 36
      const wall = {
        wallLightOrientation: data.flags(2, wallLightFlags),
        action: data.flags(2, actionFlags),
        scriptId: data.i32(),//await scrLookup(data),
        material: protoMsgLookup(data.i32(), msgOffset.materialType)
      }
      if (data.offset != 36) throw Error('data.offset != 36: '+data.offset)
      return wall
    }
    case 'tiles': { // 28
      const tile = {
        material: protoMsgLookup(data.i32(), msgOffset.materialType)
      }
      if (data.offset != 28) throw Error('data.offset != 28: '+data.offset)
      return tile
    }
    case 'misc': { // 28
      const unknown = data.i32()
      // if (pro.title == 'Exit Grid') {
      //   pro.subType = 'exit grid'
      // }
      if (data.offset != 28) throw Error('data.offset != 28: '+data.offset)
      return unknown
    }
  }
}

const wallLightFlags = {
  ns: 0x0000, // North / South
  ew: 0x0800, // East / West
  nc: 0x1000, // North Corner
  sc: 0x2000, // South Corner
  ec: 0x4000, // East Corner
  wc: 0x8000  // West Corner
}
const actionFlags = {
  kneelDownWhenUsing: 0x0001,
  canBeUsed: 0x0008,
  useOnAnything: 0x0010,
  look: 0x0020,
  talk: 0x0040, 
  pickUp: 0x0080,
}

function read_item(data) {
  const item = {
    flags: data.flags(3, {
      // first byte (LSB)
      bigGun:           0b0000_0001,
      twoHanded:        0b0000_0010,
      canUse:           0b0000_1000,
      canUseOnAnything: 0b0001_0000,
      canPickUp:        0b1000_0000,
      // third byte
      hiddenItem: 0x80000,
    }),
    attackModes: (() => {
      const attackModes = [
        'none',
        'punch',
        'kick',
        'swing',
        'thrust',
        'throw',
        'fireSingle',
        'fireBurst',
        'flame',
      ]
      const byte = data.u8()
      return {
        primary: attackModes[byte & 0x0F],
        secondary: attackModes[byte >> 4]
      }
    })(),
    scriptId: data.i32(),//await scrLookup(data),
    typeId: data.i32(),
    material: protoMsgLookup(data.i32(), msgOffset.materialType),
    size: data.i32(),
    weight: data.i32(),
    cost: data.i32(),
    invFrmId: data.i32(),//await frmLookup(data),
    soundId: data.u8()
  }
  item.type = protoMsgLookup(item.typeId, msgOffset.itemType)
  switch (item.typeId) {
    default: throw Error('Invalid PRO item.type: '+item.type.toString(2))
    case itemType.armor: item.typeSpecific     = read_item_armor(data); break
    case itemType.container: item.typeSpecific = read_item_container(data); break
    case itemType.drug: item.typeSpecific      = read_item_drug(data); break
    case itemType.weapon: item.typeSpecific    = read_item_weapon(data); break
    case itemType.ammo: item.typeSpecific      = read_item_ammo(data); break
    case itemType.miscItem: item.typeSpecific  = read_item_misc(data); break
    case itemType.key: item.typeSpecific       = read_item_key(data); break
  }
  return item
}

function read_item_key(data) {
  const key = data.i32()
  if (data.offset != 61) throw Error('data.offset != 61: '+data.offset)
  return key
}

function read_item_misc(data) {
  const misc = {
    ...data.objectByKeys('i32', [
      'powerPid',
      'powerType',
      'charges',
    ])
  }
  if (data.offset != 69) throw Error('data.offset != 69: '+data.offset)
  return misc
}

function read_item_ammo(data) {
  const ammo = {
    ...data.objectByKeys('i32', [
      'type',
      'magazineSize',
      'armorClassModifier', // i32
      'damageResistanceModifier',
      'damageMultiplier',
      'damageDivisor',
    ])
  }
  ammo.type = protoMsgLookup(ammo.type, msgOffset.caliberTypes)
  if (data.offset != 81) throw Error('data.offset != 81: '+data.offset)
  return ammo
}

function read_item_weapon(data) {
  const weapon = {
    animation: idToWeaponMap.get(data.i32()),
    damage: data.objectByKeys('i32', [
      'min',
      'max',
      'type' // proto.msg, starting with the line 250
    ]),
    ...data.objectByKeys('i32', [
      'primaryAttackRange',
      'secondaryAttackRange',
      'projectilePid',
      'minStrengthNeeded',
      'actionPointCostPrimary',
      'actionPointCostSecondary',
      'critFailId',
      'associatedPerkId', // see perk.msg, starting with the line 101; -1 for no perk
      'burstRounds',
      'ammoTypeId', // proto.msg, starting with the line 300
      'ammoPid', // Index in items.lst
      'magazineSize',
    ]),
    soundId: data.u8() // Line number in sound/sfx/sndlist.lst
  }
  // weapon.projectilePid = await proLookup(weapon.projectilePid)
  weapon.damage.type = damageTypes[weapon.damage.type]
  // weapon.associatedPerkId = await msgLookup('perk', weapon.associatedPerk, 101, true)
  weapon.ammoType = protoMsgLookup(weapon.ammoTypeId, msgOffset.caliberTypes)
  // weapon.ammoPid = await lstLookup('proto/items/items.lst', weapon.ammoPid)
  if (data.offset != 122) throw Error('data.offset != 122: '+data.offset)
  return weapon
}

function read_item_armor(data) {
  const armor = {
    armorClass: data.i32(),
    damageResistance: data.objectByKeys('i32', [
      'normal', 'laser', 'fire', 'plasma', 'electrical', 'emp', 'explosive'
    ]),
    damageThreshold: data.objectByKeys('i32', [
      'normal', 'laser', 'fire', 'plasma', 'electrical', 'emp', 'explosive'
    ]),
    perkId: data.i32(),//await msgLookup('perk', data.i32(), 101, true),
    maleFrmId: data.i32(),
    femaleFrmId: data.i32(),
  }
  if (data.offset != 129) throw Error('data.offset != 129: '+data.offset)
  return armor
}

function read_item_container(data) {
  const container = {
    storageSize: data.i32(),
    ...data.flags(4, {
      cannotPickUp: 0x01, // Cannot Pick Up (implies Magic Hands Grnd!)
      mustReachDown: 0x08 // Magic Hands Grnd (reach down to open/close)
    })
  }
  if (data.offset != 65) throw Error('data.offset != 65: '+data.offset)
  return container
}

function read_item_drug(data) {
  const drug = {
    statIdModified: data.array('i32', 3),
    instantEffect: {
      amount: data.array('i32', 3),
    },
    firstDelayedEffect: {
      duration: data.i32(),
      amount: data.array('i32', 3),
    },
    secondDelayedEffect: {
      duration: data.i32(),
      amount: data.array('i32', 3),
    },
    addiction: data.objectByKeys('i32', [
      'rate',
      'perkId',
      'onset'
    ])
  }
  // drug.addiction.perkId = await msgLookup('perk', drug.addiction.perk, 101, true)
  // for (let i=0; i<3; i++) {
  //   const stat = drug.statIdModified[i]
  //   switch (stat) {
  //     default: 
  //       drug.statIdModified[i] = await msgLookup('stat', stat, 100, true); 
  //     break
  //     case -1: drug.statIdModified[i] = 'no effect'; break
  //     case -2: drug.statIdModified[i] = 'instantEffect random between amount index 0 and 1'; break
  //   }
  // }
  if (data.offset != 125) throw Error('data.offset != 125: '+data.offset)
  return drug
}

function read_critter(data) {
  const primaryStats = [
    'strength', // (1-10)
    'perception', // (1-10)
    'endurance', // (1-10)
    'charisma', // (1-10)
    'intelligence', // (1-10)
    'agility', // (1-10)
    'luck', // (1-10)

    'hitPoints', //
    'actionPoints', //
    'armorClass', //
    'unarmedDamage_NOT_USED', // (UNUSED, use Melee damage instead)
    'meleeDamage', //
    'carryWeight', // (0-999)
    'sequence', //
    'healingRate', //
    'criticalChance', //
    'betterCriticals', // 
  ]
  const critter = {
    ...data.flags(4, {
      unknown1: 0x00002000,
      unknown2: 0x00004000,
    }),
    scriptId: data.i32(),//scrLookup(data),
    headFid: data.i32(),
    aiPacket: data.i32(),
    teamNum: data.i32(),
    flags: data.flags(4, {
      barter: 0x00000002, // (can trade with)
      steal: 0x00000020, // (cannot steal from)
      drop: 0x00000040, // (doesn't drop items) 
      limbs: 0x00000080, // (can not lose limbs) 
      ages: 0x00000100, // (dead body does not disappear) 
      heal: 0x00000200, // (damage is not cured with time) 
      invulnerable: 0x00000400, // (cannot be hurt) 
      flatten: 0x00000800, // (leaves no dead body) 
      special: 0x00001000, // (there is a special type of death) 
      range: 0x00002000, // (melee attack is possible at a distance) 
      knock: 0x00004000, // (cannot be knocked down)
    })
  }
  critter.base = {
    primaryStats: data.objectByKeys('i32', primaryStats),
    damageThreshold: data.objectByKeys('i32', damageTypes),
    damageResistance: data.objectByKeys('i32', resistanceTypes),
    age: data.i32(),
    gender: indexToString(data.i32(), ['male', 'female'])
  }
  critter.bonus = {
    primaryStats: data.objectByKeys('i32', primaryStats),
    damageThreshold: data.objectByKeys('i32', damageTypes),
    damageResistance: data.objectByKeys('i32', resistanceTypes),
    age: data.i32(),
    gender: indexToString(data.i32(), ['male', 'female'])
  }
  critter.skills = data.objectByKeys('i32', [
    'smallGuns', // all from 0-300
    'bigGuns',
    'energyWeapons',
    'unarmed',
    'melee',
    'throwing',
    'firstAid',
    'doctor',
    'sneak',
    'lockpick',
    'steal',
    'traps',
    'science',
    'repair',
    'speech',
    'barter',
    'gambling',
    'outdoorsman', 
  ])
  critter.bodyType = protoMsgLookup(data.i32(), msgOffset.bodyType)
  critter.expGain = data.i32()
  critter.killType = protoMsgLookup(data.i32(), msgOffset.killType)
  if (data.offset > data.size -4) { // critters without damageType...
    // proto/CRITTERS/00000077.pro and proto/CRITTERS/00000114.pro
    return critter
  }
  critter.damageType = damageTypes[data.i32()]//protoMsgLookup(data.i32(), msgOffset.damageTypes)
  if (data.offset != 416) throw Error('data.offset != 416: '+data.offset)
  return critter
}
