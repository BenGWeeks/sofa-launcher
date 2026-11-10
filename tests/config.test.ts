import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_BUTTONS, parseConfig, SEED_CONFIG } from '../src/main/config';
import { BACKGROUND_IDS } from '../src/shared/backgrounds';

describe('parseConfig', () => {
  it('parses the seed config into ten apps in order', () => {
    const c = parseConfig(SEED_CONFIG);
    expect(c.apps.map((a) => a.id)).toEqual(['jellyfin', 'jellyseerr', 'netflix', 'prime', 'youtube', 'homeassistant', 'nodie', 'audible', 'fountain', 'tidal']);
    expect(c.apps.find((a) => a.id === 'homeassistant')?.url).toBe('http://homeassistant.local:8123');
    expect(c.buttons).toEqual(DEFAULT_BUTTONS);
  });

  it('merges catalogue defaults with overrides', () => {
    const c = parseConfig('[[apps]]\nid = "nf"\ncatalogue = "netflix"\nname = "Films"');
    expect(c.apps[0]).toMatchObject({ id: 'nf', name: 'Films', type: 'web', url: 'https://www.netflix.com/browse', wmClass: 'sofa-nf' });
  });

  it('keeps catalogue wmClass for desktop apps', () => {
    const c = parseConfig('[[apps]]\nid = "jellyfin"\ncatalogue = "jellyfin"');
    expect(c.apps[0]?.wmClass).toBe('jellyfin-desktop');
  });

  it('skips hidden apps', () => {
    const c = parseConfig('[[apps]]\nid = "nf"\ncatalogue = "netflix"\nhidden = true');
    expect(c.apps).toEqual([]);
  });

  it('overrides individual buttons', () => {
    const c = parseConfig('[buttons]\nhome = "Ctrl+Alt+Shift+F1"\nback = "Ctrl+Alt+Shift+F2"');
    expect(c.buttons.home).toBe('Ctrl+Alt+Shift+F1');
    expect(c.buttons.power).toBe(DEFAULT_BUTTONS.power);
    expect(c.buttons.back).toBe('Ctrl+Alt+Shift+F2');
  });

  it.each([
    ['http (not https) urls', '[[apps]]\nid = "x"\ntype = "web"\nurl = "http://example.com"'],
    ['javascript: urls', '[[apps]]\nid = "x"\ntype = "web"\nurl = "javascript:alert(1)"'],
    ['web apps without a url', '[[apps]]\nid = "x"\ntype = "web"'],
    ['desktop apps without a command', '[[apps]]\nid = "x"\ntype = "desktop"'],
    ['unknown catalogue entries', '[[apps]]\nid = "x"\ncatalogue = "nope"'],
    ['duplicate ids', '[[apps]]\nid = "x"\ncatalogue = "netflix"\n[[apps]]\nid = "x"\ncatalogue = "prime"'],
    ['ids with odd characters', '[[apps]]\nid = "../evil"\ncatalogue = "netflix"'],
    ['wmClass with regex characters', '[[apps]]\nid = "x"\ntype = "desktop"\ncommand = ["a"]\nwmClass = ".*"'],
    ['unknown keys', '[[apps]]\nid = "x"\ncatalogue = "netflix"\nshell = "rm -rf ~"'],
    ['arbitrary browser paths', '[[apps]]\nid = "x"\ncatalogue = "netflix"\nbrowser = "/tmp/evil"'],
    ['removed homeOpensPanel option', '[ui]\nhomeOpensPanel = true'],
    ['bad TOML', '[[apps'],
  ])('rejects %s', (_label, toml) => {
    expect(() => parseConfig(toml)).toThrow(ConfigError);
  });
});

describe('app lifecycle metadata', () => {
  it('resolves catalogue metadata and explicit overrides', () => {
    const config = parseConfig(SEED_CONFIG);
    expect(config.apps.find((a) => a.id === 'jellyfin')?.flatpak).toBe('org.jellyfin.JellyfinDesktop');
    expect(config.apps.find((a) => a.id === 'nodie')?.keepOnClose).toBeUndefined();
    expect(parseConfig('[[apps]]\nid="n"\ncatalogue="nodie"\nkeepOnClose=false\nflatpak="org.example.App-1"').apps[0])
      .toMatchObject({ keepOnClose: false, flatpak: 'org.example.App-1' });
  });

  it.each(['', 'org.example/App', 'org.example App', 'org.example;kill', 'org.example\\nApp'])('rejects invalid Flatpak id %j', (id) => {
    expect(() => parseConfig(`[[apps]]\nid="x"\ncatalogue="jellyfin"\nflatpak="${id}"`)).toThrow(ConfigError);
  });

  it('requires a boolean keepOnClose', () => {
    expect(() => parseConfig('[[apps]]\nid="x"\ncatalogue="nodie"\nkeepOnClose="true"')).toThrow(ConfigError);
  });
});

describe('Jellyseerr catalogue', () => {
  it('requires a user-specific HTTPS URL', () => {
    const entry = '[[apps]]\nid="jellyseerr"\ncatalogue="jellyseerr"';
    expect(() => parseConfig(entry)).toThrow('web apps need a url');
    expect(() => parseConfig(`${entry}\nurl="http://requests.example.com"`)).toThrow(ConfigError);
    expect(parseConfig(`${entry}\nurl="https://requests.example.com"`).apps[0]).toMatchObject({
      id: 'jellyseerr', name: 'Jellyseerr', type: 'web', brand: 'jellyseerr', url: 'https://requests.example.com',
    });
  });
});


