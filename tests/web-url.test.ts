import { describe, expect, it } from 'vitest';
import { isAllowedWebUrl } from '../src/main/web-url';
import { parseConfig } from '../src/main/config';
import { launchArgv } from '../src/main/argv';

describe('shared web URL policy', () => {
  it.each(['http://127.0.0.1:5055', 'http://localhost:8080', 'http://localhost/', 'https://example.com', 'http://192.168.1.50:5055', 'http://10.0.0.20', 'http://172.16.0.1', 'http://172.31.255.255', 'http://homeassistant.local:8123', 'http://media.lan', 'http://ha.home.arpa', 'http://service.internal', 'http://a-b2.local'])('accepts %s across config and argv', (url) => {
    expect(isAllowedWebUrl(url)).toBe(true);
    const config = parseConfig(`[[apps]]\nid="x"\ntype="web"\nurl="${url}"\nsearchUrl="${url}"`);
    expect(parseConfig(`[homeAssistant]\nurl="${url}"`).homeAssistantUrl).toBe(url);
    expect(launchArgv(config.apps[0]!, { dataDir: '/tmp', browser: { id: 'edge', binary: '/usr/bin/microsoft-edge-stable' } })[1]).toContain(`--app=${url}`);
  });
  it.each(['http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://user@127.0.0.1@evil', 'javascript:alert(1)', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://localhost\\@evil', 'http://user@localhost', 'http://[::1]', 'http://[fd00::1]', 'http://8.8.8.8', 'http://example.com', 'http://172.15.255.255', 'http://172.32.0.0', 'http://192.169.1.50', 'http://192.168.1.50.evil.com', 'http://evil.com#@192.168.1.50', 'http://user@192.168.1.50', 'http://user@homeassistant.local', 'http://3232235777', 'http://0xC0A80101', 'http://0300.0250.1.1', 'http://192.168.001.50', 'http://homeassistant.local.', 'http://HOMEASSISTANT.local', 'http://%68omeassistant.local', 'http://a..local', 'http://a_b.local', 'http://' + 'a'.repeat(64) + '.local', 'http://192.168.1.256'])('rejects %s across config and argv', (url) => {
    expect(isAllowedWebUrl(url)).toBe(false);
    expect(() => parseConfig(`[[apps]]\nid="x"\ntype="web"\nurl=${JSON.stringify(url)}`)).toThrow();
    const app = parseConfig('[[apps]]\nid="x"\ncatalogue="netflix"').apps[0]!;
    expect(() => launchArgv({ ...app, url }, { dataDir: '/tmp', browser: { id: 'edge', binary: '/usr/bin/microsoft-edge-stable' } })).toThrow();
  });
});
