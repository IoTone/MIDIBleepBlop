// BleMidi.ts

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

@component
export class BleMidi extends BaseScriptComponent {
    @input
    @hint("Bluetooth Central Module for BLE-MIDI")
    bluetoothModule: Bluetooth.BluetoothCentralModule | null;

    @input
    @hint("The SceneObject to control with BLE-MIDI (e.g., Cube or Quad)")
    public targetObject!: SceneObject;

    private midiDataEvent: Event | null = null;

    get startScan() {
        return this.startScanEvent.publicApi();
    }
    get scanResult() {
        return this.scanResultEvent.publicApi();
    }
    get stopScan(){
        return this.stopScanEvent.publicApi();
    }

    private startScanEvent: Event = new Event();
    private scanResultEvent: Event<any> = new Event();
    private stopScanEvent: Event = new Event();

    // Note: these are type Bluetooth.ScanResult, not type ScanResult
    private allScanSessionBluetoothScanResults: Bluetooth.ScanResult[];

    private isScanning: boolean;
    
    onAwake() {
        // Validate inputs
        if (!this.targetObject) {
            print("Error: Target Object not assigned");
            return;
        }

        if (!this.bluetoothModule) {
            print("Error: BluetoothCentralModule not assigned");
            return;
        }


        // Start scanning for BLE-MIDI devices
        // this.onStartScan();
    }

    /*
    private handleMidiData(data: any) {
        if (!this.targetObject || !this.midiDataEvent) return;

        // Parse MIDI message (assuming data is a MidiMessage-like structure)
        const message = data as { status: number; data1: number; data2: number };
        if (message.status === 0x90 && message.data2 > 0) { // Note On
            const transform = this.targetObject.getTransform();
            // Map MIDI note (data1) and velocity (data2) to X/Y position
            const newPos = new vec3(
                (message.data1 / 127) * 4 - 2, // X: -2 to 2
                (message.data2 / 127) * 4 - 2, // Y: -2 to 2
                transform.getWorldPosition().z  // Keep Z
            );
            transform.setWorldPosition(newPos);

            // Trigger MIDI data event
            this.midiDataEvent.trigger();

            // Log details with explicit formatting
            print(`MIDI Note On: Note=${message.data1}, Velocity=${message.data2}, Position=(${newPos.x.toFixed(2)}, ${newPos.y.toFixed(2)}, ${newPos.z.toFixed(2)})`);
        }
    }
    */

    onDestroy() {
        if (this.bluetoothModule) {
            // this.stopScan();
            // this.bluetoothModule.disconnect();
        }
    }
}