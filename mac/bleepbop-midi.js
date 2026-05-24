const midi = require("midi");

const output = new midi.Output();

// Find the BLE‑MIDI device
let blePort = -1;
for (let i = 0; i < output.getPortCount(); i++) {
  const name = output.getPortName(i);
  console.log(`Found MIDI output ${i}: ${name}`);
  if (name.includes("WIDI")) {
    blePort = i;
  }
}

if (blePort === -1) {
  console.error("❌ BLE‑MIDI device not found");
  process.exit(1);
}

// Open BLE‑MIDI device directly
output.openPort(blePort);
console.log("✅ Connected directly to BLE‑MIDI device");

// Send a test note
function noteOn(note, velocity = 100, channel = 1) {
  output.sendMessage([0x90 | (channel - 1), note, velocity]);
}

function noteOff(note, channel = 1) {
  output.sendMessage([0x80 | (channel - 1), note, 0]);
}

setInterval(() => {
  noteOn(48);
  setTimeout(() => noteOff(48), 300);
}, 1000);
