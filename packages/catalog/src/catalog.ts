// SPDX-License-Identifier: MIT
import type { Device, Parameter } from './types.js';

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Wraps a Device JSON in a lookup-friendly API. Indexes are built once on
 * construction; subsequent lookups are O(1) and allocation-free.
 *
 * When multiple parameters share a CC number or share a name (after
 * normalisation), the first occurrence wins. Use `parameters()` for an
 * unambiguous full listing.
 */
export class DeviceCatalog {
  readonly device: Device;
  private readonly byCcIndex = new Map<number, Parameter>();
  private readonly byNameIndex = new Map<string, Parameter>();

  constructor(device: Device) {
    this.device = device;
    for (const p of device.parameters) {
      if (p.cc !== null && !this.byCcIndex.has(p.cc)) {
        this.byCcIndex.set(p.cc, p);
      }
      const key = normaliseName(p.name);
      if (key.length > 0 && !this.byNameIndex.has(key)) {
        this.byNameIndex.set(key, p);
      }
    }
  }

  /** Parse a JSON string (as exported by scripts/build-catalog.mjs) into a catalog. */
  static fromJSON(json: string): DeviceCatalog {
    return new DeviceCatalog(JSON.parse(json) as Device);
  }

  /** Look up by CC number. */
  byCC(cc: number): Parameter | undefined {
    return this.byCcIndex.get(cc);
  }

  /** Look up by parameter name. Case-insensitive, whitespace-tolerant. */
  byName(name: string): Parameter | undefined {
    return this.byNameIndex.get(normaliseName(name));
  }

  /** Convenience: the CC number for a named parameter, or undefined. */
  cc(name: string): number | undefined {
    const p = this.byName(name);
    return p?.cc ?? undefined;
  }

  /** Distinct section names present in the device data, sorted. */
  sections(): string[] {
    const seen = new Set<string>();
    for (const p of this.device.parameters) {
      if (p.section !== null) seen.add(p.section);
    }
    return [...seen].sort();
  }

  /** All parameters, or only those in the given section. Returns a fresh array. */
  parameters(section?: string): Parameter[] {
    if (section === undefined) return [...this.device.parameters];
    return this.device.parameters.filter((p) => p.section === section);
  }

  /** True if at least one parameter on this device maps to `cc`. */
  isKnownCC(cc: number): boolean {
    return this.byCcIndex.has(cc);
  }

  /**
   * True if `value` is within the documented range of `cc` on this device.
   * Returns false for unknown CCs (use `isKnownCC` first if you want to
   * distinguish "unknown" from "out of range").
   */
  inRange(cc: number, value: number): boolean {
    const p = this.byCcIndex.get(cc);
    if (!p) return false;
    return value >= p.ccRange.min && value <= p.ccRange.max;
  }
}
