// Named constants for the most common MIDI Control Change numbers.
// See General MIDI / MIDI 1.0 spec for the full list (0-127); this object
// covers the controllers that turn up in typical hardware + DAW workflows.

export const CC = {
  // Bank select + general
  BANK_SELECT_MSB: 0,
  MOD_WHEEL: 1,
  BREATH: 2,
  FOOT: 4,
  PORTAMENTO_TIME: 5,
  DATA_ENTRY_MSB: 6,
  VOLUME: 7,
  BALANCE: 8,
  PAN: 10,
  EXPRESSION: 11,
  EFFECT_1: 12,
  EFFECT_2: 13,

  // General purpose controllers — common assignment targets
  GENERAL_PURPOSE_1: 16,
  GENERAL_PURPOSE_2: 17,
  GENERAL_PURPOSE_3: 18,
  GENERAL_PURPOSE_4: 19,

  // LSB pairs for the MSB values above (32-63)
  BANK_SELECT_LSB: 32,
  MOD_WHEEL_LSB: 33,
  BREATH_LSB: 34,
  VOLUME_LSB: 39,
  EXPRESSION_LSB: 43,

  // Pedals + switches
  SUSTAIN_PEDAL: 64,
  PORTAMENTO: 65,
  SOSTENUTO: 66,
  SOFT_PEDAL: 67,
  LEGATO: 68,
  HOLD_2: 69,

  // Sound controllers — synth parameters, common targets for assignment
  SOUND_VARIATION: 70,
  RESONANCE: 71,
  RELEASE_TIME: 72,
  ATTACK_TIME: 73,
  FILTER_CUTOFF: 74,
  SOUND_CONTROLLER_6: 75,
  SOUND_CONTROLLER_7: 76,
  SOUND_CONTROLLER_8: 77,
  SOUND_CONTROLLER_9: 78,
  SOUND_CONTROLLER_10: 79,

  // Effects depth
  REVERB_DEPTH: 91,
  TREMOLO_DEPTH: 92,
  CHORUS_DEPTH: 93,
  DETUNE_DEPTH: 94,
  PHASER_DEPTH: 95,

  // Channel mode messages (these are CC numbers but with special meanings)
  ALL_SOUND_OFF: 120,
  RESET_ALL_CONTROLLERS: 121,
  LOCAL_CONTROL: 122,
  ALL_NOTES_OFF: 123,
  OMNI_MODE_OFF: 124,
  OMNI_MODE_ON: 125,
  MONO_MODE_ON: 126,
  POLY_MODE_ON: 127,
} as const;

export type CCName = keyof typeof CC;
export type CCNumber = (typeof CC)[CCName];
