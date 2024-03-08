/*
Notes:
in critter.lst multiple have lines like `hapowr,11,1` with 11 as the `CALLED_SHOT_PIC`/`aimedShotFile`. This because 11 points to hmjmps which stores the CALLED_SHOT_PIC for every human male as hmjmpsNA. E.g. hapowr does not have hapowrNA. Every critter MUST have a CALLED_SHOT_PIC. If ,1 after this, then it means it has a run animation (AT). .FR0 to .FR5 is orientation, if just one or all then .FRM
// https://fodev.net/files/fo2/anim_names.html
// https://fallout.fandom.com/wiki/Animation_frames (with pictures)
// https://falloutmods.fandom.com/wiki/File_Identifiers_in_Fallout
// see https://fallout.fandom.com/wiki/Animation_frames
// https://falloutmods.fandom.com/wiki/Critter_FRM_nomenclature_(naming_system)
HM Human male
HF Human female
  JMPS V13 jumpsuit
  CMBT Combat armor
  METL Metal armor
  LTHR Leather armor
  MAXX Mad Max jacket
  ROBE Robe
  POWR Power armor
  NPWR Power armor (nuclear powered)

*/
import {readBitField} from './misc/dataReaders.js'

export function findCritterFrm(id, altId, orientation) {
  for (const file of [
    id+'.fr'+orientation, 
    id+'.frm', 
    altId+'.fr'+orientation, 
    altId+'.frm', 
  ]) {
    if (globalThis.critterArt.has(file)) return 'art/critters/'+file
  }
  throw Error('No such entry: '+path)
}

export function frmCritterId(data) {
  if (!globalThis.critterArt) throw Error('Missing falloutArchive for frmCritterId to work.')
  const template = { // (MSB to LSB)
    reserved: 1, // always 0
    orientationId: 3, // and downwards doubles as the type (map files doesn't set the orientation bits)
    type: 4,
    animationId: 8, // and downwards doubles as the ID
    weaponId: 4,
    critterId: 12
  }
  const info = (typeof data != 'number') ?
    data.bitField(4, template) : readBitField(template, BigInt(data))
  if (info.type != 1) throw Error("type != 'critters'")
  return getCritterFrm(info)
}

export function getCritterFrm({critterId, animationId, weaponId, orientationId}) {
  if (!globalThis.frmLists) throw Error('Missing globalThis.frmLists for getCritterFrm to work.')
  const weapon = idToWeaponMap.get(weaponId)
  const animation = idToAnimationMap.get(animationId)
  if (!weapon) throw Error('Invalid weaponId: '+weaponId)
  if (!animation) throw Error('Invalid animationId: '+animationId)
  const hasWeaponVersions = animation.code.length == 1
  // const {critter, missingImgAlt, canRun} = frmId({type: 1, id: critterId})
  const {critter, missingImgAlt, canRun} = (() => {
    const list = globalThis.frmLists.get('art/critters/critters.lst', {useCache: true})
    const [critter, missingImgAltId, canRun] = list[critterId].split(',')
    return {
      critter,
      canRun: !!canRun,
      missingImgAlt: list[missingImgAltId].split(',')[0]
    }
  })()
  let frmName = critter, frmNameAlt = missingImgAlt
  // todo: rework to support knife throw
  if ((weaponId == 0 && animationId <= 1) || (weaponId > 0 && hasWeaponVersions)) {
    frmName    += weapon.code
    frmNameAlt += weapon.code
  } else if ((weaponId == 0 && hasWeaponVersions) || (weaponId > 0)) {
    throw Error(`weaponId (${weapon.title}) with unsupported animationId (${animation.title})`)
  }
  frmName    += animation.code
  frmNameAlt += animation.code // alt is used for aimed shot img and animations that would be duplicates (e.g. some death animations), since not every critter need their own version of everything.
  // todo: but this might allow to animate ones with missing animation using the wrong imgs? (yeah, only if we try I guess)
  return {
    id: critterId, // id in list
    type: 'critters',
    critter,
    canRun,
    weaponId,
    animationId,
    orientationId,
    path: findCritterFrm(frmName, frmNameAlt, orientationId)
  }
}

