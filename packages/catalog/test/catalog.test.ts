import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DeviceCatalog, type Device } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const devicesDir = join(here, '..', 'devices');

function loadDevice(filename: string): Device {
  return JSON.parse(readFileSync(join(devicesDir, filename), 'utf8')) as Device;
}

describe('DeviceCatalog — construction', () => {
  it('accepts an already-parsed Device object', () => {
    const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));
    expect(c.device.manufacturer).toBe('KORG');
    expect(c.device.slug).toBe('korg-volca-bass');
    expect(c.device.parameters.length).toBe(12);
  });

  it('fromJSON parses a JSON string', () => {
    const json = readFileSync(join(devicesDir, 'KORG-Volca-Bass.json'), 'utf8');
    const c = DeviceCatalog.fromJSON(json);
    expect(c.device.device).toBe('volca bass');
    expect(c.device.parameters.length).toBe(12);
  });
});

describe('DeviceCatalog — byCC', () => {
  const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));

  it('returns the parameter for a known CC', () => {
    const p = c.byCC(43);
    expect(p?.name).toBe('VCO pitch 1');
    expect(p?.section).toBe('General');
  });

  it('returns undefined for unknown CCs', () => {
    expect(c.byCC(99)).toBeUndefined();
    expect(c.byCC(0)).toBeUndefined();
  });
});

describe('DeviceCatalog — byName / cc()', () => {
  const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));

  it('finds exact-case matches', () => {
    expect(c.byName('VCO pitch 1')?.cc).toBe(43);
  });

  it('is case-insensitive', () => {
    expect(c.byName('vco pitch 1')?.cc).toBe(43);
    expect(c.byName('VCO PITCH 1')?.cc).toBe(43);
  });

  it('is whitespace-tolerant', () => {
    expect(c.byName('  VCO   pitch    1  ')?.cc).toBe(43);
  });

  it('returns undefined for unknown names', () => {
    expect(c.byName('Filter Cutoff')).toBeUndefined();
  });

  it('cc() is a shortcut for byName(name).cc', () => {
    expect(c.cc('LFO rate')).toBe(41);
    expect(c.cc('lfo rate')).toBe(41);
    expect(c.cc('nope')).toBeUndefined();
  });
});

describe('DeviceCatalog — sections + parameters', () => {
  it('lists distinct sections, sorted, for a single-section device', () => {
    const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));
    expect(c.sections()).toEqual(['General']);
  });

  it('lists distinct sections for a multi-section device', () => {
    const c = new DeviceCatalog(loadDevice('KORG-Volca-Drum.json'));
    const sections = c.sections();
    expect(sections).toContain('General');
    expect(sections).toContain('Envelope generator');
    expect(sections).toContain('Mod');
    // sorted alphabetically
    expect([...sections]).toEqual([...sections].sort());
  });

  it('parameters() returns all when no section given', () => {
    const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));
    expect(c.parameters().length).toBe(12);
  });

  it('parameters(section) filters', () => {
    const c = new DeviceCatalog(loadDevice('KORG-Volca-Drum.json'));
    const mod = c.parameters('Mod');
    expect(mod.length).toBeGreaterThan(0);
    expect(mod.every((p) => p.section === 'Mod')).toBe(true);
  });

  it('parameters() returns a fresh array (mutations do not leak)', () => {
    const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));
    const arr = c.parameters();
    arr.length = 0;
    expect(c.parameters().length).toBe(12);
  });
});

describe('DeviceCatalog — validation helpers', () => {
  const c = new DeviceCatalog(loadDevice('KORG-Volca-Bass.json'));

  it('isKnownCC reports membership', () => {
    expect(c.isKnownCC(43)).toBe(true);
    expect(c.isKnownCC(99)).toBe(false);
  });

  it('inRange checks the documented bounds', () => {
    expect(c.inRange(43, 0)).toBe(true);
    expect(c.inRange(43, 64)).toBe(true);
    expect(c.inRange(43, 127)).toBe(true);
    expect(c.inRange(43, -1)).toBe(false);
    expect(c.inRange(43, 128)).toBe(false);
  });

  it('inRange returns false for unknown CCs', () => {
    expect(c.inRange(99, 50)).toBe(false);
  });
});

describe('DeviceCatalog — works across the whole Volca line', () => {
  const allFiles = [
    'KORG-Volca-Bass.json',
    'KORG-Volca-Beats.json',
    'KORG-Volca-Drum.json',
    'KORG-Volca-Fm.json',
    'KORG-Volca-Keys.json',
    'KORG-Volca-Kick.json',
    'KORG-Volca-Nubass.json',
    'KORG-Volca-Sample.json',
  ];

  it.each(allFiles)('loads %s and indexes every CC-mapped parameter', (filename) => {
    const c = new DeviceCatalog(loadDevice(filename));
    expect(c.device.parameters.length).toBeGreaterThan(0);
    for (const p of c.device.parameters) {
      if (p.cc !== null) {
        // Every parameter with a CC should be discoverable by that CC
        // (unless it collides with an earlier one, in which case at least the
        // earlier param is reachable).
        expect(c.byCC(p.cc)).toBeDefined();
        expect(c.isKnownCC(p.cc)).toBe(true);
      }
      // Every parameter should be discoverable by its name
      expect(c.byName(p.name)?.name.toLowerCase()).toBe(p.name.toLowerCase());
    }
  });
});
