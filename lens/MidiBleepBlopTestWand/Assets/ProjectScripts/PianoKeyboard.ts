// SPDX-License-Identifier: MIT
// PianoKeyboard — programmatically generates a playable piano. Mesh is built in
// code (MeshBuilder). Key colors come from two materials you color in the Lens
// Studio material editor (whiteKeyMaterial / blackKeyMaterial) — no scripted
// tinting, so it doesn't depend on a shader exposing baseColor.
//
// Each key SceneObject gets:
//   - RenderMeshVisual      (procedural cube; white/black material assigned)
//   - Physics.BodyComponent (static collider for SIK hit-testing)
//   - Interactable          (press / release / cancel events)
//   - InteractableManipulation (ONLY if keysMovable = true)
//   - a child SceneObject with a 2D Text label (e.g. "C3")
//
// Press  → onTriggerStart            → sendNoteOn  + key depresses
// Release → onTriggerEnd / Canceled  → sendNoteOff + key springs back
//
// onTriggerCanceled is handled too: SIK fires it (not onTriggerEnd) when the
// interactor leaves a key mid-press. Without it, keys stick down and notes hang.
//
// Every note on/off is print()'d so the Logger shows exactly what's sent.
//
// SCENE WIRING: see docs/tester-ux.md → "PianoKeyboard wiring".

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation';
import { InteractorInputType } from 'SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor';
import { MidiClientComponent } from './MidiClientComponent';

const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function isWhite(note: number): boolean {
  return WHITE_SEMITONES.indexOf(((note % 12) + 12) % 12) >= 0;
}

// Ableton convention: MIDI 60 = C3.
function noteName(note: number): string {
  const semitone = ((note % 12) + 12) % 12;
  const octave = Math.floor(note / 12) - 2;
  return NOTE_NAMES[semitone] + String(octave);
}

function buildUnitCube(): RenderMesh {
  const builder = new MeshBuilder([
    { name: 'position', components: 3 },
    { name: 'normal', components: 3 },
    { name: 'texture0', components: 2 },
  ]);
  builder.topology = MeshTopology.Triangles;
  builder.indexType = MeshIndexType.UInt16;

  const h = 0.5;
  const faces: Array<{ n: number[]; v: number[][] }> = [
    { n: [1, 0, 0], v: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]] },
    { n: [0, 1, 0], v: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] },
    { n: [0, 0, 1], v: [[h, -h, h], [h, h, h], [-h, h, h], [-h, -h, h]] },
    { n: [0, 0, -1], v: [[-h, -h, -h], [-h, h, -h], [h, h, -h], [h, -h, -h]] },
  ];
  const uv = [[0, 0], [0, 1], [1, 1], [1, 0]];

  let vi = 0;
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    for (let c = 0; c < 4; c++) {
      builder.appendVerticesInterleaved([
        face.v[c][0], face.v[c][1], face.v[c][2],
        face.n[0], face.n[1], face.n[2],
        uv[c][0], uv[c][1],
      ]);
    }
    builder.appendIndices([vi, vi + 1, vi + 2, vi, vi + 2, vi + 3]);
    vi += 4;
  }
  builder.updateMesh();
  return builder.getMesh();
}

@component
export class PianoKeyboard extends BaseScriptComponent {
  @input
  @hint('The MidiClientComponent providing the bridge connection.')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel to send on (0-15)')
  channel: number = 0;

  @input
  @hint('Material for white keys — color it in the LS material editor. Recommended: Unlit.')
  @allowUndefined
  whiteKeyMaterial: Material | undefined;

  @input
  @hint('Material for black keys — color it (black/metallic) in the LS material editor. Recommended: Unlit.')
  @allowUndefined
  blackKeyMaterial: Material | undefined;

  @input
  @hint("Optional. SceneObject to parent keys under (e.g. a ContainerFrame's object). If empty, keys parent under this object.")
  @allowUndefined
  parentObject: SceneObject | undefined;

  @input('Asset.AudioTrackAsset')
  @hint('Optional sound played when a key is pressed')
  @allowUndefined
  keyDownAudio: AudioTrackAsset | undefined;

