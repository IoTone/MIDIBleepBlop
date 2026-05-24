const JZZ = require("jzz");

const info = JZZ().info();
const out = info.outputs.find((o) => o.name === "WIDI Master Bluetooth");

if (!out) {
  console.error("BLE MIDI output not found");
  process.exit(1);
}

JZZ()
  .openMidiOut(out.name)
  .then((port) => {
    console.log("Connected to BLE MIDI");

    setInterval(() => {
      port.noteOn(1, 48, 100);
      setTimeout(() => port.noteOff(1, 48), 300);
    }, 1000);
  });
