// PianoKeyboard — programmatically generates a playable piano with minimal
// scene wiring. Mesh is built in code (MeshBuilder); per-key materials are
// cloned + tinted from one optional base material; visual + audio feedback are
// implemented directly off the Interactable's events. The ONLY required wiring
// is `midi`.
//
// Why not InteractableOutlineFeedback / InteractableAudioFeedback?
//   Those SIK components validate their required @inputs *synchronously inside*
//   createComponent (a `checkUndefined` in their generated awake). There's no
//   way to pass inputs to a runtime-created component, so they throw
//   ("Input meshVisuals was not provided") before we can assign anything. We
//   therefore implement equivalent feedback ourselves:
//     - press/hover highlight → swap the key material's baseColor
//     - key-down sound        → a plain AudioComponent
//
// Each key SceneObject gets:
//   - RenderMeshVisual      (procedural cube, per-key tinted material)
//   - Physics.BodyComponent (static collider for SIK hit-testing)
//   - Interactable          (press/release + hover events)
//   - InteractableManipulation (ONLY if keysMovable = true)
//   - a child SceneObject with a 2D Text label (e.g. "C3")
//
// Press  → onTriggerStart → MidiClient.sendNoteOn  (+ highlight + sound)
// Release → onTriggerEnd  → MidiClient.sendNoteOff (+ restore)
//
// SCENE WIRING: see docs/tester-ux.md → "PianoKeyboard wiring".

import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable';
import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation';
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

function lerp4(a: vec4, b: vec4, t: number): vec4 {
  return new vec4(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, a.w + (b.w - a.w) * t);
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
  @hint('The MidiClientComponent providing the bridge connection. (Only required input.)')
  midi!: MidiClientComponent;

  @input
  @hint('MIDI channel to send on (0-15)')
  channel: number = 0;

  @input
  @hint('Optional. A material cloned + tinted per key. If empty, keys use the default material (color feedback may not apply). Recommended: wire any Unlit or PBR material.')
  @allowUndefined
  keyMaterial: Material | undefined;

  @input('vec4', '{0.95, 0.95, 0.95, 1.0}')
  @hint('White-key color')
  whiteColor: vec4 = new vec4(0.95, 0.95, 0.95, 1.0);

  @input('vec4', '{0.08, 0.08, 0.08, 1.0}')
  @hint('Black-key color')
  blackColor: vec4 = new vec4(0.08, 0.08, 0.08, 1.0);

  @input('vec4', '{0.25, 0.6, 1.0, 1.0}')
  @hint('Color a key flashes to while pressed')
  pressColor: vec4 = new vec4(0.25, 0.6, 1.0, 1.0);

  @input
  @hint("Optional. SceneObject to parent keys under (e.g. a ContainerFrame's object). Grab it to move the whole keyboard. If empty, keys parent under this object.")
  @allowUndefined
  parentObject: SceneObject | undefined;

  @input('Asset.AudioTrackAsset')
  @hint('Optional sound played when a key is pressed')
  @allowUndefined
  keyDownAudio: AudioTrackAsset | undefined;

  @input
  @hint('Optional font for the key labels')
  @allowUndefined
  labelFont: Font | undefined;

  @input
  @hint('Lowest MIDI note (60 = C3)')
  startNote: number = 60;

  @input
  @hint('Number of keys to generate (white + black)')
  keyCount: number = 13;

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

  private keys: SceneObject[] = [];
  private cubeMesh: RenderMesh | null = null;
  private sharedAudio: AudioComponent | null = null;

  onAwake(): void {
    print(
      '[PianoKeyboard] onAwake — midi wired=' +
        String(!!this.midi) +
        ' client=' +
        String(!!(this.midi && this.midi.client)),
    );
    this.generate();
  }

  private generate(): void {
    this.cubeMesh = buildUnitCube();

    if (this.keyDownAudio) {
      this.sharedAudio = this.getSceneObject().createComponent('Component.AudioComponent') as AudioComponent;
      this.sharedAudio.audioTrack = this.keyDownAudio;
    }

    const parent = this.parentObject ? this.parentObject : this.getSceneObject();

    let whiteCount = 0;
    for (let i = 0; i < this.keyCount; i++) {
      if (isWhite(this.startNote + i)) whiteCount++;
    }
    const totalWidth = whiteCount * this.whiteKeyWidth;
    const xOffset = -totalWidth / 2 + this.whiteKeyWidth / 2;

    let whiteIndex = 0;
    for (let i = 0; i < this.keyCount; i++) {
      const note = this.startNote + i;
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

    // Per-key material clone so each key can highlight independently.
    const restColor = white ? this.whiteColor : this.blackColor;
    const hoverColor = lerp4(restColor, this.pressColor, 0.4);
    let keyMat: Material | null = null;
    if (this.keyMaterial) {
      keyMat = this.keyMaterial.clone();
      this.setColor(keyMat, restColor);
      rmv.mainMaterial = keyMat;
    }
    const applyColor = (c: vec4): void => {
      if (keyMat) this.setColor(keyMat, c);
    };

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

    // Feedback + MIDI off the Interactable events.
    let pressed = false;
    interactable.onInteractorHoverEnter.add(() => {
      if (!pressed) applyColor(hoverColor);
    });
    interactable.onInteractorHoverExit.add(() => {
      if (!pressed) applyColor(restColor);
    });
    interactable.onTriggerStart.add(() => {
      pressed = true;
      applyColor(this.pressColor);
      if (this.sharedAudio) this.sharedAudio.play(1);
      const client = this.midi ? this.midi.client : null;
      print(
        '[PianoKeyboard] press note=' +
          String(note) +
          ' client=' +
          String(!!client) +
          ' state=' +
          (client ? client.state : 'none'),
      );
      if (client) client.sendNoteOn(this.channel, note, this.velocity);
    });
    interactable.onTriggerEnd.add(() => {
      pressed = false;
      applyColor(restColor);
      const client = this.midi ? this.midi.client : null;
      if (client) client.sendNoteOff(this.channel, note);
    });

    return obj;
  }

  private setColor(mat: Material, color: vec4): void {
    const pass = mat.mainPass as unknown as { baseColor?: vec4 };
    if (pass && pass.baseColor !== undefined) pass.baseColor = color;
  }
}