  @input
  @hint('Key-press sound volume, 0..1. Default 0.5 (half = softer).')
  audioVolume: number = 0.5;

  @input
  @hint('Optional font for the key labels')
  @allowUndefined
  labelFont: Font | undefined;

  @input
  @hint('Lowest MIDI note (60 = C3; for a bass synth try 36 = C1). Applied at generation — re-stage to change.')
  startNote: number = 60;

  @input
  @hint('Shift all keys by whole octaves. +1 = up an octave, -1 = down. Applied at generation — re-stage to change.')
  octaveShift: number = 0;

  @input
  @hint('Number of keys to generate (white + black)')
  keyCount: number = 13;

  // ── Optional CC setup slots ── sent once the bridge connection opens (and on
  // reconnect). Leave controller at -1 to skip a slot. Useful for initializing
  // the synth (cutoff, resonance, etc.) when the keyboard loads.
  @input @hint('CC #1 controller number (0-127). -1 = unused.') cc1Controller: number = -1;
  @input @hint('CC #1 value (0-127)') cc1Value: number = 0;
  @input @hint('CC #2 controller number (0-127). -1 = unused.') cc2Controller: number = -1;
  @input @hint('CC #2 value (0-127)') cc2Value: number = 0;
  @input @hint('CC #3 controller number (0-127). -1 = unused.') cc3Controller: number = -1;
  @input @hint('CC #3 value (0-127)') cc3Value: number = 0;
  @input @hint('CC #4 controller number (0-127). -1 = unused.') cc4Controller: number = -1;
  @input @hint('CC #4 value (0-127)') cc4Value: number = 0;

  @input
  @hint('Velocity sent on key press (1-127)')
  velocity: number = 100;

  @input whiteKeyWidth: number = 2.2;
  @input whiteKeyHeight: number = 9.0;
  @input whiteKeyDepth: number = 1.5;
  @input blackKeyWidth: number = 1.3;
  @input blackKeyHeight: number = 5.5;
  @input blackKeyDepth: number = 1.8;

  @input
  @hint('If true, adds InteractableManipulation so keys can be grabbed/moved. Default false so pressing plays cleanly.')
  keysMovable: boolean = false;

  @input
  @hint('How far a key recedes (cm, into the keyboard) while held — the visible "depress".')
  pressDepth: number = 0.6;

  @input
  @hint('Depress animation speed, 0..1 per frame (higher = snappier).')
  pressAnimFactor: number = 0.35;

  @input
  @hint('Stuck-note safety net: a held note auto-releases after this many seconds if SIK never delivers a release event. 0 disables. Raise it if you want longer intentional holds.')
  maxHoldSec: number = 5;

  @input
  @hint('Optional Text that shows currently-held note names (e.g. "C3 E3 G3"). Updates as you play.')
  @allowUndefined
  heldNotesText: Text | undefined;

  @input
  @hint('Optional Text that shows the keyboard\'s octave + range (e.g. "Octave 3  (C3–C4)"). Set at generation.')
  @allowUndefined
  octaveText: Text | undefined;

  private keys: SceneObject[] = [];
  private cubeMesh: RenderMesh | null = null;
  private sharedAudio: AudioComponent | null = null;
  private held: number[] = [];
  private setupSent = false;
  private animKeys: Array<{
    tf: Transform;
    x: number;
    y: number;
    restZ: number;
    pressed: boolean;
    interactable: Interactable;
    release: () => void;
  }> = [];

  onAwake(): void {
    print(
      '[PianoKeyboard] onAwake — midi=' +
        String(!!this.midi) +
        ' client=' +
        String(!!(this.midi && this.midi.client)),
    );
    this.generate();
  }

