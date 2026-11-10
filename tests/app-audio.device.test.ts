import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppAudio } from '../src/main/app-audio';
const exec = promisify(execFile);
const host = process.env.SOFA_TEST_HOST;
const ssh = async (...args: string[]) => (await exec('ssh', [host!, ...args], { timeout: 5000 })).stdout;
it.skipIf(!host || process.env.SOFA_AUDIO_DEVICE !== '1')('isolates volume and mute across two real silent PulseAudio streams without changing master', async () => {
  const [a,b] = JSON.parse(await ssh('cat', '/tmp/sofa-audio-fixture.json')) as number[];
  const list = async () => JSON.parse(await ssh('pactl','-f','json','list','sink-inputs')) as any[];
  const streams = await list();
  const one = streams.find(s => s.properties['application.process.id'] === String(a));
  const two = streams.find(s => s.properties['application.process.id'] === String(b));
  expect(one).toBeTruthy(); expect(two).toBeTruthy();
  for (const stream of [one,two]) { await ssh('pactl','set-sink-input-volume', String(stream.index),'50%'); await ssh('pactl','set-sink-input-mute',String(stream.index),'0'); }
  const master = await ssh('pactl','get-sink-volume','@DEFAULT_SINK@');
  const audio = new AppAudio((file,args) => ssh(file,...args), () => null);
  expect((await audio.control(a!,undefined,'down')).volume).toBe(45);
  expect((await audio.control(b!,undefined,'mute')).muted).toBe(true);
  const after = await list();
  expect(after.find(s=>s.index===one.index).mute).toBe(false);
  expect(Object.values(after.find(s=>s.index===two.index).volume).map((c:any)=>c.value)).toEqual([32768,32768]);
  expect(await ssh('pactl','get-sink-volume','@DEFAULT_SINK@')).toBe(master);
  expect((await audio.control(b!,undefined,'mute')).muted).toBe(false);
}, 20000);
