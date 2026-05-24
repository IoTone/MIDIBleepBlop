const noble = require("noble-mac");

const MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const MIDI_CHAR = "7772e5db-3868-4112-a1a9-f2669d106bf3";

// ─────────────────────────────────────────────
// BLE‑MIDI timestamp (single‑byte, spec‑legal)
// ─────────────────────────────────────────────
const startTime = process.hrtime.bigint();

function bleTimestamp() {
  const now = process.hrtime.bigint();
  const ms = Number(now - startTime) / 1e6;
  const ticks = Math.floor((ms * 1024) / 1000) & 0x7f;
  return 0x80 | ticks;
}

// IMPORTANT: status byte must immediately follow timestamp
/*
function makePacket(status, data1, data2) {
  return Buffer.from([bleTimestamp(), status, data1, data2]);
}
*/

function makePacket(status, data1, data2) {
  const now = process.hrtime.bigint();
  const ms = Number(now - startTime) / 1e6;
  const ts = Math.floor((ms * 1024) / 1000) & 0x1fff;

  const tHi = 0x80 | ((ts >> 7) & 0x3f);
  const tLo = 0x80 | (ts & 0x7f);

  return Buffer.from([tHi, tLo, status, data1, data2]);
}

let midiChar = null;

// ─────────────────────────────────────────────
// BLE lifecycle
// ─────────────────────────────────────────────
noble.on("stateChange", (state) => {
  console.log("Bluetooth state:", state);
  if (state === "poweredOn") {
    console.log("Scanning for BLE‑MIDI devices…");
    noble.startScanning([MIDI_SERVICE], false);
  }
});

noble.on("discover", (p) => {
  console.log("Found:", p.advertisement.localName);
  noble.stopScanning();

  p.on("disconnect", () => {
    console.log("❌ Disconnected");
    process.exit(0);
  });

  setTimeout(() => {
    p.connect(() => {
      console.log("Connected");

      p.discoverSomeServicesAndCharacteristics(
        [MIDI_SERVICE],
        [MIDI_CHAR],
        (err, services, characteristics) => {
          if (err || !characteristics.length) {
            console.error("Discovery failed");
            return;
          }

          midiChar = characteristics[0];
          console.log("MIDI characteristic ready");

          midiChar.on("data", (data) => {
            console.log(
              "⬅️ IN:",
              [...data].map((b) => b.toString(16).padStart(2, "0")).join(" "),
            );
          });

          midiChar.subscribe(() => {
            console.log("Subscribed");

            // ─────────────────────────────────────
            // ABSOLUTE MINIMUM NOTE TEST
            // Channel 1, C3 (48), velocity 100
            // ─────────────────────────────────────
            setInterval(() => {
              sendNoteOn(48, 75, 1);
            }, 2000);

            setTimeout(() => {
              sendNoteOff(48, 1);
            }, 1000);
          });
        },
      );
    });
  }, 300);
});

// ─────────────────────────────────────────────
// MIDI send helpers (NO callbacks)
// ─────────────────────────────────────────────
/*
function sendNoteOn(note, velocity) {
  const packet = makePacket(0x90, note, velocity);
  logWrite(packet);
  midiChar.write(packet, true);
}
*/

function sendNoteOn(note, velocity, channel = 1) {
  const status = 0x90 | (channel - 1);
  const packet = makePacket(status, note, velocity);
  logWrite(packet);
  midiChar.write(packet, true);
}

function sendNoteOff(note, channel = 1) {
  const status = 0x80 | (channel - 1);
  const packet = makePacket(status, note, 0);
  logWrite(packet);
  midiChar.write(packet, true);
}

/*
function sendNoteOff(note) {
  const packet = makePacket(0x80, note, 0);
  logWrite(packet);
  midiChar.write(packet, true);
}
*/

function logWrite(packet) {
  console.log(
    "➡️ OUT:",
    [...packet].map((b) => b.toString(16).padStart(2, "0")).join(" "),
  );
}