  private generate(): void {
    this.cubeMesh = buildUnitCube();

    print(
      '[PianoKeyboard] materials: white=' +
        String(!!this.whiteKeyMaterial) +
        ' black=' +
        String(!!this.blackKeyMaterial) +
        (this.whiteKeyMaterial && this.blackKeyMaterial ? '' : ' — wire both for colored keys'),
    );

    if (this.heldNotesText) this.heldNotesText.text = '(no notes)';

    if (this.keyDownAudio) {
      this.sharedAudio = this.getSceneObject().createComponent('Component.AudioComponent') as AudioComponent;
      this.sharedAudio.audioTrack = this.keyDownAudio;
      this.sharedAudio.volume = this.audioVolume;
    }

    const parent = this.parentObject ? this.parentObject : this.getSceneObject();

    const base = this.startNote + 12 * this.octaveShift;

    if (this.octaveText) {
      const baseOctave = Math.floor(base / 12) - 2; // Ableton: C3 = MIDI 60
      const topNote = base + this.keyCount - 1;
      this.octaveText.text =
        'Octave ' + String(baseOctave) + '  (' + noteName(base) + '–' + noteName(topNote) + ')';
    }

    let whiteCount = 0;
    for (let i = 0; i < this.keyCount; i++) {
      if (isWhite(base + i)) whiteCount++;
    }
    const totalWidth = whiteCount * this.whiteKeyWidth;
    const xOffset = -totalWidth / 2 + this.whiteKeyWidth / 2;

    let whiteIndex = 0;
    for (let i = 0; i < this.keyCount; i++) {
      const note = base + i;
      const white = isWhite(note);
      let x: number;
      if (white) {
        x = xOffset + whiteIndex * this.whiteKeyWidth;
        whiteIndex++;
      } else {
        x = xOffset + whiteIndex * this.whiteKeyWidth - this.whiteKeyWidth / 2;
      }
      this.keys.push(this.makeKey(parent, note, white, x));
    }
    print('[PianoKeyboard] generated ' + String(this.keys.length) + ' keys');

    this.createEvent('UpdateEvent').bind(() => this.animate());
  }

  private animate(): void {
    // Send the optional setup CCs once the connection is open; resend on reconnect.
    const client = this.midi ? this.midi.client : null;
    if (client && client.connected) {
      if (!this.setupSent) {
        this.sendSetupCCs(client);
        this.setupSent = true;
      }
    } else {
      this.setupSent = false;
    }

    const k = this.pressAnimFactor;
    for (let i = 0; i < this.animKeys.length; i++) {
      const a = this.animKeys[i];
      // Stuck-note reconcile: if we think the key is pressed but SIK reports no
      // triggering interactor, the release event was lost — force the release.
      // Safe: during a valid press triggeringInteractor is never None.
      if (a.pressed && a.interactable.triggeringInteractor === InteractorInputType.None) {
        a.release();
      }
      const targetZ = a.restZ - (a.pressed ? this.pressDepth : 0);
      const cur = a.tf.getLocalPosition();
      const newZ = cur.z + (targetZ - cur.z) * k;
      a.tf.setLocalPosition(new vec3(a.x, a.y, newZ));
    }
  }

