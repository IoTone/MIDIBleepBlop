// SPDX-License-Identifier: MIT
// DeviceCatalogComponent — wraps a Device entry from the generated DEVICES map
// (Devices.ts) and exposes it as a DeviceCatalog usable by other components.
//
// Lens Studio has no Asset.TextAsset / Asset.JsonAsset that a script can read
// at runtime, so the catalog data is bundled into the lens as TypeScript via
// the auto-generated Devices.ts. Pick a device by setting `deviceSlug` in the
// inspector (e.g. "korg-volca-bass").
//
// To add a device not in the bundled DEVICES map, regenerate Devices.ts after
// vendoring the upstream CSV (see scripts/build-catalog.mjs).

import { DeviceCatalog } from './MidiBleepBop';
import { DEVICES, DEVICE_SLUGS } from './Devices';

@component
export class DeviceCatalogComponent extends BaseScriptComponent {
  @input
  @hint('Device slug. Available slugs are listed in Devices.ts (DEVICE_SLUGS). E.g. "korg-volca-bass".')
  deviceSlug: string = 'korg-volca-bass';

  /** Populated on awake; null if `deviceSlug` doesn't match any bundled device. */
  catalog: DeviceCatalog | null = null;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  private start(): void {
    const data = DEVICES[this.deviceSlug];
    if (!data) {
      print(
        '[DeviceCatalogComponent] no device for slug "' +
          this.deviceSlug +
          '". Available: ' +
          DEVICE_SLUGS.join(', '),
      );
      return;
    }
    this.catalog = new DeviceCatalog(data);
    print(
      '[DeviceCatalogComponent] loaded ' +
        data.manufacturer +
        ' ' +
        data.device +
        ' (' +
        String(data.parameters.length) +
        ' parameters)',
    );
  }
}