export const ANIMATION = { // title: [id, code]
  IDLE: [0, 'a'], // standing still is the first frame
  WALK: [1, 'b'], 
  CLIMB_LADDER: [4, 'ae'], 
  GRAB_GROUND: [10, 'ak'], 
  GRAB_MIDDLE: [11, 'al'], 
  DODGE: [13, 'an'], // (unarmed fight)
  HIT_FROM_FRONT: [14, 'ao'], // (unarmed fight)
  HIT_FROM_BACK: [15, 'ap'], // (unarmed fight)
  THROW_PUNCH: [16, 'aq'], // (unarmed fight)
  KICK_LEG: [17, 'ar'], // (unarmed fight)
  THROW: [18, 'as'], // (KNIFE throw is DM)
  RUNNING: [19, 'at'], // (CAN'T DO WITH WEAPON)

  FALL_BACK: [20, 'ba'], 
  FALL_FRONT: [21, 'bb'], 
  BAD_LANDING: [22, 'bc'], // (only HFCMBT)
  BIG_HOLE: [23, 'bd'], 
  CHARRED_BODY: [24, 'be'], 
  CHUNKS_OF_FLESH: [25, 'bf'], 
  DANCING_AUTOFIRE: [26, 'bg'], 
  ELECTRIFY: [27, 'bh'], 
  SLICED_IN_HALF: [28, 'bi'], 
  BURNED_TO_NOTHING: [29, 'bj'], 
  ELECTRIFIED_TO_NOTHING: [30, 'bk'], 
  EXPLODED_TO_NOTHING: [31, 'bl'], 
  MELTED_TO_NOTHING: [32, 'bm'], 
  FIRE_DANCE: [33, 'bn'], 
  FALL_BACK_BLOOD: [34, 'bo'], 
  FALL_FRONT_BLOOD: [35, 'bp'], 

  PRONE_TO_STANDING: [36, 'ch'], 
  BACK_TO_STANDING: [37, 'cj'], 

  TAKE_OUT: [38, 'c'], 
  PUT_AWAY: [39, 'd'], 
  PARRY: [40, 'e'], // (dodge with weapon)
  THRUST: [41, 'f'], // (only melee)
  SWING: [42, 'g'],  // (only melee)
  POINT: [43, 'h'],  // (not melee)
  UNPOINT: [44, 'i'],  // (not melee)
  FIRE_SINGLE: [45, 'j'], // (not melee)
  FIRE_BURST: [46, 'k'], // (not melee)
  FIRE_CONTINUOUS: [47, 'l'], // (only (K) flamethrower)

  // Single Frame, the last frame of death animation (but as separate files)
  FALL_BACK_SF: [48, 'ra'], 
  FALL_FRONT_SF: [49, 'rb'], 
  BAD_LANDING_SF: [50, 'rc'], // (only HFCMBT)
  BIG_HOLE_SF: [51, 'rd'], 
  CHARRED_BODY_SF: [52, 're'], 
  CHUNKS_OF_FLESH_SF: [53, 'rf'], 
  DANCING_AUTOFIRE_SF: [54, 'rg'], 
  ELECTRIFY_SF: [55, 'rh'], 
  SLICED_IN_HALF_SF: [56, 'ri'], 
  BURNED_TO_NOTHING_SF: [57, 'rj'], // also for FIRE_DANCE_SF
  ELECTRIFIED_TO_NOTHING_SF: [58, 'rk'], 
  EXPLODED_TO_NOTHING_SF: [59, 'rl'], 
  MELTED_TO_NOTHING_SF: [60, 'rm'], 
  FALL_BACK_BLOOD_SF: [62, 'ro'], 
  FALL_FRONT_BLOOD_SF: [63, 'rp'], 

  CALLED_SHOT_PIC: [64, 'na'],
}

export const WEAPON = { // title: [id, code]
  UNARMED: [0, 'a'], 
  KNIFE:   [1, 'd'], 
  BATON:   [2, 'e'], 
  SLEDGE:  [3, 'f'], 
  SPEAR:   [4, 'g'], 
  PISTOL:  [5, 'h'], 
  SMG:     [6, 'i'], 
  RIFLE:   [7, 'j'], // shotgun
  BIG_GUN: [8, 'k'], // laser / flamethrower (KL)
  MINIGUN: [9, 'l'], 
  BAZOOKA: [10, 'm'],
}

export const idToAnimationMap = new Map(
  Object.entries(ANIMATION).map(([title, [id, code]]) => [id, {title, code}])
)

export const idToWeaponMap = new Map(
  Object.entries(WEAPON).map(([title, [id, code]]) => [id, {title, code}])
)

// const NUM_TO_ANIM_MAP = (() => {
//   const map = new Map()
//   for (let i=0; i<ID_TO_ANIM.length; i++) {
//     map.set(i, ID_TO_ANIM[i])
//   }
//   return map
// })()
// ANIM.FIRST_KNOCKDOWN_AND_DEATH = ANIM.FALL_BACK
// ANIM.LAST_KNOCKDOWN_AND_DEATH  = ANIM.FALL_FRONT_BLOOD
// ANIM.FIRST_SF_DEATH            = ANIM.FALL_BACK_SF
// ANIM.LAST_SF_DEATH             = ANIM.FALL_FRONT_BLOOD_SF













