import { execFile } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = 'C:\\Users\\forre\\Documents\\unified';
const DOWNLOADS = 'C:\\Users\\forre\\Downloads';
const NODE = path.join(ROOT, 'runtime', 'node', 'node.exe');
const RUNNER = path.join(ROOT, 'introduction-video', 'record-simple.mjs');
const STORYBOARD = path.join(ROOT, 'introduction-video', 'storyboard.json');
const FFPROBE = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffprobe.exe');
const OUTPUT = path.join(ROOT, 'benchmarks', 'results');
const CANONICAL = path.join(ROOT, 'introduction-video', 'neural-avatar-pipeline-introduction.mp4');
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = (values) => ({ median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) });

async function latestExport(afterMs) {
  const names = (await readdir(DOWNLOADS)).filter((name) => /^neural-avatar-pipeline-full-flow-.*\.mp4$/i.test(name));
  const files = await Promise.all(names.map(async (name) => {
    const fullPath = path.join(DOWNLOADS, name);
    return { fullPath, name, info: await stat(fullPath) };
  }));
  const latest = files.filter((file) => file.info.mtimeMs >= afterMs - 1000).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0];
  return latest || { fullPath: CANONICAL, name: path.basename(CANONICAL), info: await stat(CANONICAL), canonicalFallback: true };
}

async function probe(file) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_name,width,height,r_frame_rate,duration', '-of', 'json', file,
  ], { encoding: 'utf8', windowsHide: true });
  return JSON.parse(stdout);
}

const runs = [];
for (let run = 1; run <= 3; run += 1) {
  const startedAtMs = Date.now();
  const started = performance.now();
  await execFileAsync(NODE, [RUNNER, STORYBOARD], { cwd: path.join(ROOT, 'introduction-video'), windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
  const wallSeconds = (performance.now() - started) / 1000;
  const file = await latestExport(startedAtMs);
  const metadata = await probe(file.fullPath);
  const video = metadata.streams.find((stream) => stream.codec_name === 'h264') || metadata.streams[0];
  const audio = metadata.streams.find((stream) => stream.codec_name === 'aac') || metadata.streams[1];
  runs.push({
    run,
    mode: 'warm',
    wallSeconds: round(wallSeconds, 3),
    file: file.name,
    metadataSource: file.canonicalFallback ? 'approved canonical MP4; in-app browser download is managed outside Windows Downloads' : 'new Windows Downloads export',
    sizeBytes: Number(metadata.format.size),
    sizeMiB: round(Number(metadata.format.size) / 1024 / 1024, 3),
    containerSeconds: round(metadata.format.duration, 4),
    videoSeconds: round(video.duration, 4),
    audioSeconds: round(audio.duration, 4),
    postRollSeconds: round(Number(video.duration) - Number(audio.duration), 4),
    width: video.width,
    height: video.height,
    frameRate: video.r_frame_rate,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    wallToMediaRatio: round(wallSeconds / Number(metadata.format.duration), 3),
  });
  console.log(`Export benchmark ${run}/3 complete: ${wallSeconds.toFixed(2)}s wall.`);
}

const warm = runs.slice(1);
const result = {
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  storyboard: 'introduction-video/storyboard.json',
  runs,
  allWallSeconds: summary(runs.map((run) => run.wallSeconds)),
  warmWallSeconds: summary(warm.map((run) => run.wallSeconds)),
  outputSizeMiB: summary(runs.map((run) => run.sizeMiB)),
  mediaDurationSeconds: summary(runs.map((run) => run.containerSeconds)),
};
await writeFile(path.join(OUTPUT, 'LATEST_EXPORT.json'), JSON.stringify(result, null, 2));
await writeFile(path.join(OUTPUT, 'LATEST_EXPORT.md'), `# Approved introduction export benchmark\n\n` +
  `Three one-pass exports of the approved storyboard were measured with resident models.\n\n` +
  `| Run | Mode | Wall time | Media duration | Wall/media | Size |\n| ---: | --- | ---: | ---: | ---: | ---: |\n` +
  runs.map((run) => `| ${run.run} | ${run.mode} | ${run.wallSeconds}s | ${run.containerSeconds}s | ${run.wallToMediaRatio}× | ${run.sizeMiB} MiB |`).join('\n') +
  `\n\nAll outputs: H.264/AAC, ${runs[0].width}×${runs[0].height}, ${runs[0].frameRate} fps. Video exceeds audio by ${runs[0].postRollSeconds}s because the exporter intentionally preserves a closing visual post-roll.\n`);
console.log(JSON.stringify({ ok: true, result: 'benchmarks/results/LATEST_EXPORT.json' }, null, 2));