  private makeKey(parent: SceneObject, note: number, white: boolean, x: number): SceneObject {
    const obj = global.scene.createSceneObject(noteName(note));
    obj.setParent(parent);

    const w = white ? this.whiteKeyWidth * 0.92 : this.blackKeyWidth;
    const ht = white ? this.whiteKeyHeight : this.blackKeyHeight;
    const d = white ? this.whiteKeyDepth : this.blackKeyDepth;
    const y = white ? 0 : (this.whiteKeyHeight - this.blackKeyHeight) / 2;
    const z = white ? 0 : this.blackKeyDepth;

    const tf = obj.getTransform();
    tf.setLocalPosition(new vec3(x, y, z));
    tf.setLocalScale(new vec3(w, ht, d));

    const rmv = obj.createComponent('Component.RenderMeshVisual') as RenderMeshVisual;
    rmv.mesh = this.cubeMesh!;
    const src = white ? this.whiteKeyMaterial : this.blackKeyMaterial;
    if (src) rmv.mainMaterial = src;

    const body = obj.createComponent('Physics.BodyComponent') as BodyComponent;
    body.dynamic = false;

    const interactable = obj.createComponent(Interactable.getTypeName()) as Interactable;

    if (this.keysMovable) {
      obj.createComponent(InteractableManipulation.getTypeName());
    }

    // 2D Text label as a child, on the key face toward the wearer.
    const labelObj = global.scene.createSceneObject(noteName(note) + '_label');
    labelObj.setParent(obj);
    const labelTf = labelObj.getTransform();
    labelTf.setLocalPosition(new vec3(0, -0.35, 0.6));
    labelTf.setLocalScale(new vec3(1 / w, 1 / ht, 1 / d));
    const text = labelObj.createComponent('Component.Text') as Text;
    text.text = noteName(note);
    if (this.labelFont) text.font = this.labelFont;
    text.size = 24;
    text.textFill.color = white ? new vec4(0.1, 0.1, 0.1, 1) : new vec4(0.95, 0.95, 0.95, 1);

    const anim = { tf, x, y, restZ: z, pressed: false, interactable, release: (): void => {} };

    // One reusable backstop timer per key — reset on press, cancelled on release.
    const holdTimer = this.createEvent('DelayedCallbackEvent');
    holdTimer.bind(() => {
      if (!anim.pressed) return;
      print('[PianoKeyboard] auto-release (max hold) ' + noteName(note));
      release();
    });

    const press = (): void => {
      if (anim.pressed) return; // guard double-trigger
      anim.pressed = true;
      if (this.sharedAudio) this.sharedAudio.play(1);
      const client = this.midi ? this.midi.client : null;
      if (client) client.sendNoteOn(this.channel, note, this.velocity);
      print(
        '[PianoKeyboard] noteOn  ' +
          noteName(note) +
          ' (' +
          String(note) +
          ') ch' +
          String(this.channel) +
          ' vel' +
          String(this.velocity),
      );
      this.addHeld(note);
      if (this.maxHoldSec > 0) holdTimer.reset(this.maxHoldSec);
    };

    const release = (): void => {
      if (!anim.pressed) return; // idempotent: end + cancel + reconcile + timeout may all race
      anim.pressed = false;
      holdTimer.cancel();
      const client = this.midi ? this.midi.client : null;
      if (client) client.sendNoteOff(this.channel, note);
      print('[PianoKeyboard] noteOff ' + noteName(note) + ' (' + String(note) + ')');
      this.removeHeld(note);
    };
    anim.release = release;
    this.animKeys.push(anim);

    interactable.onTriggerStart.add(press);
    interactable.onTriggerEnd.add(release);
    interactable.onTriggerCanceled.add(release);

    return obj;
  }

  private addHeld(note: number): void {
    if (this.held.indexOf(note) < 0) this.held.push(note);
    this.refreshNotesDisplay();
  }

  private removeHeld(note: number): void {
    const i = this.held.indexOf(note);
    if (i >= 0) this.held.splice(i, 1);
    this.refreshNotesDisplay();
  }

  private sendSetupCCs(client: { sendCC: (ch: number, cc: number, v: number) => void }): void {
    const slots: Array<[number, number]> = [
      [this.cc1Controller, this.cc1Value],
      [this.cc2Controller, this.cc2Value],
      [this.cc3Controller, this.cc3Value],
      [this.cc4Controller, this.cc4Value],
    ];
    for (let i = 0; i < slots.length; i++) {
      const ctrl = slots[i][0];
      const val = slots[i][1];
      if (ctrl >= 0 && ctrl <= 127) {
        client.sendCC(this.channel, ctrl, val);
        print('[PianoKeyboard] setup CC ' + String(ctrl) + '=' + String(val) + ' ch' + String(this.channel));
      }
    }
  }

  private refreshNotesDisplay(): void {
    if (!this.heldNotesText) return;
    if (this.held.length === 0) {
      this.heldNotesText.text = '(no notes)';
      return;
    }
    const sorted = this.held.slice().sort((a, b) => a - b);
    this.heldNotesText.text = sorted.map((n) => noteName(n)).join('  ');
  }
}