describe('appearance schema', () => {
  it('defaults to knowall with or without ui', () => {
    expect(parseConfig('').ui.theme).toBe('knowall');
    expect(parseConfig('[ui]\ndefaultBrowser="edge"').ui.theme).toBe('knowall');
    expect(parseConfig(SEED_CONFIG).ui.theme).toBe('knowall');
  });
  it.each(['knowall', 'nodie'])('accepts %s', (theme) => {
    expect(parseConfig(`[ui]\ntheme="${theme}"`).ui.theme).toBe(theme);
  });
  it('defaults the background to midnight and accepts every listed one', () => {
    expect(parseConfig('').ui.background).toBe('midnight');
    expect(parseConfig(SEED_CONFIG).ui.background).toBe('midnight');
    expect(BACKGROUND_IDS).toHaveLength(18);
    expect(BACKGROUND_IDS.slice(12)).toEqual(['pavement-lights', 'glove-and-hat', 'toe-stand', 'moonlit-night', 'stage-lean', 'moonwalk']);
    for (const id of BACKGROUND_IDS) expect(parseConfig(`[ui]\nbackground="${id}"`).ui.background).toBe(id);
    expect(() => parseConfig('[ui]\nbackground="beach"')).toThrow(ConfigError);
  });
  it('rejects unsupported themes', () => {
    expect(() => parseConfig('[ui]\ntheme="blue"')).toThrow(ConfigError);
  });
});

describe('camera input configuration', () => {
  it('derives one shared connection and separate selectable inputs from the camera inventory', () => {
    const result = parseConfig('[[apps]]\nid="homeassistant"\ncatalogue="homeassistant"\nurl="https://ha.example"\n[[cameras]]\nid="door"\nname="Front door"\nentity="camera.door"');
    expect(result.homeAssistantUrl).toBe('https://ha.example');
    expect(result.apps.slice(-2)).toMatchObject([{id:'all-cameras',type:'camera',entity:'all'},{id:'camera-door',type:'camera',entity:'camera.door'}]);
  });
  it('rejects duplicate entity inputs, invalid entities and missing connection URLs', () => {
    const camera = '[[cameras]]\nid="door"\nname="Door"\nentity="camera.door"';
    expect(() => parseConfig(camera)).toThrow('Home Assistant URL');
    expect(() => parseConfig('[homeAssistant]\nurl="https://ha.example"\n'+camera+'\n[[cameras]]\nid="door2"\nname="Again"\nentity="camera.door"')).toThrow('Duplicate camera');
    expect(() => parseConfig('[homeAssistant]\nurl="https://ha.example"\n'+camera.replace('camera.door','switch.lock'))).toThrow();
  });
});

describe('games', () => {
  it('puts a catalogue game, or any app marked group = "games", in the Games group', () => {
    const roblox = parseConfig('[[apps]]\nid = "roblox"\ncatalogue = "roblox"').apps[0];
    expect(roblox).toMatchObject({ id: 'roblox', name: 'Roblox', type: 'desktop', group: 'games', flatpak: 'org.vinegarhq.Sober', wmClass: 'sober' });
    expect(roblox?.command).toEqual(['flatpak', 'run', 'org.vinegarhq.Sober']);
    expect(parseConfig('[[apps]]\nid = "x"\ntype = "desktop"\ncommand = ["supertux2"]\ngroup = "games"').apps[0]?.group).toBe('games');
    expect(parseConfig('[[apps]]\nid = "roblox"\ncatalogue = "roblox"\ngroup = "apps"').apps[0]?.group).toBeUndefined();
    expect(parseConfig(SEED_CONFIG).apps.some((a) => a.group)).toBe(false);
  });

  it('keeps configured games in config order among the apps', () => {
    const c = parseConfig('[[apps]]\nid = "roblox"\ncatalogue = "roblox"\n[[apps]]\nid = "netflix"\ncatalogue = "netflix"\n[[apps]]\nid = "tux"\ntype = "desktop"\ncommand = ["supertux2"]\ngroup = "games"');
    expect(c.apps.filter((a) => a.group === 'games').map((a) => a.id)).toEqual(['roblox', 'tux']);
  });

  it('defaults Steam games on with nothing hidden, and normalises hidden ids', () => {
    expect(parseConfig('').games).toEqual({ enabled: true, hidden: [], fetchArt: true });
    expect(parseConfig(SEED_CONFIG).games).toEqual({ enabled: true, hidden: [], fetchArt: true });
    expect(parseConfig('[games]\nfetchArt = false').games.fetchArt).toBe(false);
    expect(parseConfig('[games]\nenabled = false\nhidden = ["552990", 431960]').games).toEqual({ enabled: false, hidden: ['552990', '431960'], fetchArt: true });
  });

  it.each([
    ['an unknown group', '[[apps]]\nid = "x"\ncatalogue = "netflix"\ngroup = "films"'],
    ['unknown [games] keys', '[games]\nsteamPath = "/tmp"'],
    ['non-numeric hidden ids', '[games]\nhidden = ["../x"]'],
    ['negative hidden ids', '[games]\nhidden = [-1]'],
    ['a non-boolean enabled', '[games]\nenabled = "yes"'],
  ])('rejects %s', (_label, toml) => {
    expect(() => parseConfig(toml)).toThrow(ConfigError);
  });
});
